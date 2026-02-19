#!/usr/bin/env bash
set -euo pipefail

# Fleet — Storage Node Setup Script
# Prepares a node to participate in the Fleet distributed storage cluster.
# Supports GlusterFS, Ceph, and MinIO installation.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/componentor/fleet/main/install/storage-node.sh | bash
#   bash storage-node.sh --provider glusterfs --data-path /srv/fleet-storage
#   bash storage-node.sh --provider ceph --monitors 10.0.1.10,10.0.1.11,10.0.1.12
#   bash storage-node.sh --provider minio --data-path /srv/fleet-objects

# ── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[fleet-storage]${NC} $1"; }
warn() { echo -e "${YELLOW}[fleet-storage]${NC} $1"; }
err()  { echo -e "${RED}[fleet-storage]${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[fleet-storage]${NC} $1"; }

# ── Defaults ──────────────────────────────────────────────────────────────
PROVIDER=""
DATA_PATH="/srv/fleet-storage"
CEPH_MONITORS=""
CEPH_POOL="fleet-volumes"
CEPH_USER="admin"
MINIO_PORT="9000"
MINIO_CONSOLE_PORT="9001"
MINIO_ACCESS_KEY=""
MINIO_SECRET_KEY=""
SKIP_FIREWALL=false

# ── Parse arguments ───────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider)       PROVIDER="$2"; shift 2 ;;
    --data-path)      DATA_PATH="$2"; shift 2 ;;
    --monitors)       CEPH_MONITORS="$2"; shift 2 ;;
    --ceph-pool)      CEPH_POOL="$2"; shift 2 ;;
    --ceph-user)      CEPH_USER="$2"; shift 2 ;;
    --minio-port)     MINIO_PORT="$2"; shift 2 ;;
    --minio-access-key) MINIO_ACCESS_KEY="$2"; shift 2 ;;
    --minio-secret-key) MINIO_SECRET_KEY="$2"; shift 2 ;;
    --skip-firewall)  SKIP_FIREWALL=true; shift ;;
    --help|-h)
      echo "Fleet Storage Node Setup"
      echo ""
      echo "Usage: bash storage-node.sh --provider <provider> [options]"
      echo ""
      echo "Providers:"
      echo "  glusterfs    GlusterFS distributed volume storage"
      echo "  ceph         Ceph RADOS block device storage"
      echo "  minio        MinIO S3-compatible object storage"
      echo "  all          Install all providers"
      echo ""
      echo "Options:"
      echo "  --data-path <path>       Storage data directory (default: /srv/fleet-storage)"
      echo "  --monitors <addrs>       Ceph monitor addresses (comma-separated)"
      echo "  --ceph-pool <name>       Ceph pool name (default: fleet-volumes)"
      echo "  --ceph-user <user>       Ceph auth user (default: admin)"
      echo "  --minio-port <port>      MinIO API port (default: 9000)"
      echo "  --minio-access-key <key> MinIO root access key"
      echo "  --minio-secret-key <key> MinIO root secret key"
      echo "  --skip-firewall          Skip firewall configuration"
      echo "  --help                   Show this help"
      exit 0
      ;;
    *) err "Unknown argument: $1. Use --help for usage." ;;
  esac
done

# ── Root check ────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Please run as root: sudo bash storage-node.sh ..."
fi

echo -e "${BLUE}"
echo '  _____ _           _     ____  _                            '
echo ' |  ___| | ___  ___| |_  / ___|| |_ ___  _ __ __ _  __ _  ___ '
echo ' | |_  | |/ _ \/ _ \ __| \___ \| __/ _ \| '__/ _` |/ _` |/ _ \'
echo ' |  _| | |  __/  __/ |_   ___) | || (_) | | | (_| | (_| |  __/'
echo ' |_|   |_|\___|\___|\__| |____/ \__\___/|_|  \__,_|\__, |\___|'
echo '                                                    |___/      '
echo -e "${NC}"
echo "  Storage Node Setup Script"
echo ""

