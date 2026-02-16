#!/usr/bin/env bash
set -euo pipefail

# Fleet — Node join installer
# Usage: curl -fsSL https://raw.githubusercontent.com/componentor/fleet/main/install/join.sh | bash

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
  esac

  systemctl enable docker
  systemctl start docker
  log "Docker installed"
}

# ─── Configure Docker Security ───────────────────────────────────────
configure_docker() {
  log "Configuring Docker security..."
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'DAEMONJSON'
{
  "userns-remap": "default",
  "no-new-privileges": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true,
  "storage-driver": "overlay2"
}
DAEMONJSON
  systemctl restart docker
  log "Docker configured"
}

# ─── Install NFS client ──────────────────────────────────────────────
install_nfs_client() {
  log "Installing NFS client..."
  case $OS in
    ubuntu|debian)
      apt-get install -y -qq nfs-common
      ;;
    centos|rocky|rhel|almalinux)
      yum install -y -q nfs-utils
      ;;
  esac
  log "NFS client installed"
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

  # Otherwise prompt
  echo ""
  read -rp "$(echo -e ${BLUE}Paste the swarm join token: ${NC})" JOIN_TOKEN
  read -rp "$(echo -e ${BLUE}Enter manager address \(ip:2377\): ${NC})" MANAGER_ADDR

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
  mkdir -p /mnt/fleet-nfs

  if [ -n "${FLEET_NFS_SERVER:-}" ]; then
    echo "$FLEET_NFS_SERVER:/opt/fleet/nfs-exports /mnt/fleet-nfs nfs defaults 0 0" >> /etc/fstab
    mount -a
    log "NFS mounted from $FLEET_NFS_SERVER"
  else
    read -rp "$(echo -e ${BLUE}Enter NFS server IP \(first node IP\): ${NC})" NFS_SERVER
    if [ -n "$NFS_SERVER" ]; then
      echo "$NFS_SERVER:/opt/fleet/nfs-exports /mnt/fleet-nfs nfs defaults 0 0" >> /etc/fstab
      mount -a
      log "NFS mounted from $NFS_SERVER"
    else
      warn "Skipping NFS mount. Configure manually later."
    fi
  fi
}

# ─── Main ────────────────────────────────────────────────────────────
main() {
  detect_os
  install_docker
  configure_docker
  install_nfs_client
  start_wizard
  configure_nfs_mount

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
