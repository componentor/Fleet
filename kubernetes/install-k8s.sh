#!/bin/bash
set -euo pipefail

# Fleet Kubernetes Bootstrap Script
# Installs k3s with Cilium CNI, Longhorn, and Fleet platform components

FLEET_VERSION="${FLEET_VERSION:-latest}"
ACME_EMAIL="${ACME_EMAIL:-}"
PLATFORM_DOMAIN="${PLATFORM_DOMAIN:-}"

echo "=== Fleet Kubernetes Installation ==="
echo "Fleet version: ${FLEET_VERSION}"
echo ""

# ── 1. Install k3s (without Flannel — Cilium replaces it) ──
echo "[1/6] Installing k3s..."
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --flannel-backend=none \
  --disable-network-policy \
  --disable=traefik \
  --disable=servicelb \
  --write-kubeconfig-mode=644" sh -

# Ensure k3s service is running (installer skips start on reinstall)
systemctl start k3s 2>/dev/null || true

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

echo "Waiting for k3s to be ready..."
until kubectl get nodes &>/dev/null; do sleep 2; done
echo "k3s is ready."

# ── 2. Install Cilium CNI ──
echo "[2/6] Installing Cilium CNI..."
if ! command -v cilium &>/dev/null; then
  CILIUM_CLI_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/cilium-cli/main/stable.txt)
  curl -L --fail --remote-name-all \
    "https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-amd64.tar.gz"
  tar xzf cilium-linux-amd64.tar.gz -C /usr/local/bin
  rm -f cilium-linux-amd64.tar.gz
fi
cilium install --set kubeProxyReplacement=true
cilium status --wait

# ── 3. Install Longhorn ──
echo "[3/6] Installing Longhorn storage..."
kubectl apply -f https://raw.githubusercontent.com/longhorn/longhorn/v1.7.2/deploy/longhorn.yaml
echo "Waiting for Longhorn to be ready..."
kubectl -n longhorn-system rollout status deploy/longhorn-driver-deployer --timeout=300s

# Apply Fleet storage class
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
kubectl apply -f "${SCRIPT_DIR}/manifests/longhorn-storageclass.yaml"

# ── 4. Create Fleet namespace and secrets ──
echo "[4/6] Setting up Fleet namespace and configuration..."
kubectl apply -f "${SCRIPT_DIR}/manifests/namespace.yaml"

# Generate secrets if env file exists
if [ -f /opt/fleet/config/env ]; then
  kubectl -n fleet-system create secret generic fleet-api-env \
    --from-env-file=/opt/fleet/config/env --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n fleet-system create secret generic fleet-agent-env \
    --from-env-file=/opt/fleet/config/env --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n fleet-system create secret generic fleet-ssh-env \
    --from-env-file=/opt/fleet/config/env --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n fleet-system create secret generic postgres-env \
    --from-env-file=/opt/fleet/config/env --dry-run=client -o yaml | kubectl apply -f -
fi

# ── 5. Apply all Fleet manifests ──
echo "[5/6] Deploying Fleet platform components..."
kubectl apply -f "${SCRIPT_DIR}/manifests/api-rbac.yaml"
kubectl apply -f "${SCRIPT_DIR}/manifests/agent-rbac.yaml"
kubectl apply -f "${SCRIPT_DIR}/manifests/traefik-config.yaml"
kubectl apply -f "${SCRIPT_DIR}/manifests/default-network-policy.yaml"

kubectl apply -f "${SCRIPT_DIR}/manifests/postgres-statefulset.yaml"
kubectl apply -f "${SCRIPT_DIR}/manifests/valkey-statefulset.yaml"
kubectl apply -f "${SCRIPT_DIR}/manifests/registry-deployment.yaml"
kubectl apply -f "${SCRIPT_DIR}/manifests/buildkit-deployment.yaml"

echo "Waiting for database to be ready..."
kubectl -n fleet-system rollout status statefulset/postgres --timeout=120s
kubectl -n fleet-system rollout status statefulset/valkey --timeout=120s

kubectl apply -f "${SCRIPT_DIR}/manifests/api-deployment.yaml"
kubectl apply -f "${SCRIPT_DIR}/manifests/dashboard-deployment.yaml"
kubectl apply -f "${SCRIPT_DIR}/manifests/ssh-gateway-deployment.yaml"
kubectl apply -f "${SCRIPT_DIR}/manifests/agent-daemonset.yaml"

# ── 6. Verify ──
echo "[6/6] Verifying deployment..."
kubectl -n fleet-system rollout status deploy/fleet-api --timeout=120s
kubectl -n fleet-system rollout status deploy/fleet-dashboard --timeout=120s

echo ""
echo "=== Fleet Kubernetes installation complete ==="
echo ""
echo "To add worker nodes, run on each worker:"
echo "  K3S_URL=https://$(hostname -I | awk '{print $1}'):6443 \\"
echo "  K3S_TOKEN=$(cat /var/lib/rancher/k3s/server/node-token) \\"
echo "  bash kubernetes/join-k8s.sh"
echo ""
echo "KUBECONFIG is at: /etc/rancher/k3s/k3s.yaml"
kubectl get nodes
echo ""
kubectl -n fleet-system get pods