# ── Detect OS ─────────────────────────────────────────────────────────────
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
  else
    err "Unsupported OS. Requires Ubuntu 20.04+, Debian 11+, Rocky 8+, or CentOS 8+."
  fi
  log "Detected OS: $OS $OS_VERSION"
}

# ── Validate provider ────────────────────────────────────────────────────
validate_provider() {
  if [ -z "$PROVIDER" ]; then
    echo "Select a storage provider to install:"
    echo ""
    echo "  1) glusterfs  — Distributed replicated volume storage (recommended for most setups)"
    echo "  2) ceph       — Enterprise block storage (for large-scale deployments)"
    echo "  3) minio      — S3-compatible object storage"
    echo "  4) all        — Install all of the above"
    echo ""
    read -rp "Enter choice [1-4]: " choice
    case "$choice" in
      1) PROVIDER="glusterfs" ;;
      2) PROVIDER="ceph" ;;
      3) PROVIDER="minio" ;;
      4) PROVIDER="all" ;;
      *) err "Invalid choice" ;;
    esac
  fi

  case "$PROVIDER" in
    glusterfs|ceph|minio|all) ;;
    *) err "Invalid provider: $PROVIDER. Choose: glusterfs, ceph, minio, or all" ;;
  esac

  log "Selected provider(s): $PROVIDER"
}

# ── System preparations ───────────────────────────────────────────────────
prepare_system() {
  log "Preparing system..."

  # Update package cache
  case $OS in
    ubuntu|debian)
      apt-get update -qq
      apt-get install -y -qq ca-certificates curl wget gnupg lsb-release jq
      ;;
    centos|rocky|rhel|almalinux)
      yum install -y -q epel-release 2>/dev/null || true
      yum install -y -q ca-certificates curl wget jq
      ;;
    *)
      err "Unsupported OS: $OS"
      ;;
  esac

  # Create data directory
  mkdir -p "$DATA_PATH"
  chmod 755 "$DATA_PATH"
  log "Data directory ready: $DATA_PATH"

  # Ensure adequate disk space (warn if < 50 GB free)
  local available_gb
  available_gb=$(df -BG "$DATA_PATH" | tail -1 | awk '{print $4}' | tr -d 'G')
  if [ "$available_gb" -lt 50 ]; then
    warn "Only ${available_gb} GB available at $DATA_PATH. Recommended: at least 50 GB."
  else
    log "Disk space at $DATA_PATH: ${available_gb} GB available"
  fi
}

# ── GlusterFS Installation ───────────────────────────────────────────────
install_glusterfs() {
  log "Installing GlusterFS..."

  if command -v gluster &>/dev/null; then
    log "GlusterFS already installed: $(gluster --version | head -1)"
    return
  fi

  case $OS in
    ubuntu)
      # Add GlusterFS PPA for latest stable release
      apt-get install -y -qq software-properties-common
      add-apt-repository -y ppa:gluster/glusterfs-11 2>/dev/null || true
      apt-get update -qq
      apt-get install -y -qq glusterfs-server glusterfs-client
      ;;
    debian)
      # Use official Gluster repo
      wget -qO- https://download.gluster.org/pub/gluster/glusterfs/LATEST/rsa.pub | apt-key add - 2>/dev/null || true
      apt-get install -y -qq glusterfs-server glusterfs-client
      ;;
    centos|rocky|rhel|almalinux)
      yum install -y -q centos-release-gluster 2>/dev/null || true
      yum install -y -q glusterfs-server glusterfs-client glusterfs-fuse
      ;;
  esac

  # Enable and start GlusterFS daemon
  systemctl enable glusterd
  systemctl start glusterd

  # Create brick directory
  mkdir -p "${DATA_PATH}/glusterfs/brick1"
  chmod 755 "${DATA_PATH}/glusterfs/brick1"

  # Install Docker GlusterFS volume plugin
  if command -v docker &>/dev/null; then
    log "Installing GlusterFS Docker volume plugin..."
    docker plugin install --grant-all-permissions glusterfs/glusterfs-plugin 2>/dev/null || \
      warn "GlusterFS Docker plugin install failed (may already be installed)"
  fi

  log "GlusterFS installed successfully: $(gluster --version | head -1)"
}

