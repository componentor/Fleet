#!/usr/bin/env bash
set -euo pipefail

# Fleet — Node join installer
# Usage (public repo):  curl -fsSL https://raw.githubusercontent.com/componentor/fleet/main/install/join.sh | bash
# Usage (private repo): Copy this script to the server and run: bash join.sh

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[fleet]${NC} $1"; }
warn() { echo -e "${YELLOW}[fleet]${NC} $1"; }
err()  { echo -e "${RED}[fleet]${NC} $1"; exit 1; }

if [ "$EUID" -ne 0 ]; then
  err "Please run as root: sudo bash join.sh"
fi

echo -e "${BLUE}"
echo '  _   _           _            '
echo ' | | | | ___  ___| |_ ___ _ __ '
echo ' | |_| |/ _ \/ __| __/ _ \ __|'
echo ' |  _  | (_) \__ \ ||  __/ |   '
echo ' |_| |_|\___/|___/\__\___|_|   '
echo -e "${NC}"
echo "  Node Join Script"
echo ""

# ─── Detect OS ───────────────────────────────────────────────────────
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
  else
    err "Unsupported OS."
  fi
  log "Detected OS: $OS $OS_VERSION"
}

# ─── Install system dependencies ─────────────────────────────────────
install_dependencies() {
  log "Checking system dependencies..."

  # Check what's already installed
  local MISSING=""
  for cmd in curl openssl tar gzip unzip jq; do
    if command -v "$cmd" &>/dev/null; then
      log "  ✓ $cmd already installed"
    else
      MISSING="$MISSING $cmd"
    fi
  done

  if [ -z "$MISSING" ]; then
    log "All required system dependencies are already installed"
    return
  fi

  log "Installing missing dependencies:$MISSING"
  case $OS in
    ubuntu|debian)
      apt-get update -qq
      apt-get install -y -qq \
        ca-certificates curl wget gnupg lsb-release \
        openssl tar gzip unzip xz-utils \
        jq htop net-tools iptables \
        logrotate cron
      ;;
    centos|rocky|rhel|almalinux)
      yum install -y -q epel-release 2>/dev/null || true
      yum install -y -q \
        ca-certificates curl wget gnupg2 \
        openssl tar gzip unzip xz \
        jq htop net-tools iptables \
        logrotate cronie
      ;;
    fedora)
      dnf install -y -q \
        ca-certificates curl wget gnupg2 \
        openssl tar gzip unzip xz \
        jq htop net-tools iptables \
        logrotate cronie
      ;;
    *)
      warn "Unknown OS '$OS' — skipping dependency install."
      ;;
  esac
  log "System dependencies installed"
}

# ─── Install Docker ──────────────────────────────────────────────────
install_docker() {
  if command -v docker &>/dev/null; then
    log "Docker is already installed"
    return
  fi

  log "Installing Docker..."
  case $OS in
    ubuntu|debian)
      apt-get update -qq
      apt-get install -y -qq ca-certificates curl gnupg
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/$OS/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
      apt-get update -qq
      apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    centos|rocky|rhel|almalinux)
      yum install -y -q yum-utils
      yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      yum install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    fedora)
      dnf install -y -q dnf-plugins-core
      dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
      dnf install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    *)
      err "Unsupported OS for Docker install: $OS"
      ;;
  esac

  systemctl enable docker
  systemctl start docker
  log "Docker installed"
}

# ─── Configure Docker Security ───────────────────────────────────────
configure_docker() {
  log "Configuring Docker daemon security..."
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'DAEMONJSON'
{
  "no-new-privileges": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "default-ulimits": {
    "nproc": { "Name": "nproc", "Hard": 1024, "Soft": 1024 },
    "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 65536 }
  },
  "storage-driver": "overlay2"
}
DAEMONJSON
  systemctl restart docker
  log "Docker daemon configured with security hardening"
}

# ─── Install NFS client ──────────────────────────────────────────────
install_nfs_client() {
  if command -v mount.nfs &>/dev/null; then
    log "NFS client is already installed"
    return
  fi

  log "Installing NFS client..."
  case $OS in
    ubuntu|debian)
      apt-get install -y -qq nfs-common
      ;;
    centos|rocky|rhel|almalinux)
      yum install -y -q nfs-utils
      ;;
    fedora)
      dnf install -y -q nfs-utils
      ;;
  esac
  log "NFS client installed"
}

# ─── Load FUSE kernel module ─────────────────────────────────────────
load_fuse() {
  if lsmod | grep -q fuse; then
    log "FUSE kernel module already loaded"
    return
  fi

  log "Loading FUSE kernel module..."
  modprobe fuse 2>/dev/null || warn "Could not load fuse kernel module (may need reboot)"
  echo "fuse" > /etc/modules-load.d/fuse.conf 2>/dev/null || true
  log "FUSE kernel module loaded (persisted for reboot)"
}

