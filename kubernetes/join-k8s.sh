#!/bin/bash
set -euo pipefail

# Fleet Kubernetes Worker Join Script
# Joins this node to an existing Fleet k3s cluster

K3S_URL="${K3S_URL:?K3S_URL is required (e.g. https://MASTER_IP:6443)}"
K3S_TOKEN="${K3S_TOKEN:?K3S_TOKEN is required (from master /var/lib/rancher/k3s/server/node-token)}"

echo "=== Joining Fleet Kubernetes Cluster ==="
echo "Master: ${K3S_URL}"
echo ""

# Install k3s agent (worker mode)
echo "[1/2] Installing k3s agent..."
curl -sfL https://get.k3s.io | K3S_URL="${K3S_URL}" K3S_TOKEN="${K3S_TOKEN}" sh -

# Verify
echo "[2/2] Verifying..."
echo "Node joined successfully. The agent DaemonSet will start automatically."
echo ""
echo "To verify from the master node, run:"
echo "  kubectl get nodes"