# ── Ceph Installation ─────────────────────────────────────────────────────
install_ceph() {
  log "Installing Ceph client tools..."

  if command -v rbd &>/dev/null; then
    log "Ceph client already installed: $(ceph --version)"
    return
  fi

  case $OS in
    ubuntu|debian)
      # Add Ceph Reef (18.x) repository
      curl -fsSL https://download.ceph.com/keys/release.asc | gpg --dearmor -o /etc/apt/keyrings/ceph.gpg 2>/dev/null || true
      echo "deb [signed-by=/etc/apt/keyrings/ceph.gpg] https://download.ceph.com/debian-reef/ $(lsb_release -sc) main" > /etc/apt/sources.list.d/ceph.list 2>/dev/null || true
      apt-get update -qq
      apt-get install -y -qq ceph-common rbd-nbd
      ;;
    centos|rocky|rhel|almalinux)
      rpm --import 'https://download.ceph.com/keys/release.asc' 2>/dev/null || true
      cat > /etc/yum.repos.d/ceph.repo << 'CEPHREPO'
[ceph]
name=Ceph packages
baseurl=https://download.ceph.com/rpm-reef/el$releasever/$basearch
enabled=1
gpgcheck=1
gpgkey=https://download.ceph.com/keys/release.asc
CEPHREPO
      yum install -y -q ceph-common rbd-nbd
      ;;
  esac

  # Create data directories
  mkdir -p "${DATA_PATH}/ceph"
  mkdir -p /etc/ceph

  # If monitors provided, create minimal ceph.conf
  if [ -n "$CEPH_MONITORS" ]; then
    if [ ! -f /etc/ceph/ceph.conf ]; then
      log "Creating Ceph configuration..."
      cat > /etc/ceph/ceph.conf << CEPHCONF
[global]
  mon_host = ${CEPH_MONITORS}
  auth_cluster_required = cephx
  auth_service_required = cephx
  auth_client_required = cephx
CEPHCONF
      log "Ceph config written to /etc/ceph/ceph.conf"
    else
      warn "/etc/ceph/ceph.conf already exists, skipping"
    fi
  else
    warn "No --monitors specified. You will need to configure /etc/ceph/ceph.conf manually."
  fi

  # Load rbd kernel module
  modprobe rbd 2>/dev/null || warn "Could not load rbd kernel module (may need reboot)"

  # Ensure rbd module loads on boot
  echo "rbd" > /etc/modules-load.d/rbd.conf 2>/dev/null || true

  log "Ceph client tools installed successfully"
}

# ── MinIO Installation ────────────────────────────────────────────────────
install_minio() {
  log "Installing MinIO..."

  if command -v minio &>/dev/null; then
    log "MinIO already installed: $(minio --version | head -1)"
  else
    # Download MinIO binary
    local ARCH
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64|amd64) ARCH="amd64" ;;
      aarch64|arm64) ARCH="arm64" ;;
      *) err "Unsupported architecture: $ARCH" ;;
    esac

    log "Downloading MinIO for linux/${ARCH}..."
    curl -fsSL "https://dl.min.io/server/minio/release/linux-${ARCH}/minio" -o /usr/local/bin/minio
    chmod +x /usr/local/bin/minio

    log "MinIO installed: $(minio --version | head -1)"
  fi

  # Install MinIO client (mc) if not present
  if ! command -v mc &>/dev/null; then
    local ARCH
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64|amd64) ARCH="amd64" ;;
      aarch64|arm64) ARCH="arm64" ;;
    esac
    curl -fsSL "https://dl.min.io/client/mc/release/linux-${ARCH}/mc" -o /usr/local/bin/mc
    chmod +x /usr/local/bin/mc
    log "MinIO client (mc) installed"
  fi

  # Create MinIO data and config directories
  mkdir -p "${DATA_PATH}/minio/data"
  mkdir -p /etc/minio

  # Generate access/secret keys if not provided
  if [ -z "$MINIO_ACCESS_KEY" ]; then
    MINIO_ACCESS_KEY=$(openssl rand -hex 16)
    log "Generated MinIO access key: $MINIO_ACCESS_KEY"
  fi
  if [ -z "$MINIO_SECRET_KEY" ]; then
    MINIO_SECRET_KEY=$(openssl rand -hex 32)
    log "Generated MinIO secret key: $MINIO_SECRET_KEY"
  fi

  # Create MinIO environment file
  cat > /etc/minio/minio.env << MINIOENV