# ─── Start temporary setup wizard ─────────────────────────────────────
start_wizard() {
  log "Starting temporary setup wizard on port 80..."
  warn "A web-based setup wizard is starting on http://$(hostname -I | awk '{print $1}'):80"
  warn "Open it in your browser to complete the join process."
  echo ""
  echo "Alternatively, you can join manually:"
  echo "  1. Get the join token from the Fleet admin dashboard"
  echo "  2. Run: docker swarm join --token <TOKEN> <MANAGER_IP>:2377"
  echo ""

  # If token was passed as env var, join automatically
  if [ -n "${FLEET_JOIN_TOKEN:-}" ] && [ -n "${FLEET_MANAGER_ADDR:-}" ]; then
    log "Join token detected, joining swarm automatically..."
    docker swarm join --token "$FLEET_JOIN_TOKEN" "$FLEET_MANAGER_ADDR"
    log "Successfully joined the swarm!"
    return
  fi

  # Otherwise prompt (read from /dev/tty so this works when piped from curl)
  echo ""
  read -rp "$(echo -e ${BLUE}Paste the swarm join token: ${NC})" JOIN_TOKEN </dev/tty
  read -rp "$(echo -e ${BLUE}Enter manager address \(ip:2377\): ${NC})" MANAGER_ADDR </dev/tty

  if [ -n "$JOIN_TOKEN" ] && [ -n "$MANAGER_ADDR" ]; then
    docker swarm join --token "$JOIN_TOKEN" "$MANAGER_ADDR"
    log "Successfully joined the swarm!"
  else
    warn "No token provided. Configure manually or use the web wizard."
  fi
}

# ─── Configure NFS mount ─────────────────────────────────────────────
configure_nfs_mount() {
  log "Configuring NFS mount..."
  mkdir -p /opt/fleet/nfs-exports

  local NFS_SERVER=""
  if [ -n "${FLEET_NFS_SERVER:-}" ]; then
    NFS_SERVER="$FLEET_NFS_SERVER"
  else
    read -rp "$(echo -e ${BLUE}Enter NFS server IP \(first node IP\): ${NC})" NFS_SERVER </dev/tty
  fi

  if [ -n "$NFS_SERVER" ]; then
    # Guard against duplicate fstab entries — mount at same path as primary for consistency
    if ! grep -q "/opt/fleet/nfs-exports" /etc/fstab 2>/dev/null; then
      echo "$NFS_SERVER:/opt/fleet/nfs-exports /opt/fleet/nfs-exports nfs defaults 0 0" >> /etc/fstab
    fi
    mount -a
    # Keep legacy symlink for backwards compatibility
    if [ ! -e /mnt/fleet-nfs ]; then
      ln -s /opt/fleet/nfs-exports /mnt/fleet-nfs
    fi
    log "NFS mounted from $NFS_SERVER at /opt/fleet/nfs-exports"
  else
    warn "Skipping NFS mount. Configure manually later."
  fi
}

# ─── Optional: Install k3s agent ─────────────────────────────────────
install_k3s_agent() {
  # Auto-install if k3s env vars are set (from manager's config)
  if [ -n "${FLEET_K3S_TOKEN:-}" ] && [ -n "${FLEET_K3S_URL:-}" ]; then
    log "k3s credentials detected, installing k3s agent..."
  else
    # Check NFS mount for k3s config
    if [ -f /opt/fleet/nfs-exports/../config/env ] && grep -q "K3S_TOKEN" /opt/fleet/nfs-exports/../config/env 2>/dev/null; then
      source <(grep "^K3S_" /opt/fleet/nfs-exports/../config/env 2>/dev/null)
      export FLEET_K3S_TOKEN="${K3S_TOKEN:-}"
      export FLEET_K3S_URL="${K3S_URL:-}"
    fi

    if [ -z "${FLEET_K3S_TOKEN:-}" ] || [ -z "${FLEET_K3S_URL:-}" ]; then
      echo ""
      read -rp "$(echo -e ${BLUE}Install k3s agent for Kubernetes support? [y/N]: ${NC})" INSTALL_K3S </dev/tty
      if [[ ! "$INSTALL_K3S" =~ ^[Yy] ]]; then
        log "Skipping k3s agent installation"
        return
      fi
      read -rp "$(echo -e ${BLUE}Enter k3s server URL \(e.g., https://MANAGER_IP:6443\): ${NC})" FLEET_K3S_URL </dev/tty
      read -rp "$(echo -e ${BLUE}Enter k3s join token: ${NC})" FLEET_K3S_TOKEN </dev/tty
    fi
  fi

  if [ -n "$FLEET_K3S_TOKEN" ] && [ -n "$FLEET_K3S_URL" ]; then
    if command -v k3s &>/dev/null; then
      log "k3s is already installed"
    else
      log "Installing k3s agent..."
      curl -sfL https://get.k3s.io | K3S_URL="$FLEET_K3S_URL" K3S_TOKEN="$FLEET_K3S_TOKEN" sh -
      log "k3s agent installed and joined cluster"
    fi
  else
    warn "k3s token or URL not provided. Skipping k3s agent."
  fi
}

# ─── Main ────────────────────────────────────────────────────────────
main() {
  detect_os
  install_dependencies
  install_docker
  configure_docker
  install_nfs_client
  load_fuse
  start_wizard
  configure_nfs_mount
  install_k3s_agent

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  ✅ Node joined successfully!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  The Fleet agent will be automatically deployed to this node."
  echo "  Check the admin dashboard for the new node."
  echo ""
}

main "$@"