# MinIO configuration for Fleet
MINIO_ROOT_USER=${MINIO_ACCESS_KEY}
MINIO_ROOT_PASSWORD=${MINIO_SECRET_KEY}
MINIO_VOLUMES="${DATA_PATH}/minio/data"
MINIO_OPTS="--console-address :${MINIO_CONSOLE_PORT}"
MINIOENV
  chmod 600 /etc/minio/minio.env

  # Create dedicated minio user
  if ! id -u minio &>/dev/null; then
    useradd -r -s /sbin/nologin minio
  fi
  chown -R minio:minio "${DATA_PATH}/minio"

  # Create systemd service
  cat > /etc/systemd/system/minio.service << 'MINIOSVC'
[Unit]
Description=MinIO Object Storage
Documentation=https://docs.min.io
After=network-online.target
Wants=network-online.target

[Service]
User=minio
Group=minio
EnvironmentFile=/etc/minio/minio.env
ExecStart=/usr/local/bin/minio server $MINIO_VOLUMES $MINIO_OPTS
Restart=always
RestartSec=5
LimitNOFILE=65536
TasksMax=infinity
TimeoutStopSec=infinity
SendSIGKILL=no

[Install]
WantedBy=multi-user.target
MINIOSVC

  systemctl daemon-reload
  systemctl enable minio
  systemctl start minio

  log "MinIO is running on port $MINIO_PORT (console: $MINIO_CONSOLE_PORT)"
}

# ── Firewall Configuration ────────────────────────────────────────────────
configure_firewall() {
  if [ "$SKIP_FIREWALL" = true ]; then
    log "Skipping firewall configuration (--skip-firewall)"
    return
  fi

  log "Configuring firewall rules..."

  # Detect firewall tool
  if command -v ufw &>/dev/null; then
    configure_ufw
  elif command -v firewall-cmd &>/dev/null; then
    configure_firewalld
  else
    warn "No supported firewall found (ufw or firewalld). Please configure manually."
    print_ports
    return
  fi
}

configure_ufw() {
  case "$PROVIDER" in
    glusterfs|all)
      ufw allow 24007/tcp comment "GlusterFS daemon"
      ufw allow 24008/tcp comment "GlusterFS management"
      ufw allow 49152:49251/tcp comment "GlusterFS brick ports"
      ;;
  esac
  case "$PROVIDER" in
    ceph|all)
      ufw allow 6789/tcp comment "Ceph monitor"
      ufw allow 6800:7300/tcp comment "Ceph OSD"
      ;;
  esac
  case "$PROVIDER" in
    minio|all)
      ufw allow "${MINIO_PORT}/tcp" comment "MinIO API"
      ufw allow "${MINIO_CONSOLE_PORT}/tcp" comment "MinIO console"
      ;;
  esac
  log "UFW rules configured"
}

configure_firewalld() {
  case "$PROVIDER" in
    glusterfs|all)
      firewall-cmd --permanent --add-port=24007/tcp
      firewall-cmd --permanent --add-port=24008/tcp
      firewall-cmd --permanent --add-port=49152-49251/tcp
      ;;
  esac
  case "$PROVIDER" in
    ceph|all)
      firewall-cmd --permanent --add-port=6789/tcp
      firewall-cmd --permanent --add-port=6800-7300/tcp
      ;;
  esac
  case "$PROVIDER" in
    minio|all)
      firewall-cmd --permanent --add-port="${MINIO_PORT}/tcp"
      firewall-cmd --permanent --add-port="${MINIO_CONSOLE_PORT}/tcp"
      ;;
  esac
  firewall-cmd --reload
  log "Firewalld rules configured"
}

print_ports() {
  echo ""
  info "Required ports:"
  case "$PROVIDER" in
    glusterfs|all)
      info "  GlusterFS:  24007/tcp, 24008/tcp, 49152-49251/tcp"
      ;;
  esac
  case "$PROVIDER" in
    ceph|all)
      info "  Ceph:       6789/tcp (monitor), 6800-7300/tcp (OSD)"
      ;;
  esac
  case "$PROVIDER" in
    minio|all)
      info "  MinIO:      ${MINIO_PORT}/tcp (API), ${MINIO_CONSOLE_PORT}/tcp (Console)"
      ;;
  esac
}

# ── Kernel tuning for storage workloads ───────────────────────────────────
tune_kernel() {
  log "Applying kernel tuning for storage workloads..."

  local SYSCTL_FILE="/etc/sysctl.d/99-fleet-storage.conf"

  cat > "$SYSCTL_FILE" << 'SYSCTL'
# Fleet storage node optimizations

# Increase max file descriptors
fs.file-max = 2097152

# Increase socket buffers for network storage
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.ipv4.tcp_rmem = 4096 1048576 16777216
net.ipv4.tcp_wmem = 4096 1048576 16777216

# Reduce swappiness (prefer RAM over swap for storage I/O)
vm.swappiness = 10

# Increase dirty page ratio for better write batching
vm.dirty_ratio = 40
vm.dirty_background_ratio = 10

# Increase inotify limits for file watchers
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 8192
SYSCTL

  sysctl -p "$SYSCTL_FILE" >/dev/null 2>&1 || warn "Some sysctl settings may not have been applied"
  log "Kernel parameters tuned"
}

# ── Summary ───────────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Fleet Storage Node Setup Complete!${NC}"
  echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Data path:   $DATA_PATH"
  echo "  Provider(s): $PROVIDER"
  echo ""

  case "$PROVIDER" in
    glusterfs|all)
      echo "  GlusterFS:"
      echo "    Status:     $(systemctl is-active glusterd)"
      echo "    Version:    $(gluster --version 2>/dev/null | head -1 || echo 'N/A')"
      echo "    Brick path: ${DATA_PATH}/glusterfs/brick1"
      echo ""
      ;;
  esac

  case "$PROVIDER" in
    ceph|all)
      echo "  Ceph:"
      echo "    Config:     /etc/ceph/ceph.conf"
      echo "    Monitors:   ${CEPH_MONITORS:-'(not configured)'}"
      echo ""
      ;;
  esac

  case "$PROVIDER" in
    minio|all)
      echo "  MinIO:"
      echo "    Status:     $(systemctl is-active minio)"
      echo "    API port:   $MINIO_PORT"
      echo "    Console:    $MINIO_CONSOLE_PORT"
      echo "    Access key: $MINIO_ACCESS_KEY"
      echo "    Secret key: ${MINIO_SECRET_KEY:0:8}..."
      echo "    Config:     /etc/minio/minio.env"
      echo ""
      ;;
  esac

  echo "  Next steps:"
  echo "    1. Go to your Fleet admin panel → Storage → Configure Storage"
  echo "    2. Add this node's IP address to the storage cluster"
  echo "    3. Run the connectivity test from the admin panel"
  echo "    4. Initialize the cluster"
  echo ""
  echo "  If adding to an existing GlusterFS cluster, run on any existing node:"
  echo "    gluster peer probe $(hostname -I | awk '{print $1}')"
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────
main() {
  detect_os
  validate_provider
  prepare_system
  tune_kernel

  case "$PROVIDER" in
    glusterfs)
      install_glusterfs
      ;;
    ceph)
      install_ceph
      ;;
    minio)
      install_minio
      ;;
    all)
      install_glusterfs
      install_ceph
      install_minio
      ;;
  esac

  configure_firewall
  print_summary
}

main
