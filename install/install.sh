#!/usr/bin/env bash
set -euo pipefail

# Hoster — Single-line installer for the first node
# Usage: curl -fsSL https://raw.githubusercontent.com/componentor/hoster/main/install/install.sh | bash

HOSTER_VERSION="${HOSTER_VERSION:-latest}"
HOSTER_DIR="/opt/hoster"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[hoster]${NC} $1"; }
warn() { echo -e "${YELLOW}[hoster]${NC} $1"; }
err()  { echo -e "${RED}[hoster]${NC} $1"; exit 1; }

# ─── Check root ──────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Please run as root: sudo bash install.sh"
fi

echo -e "${BLUE}"
echo '  _   _           _            '
echo ' | | | | ___  ___| |_ ___ _ __ '
echo ' | |_| |/ _ \/ __| __/ _ \ __|'
echo ' |  _  | (_) \__ \ ||  __/ |   '
echo ' |_| |_|\___/|___/\__\___|_|   '
echo -e "${NC}"
echo "  Multi-Tenant PaaS Platform Installer"
echo ""

# ─── Detect OS ───────────────────────────────────────────────────────
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
  else
    err "Unsupported OS. Requires Ubuntu, Debian, Rocky, or CentOS."
  fi
  log "Detected OS: $OS $OS_VERSION"
}

# ─── Install Docker ──────────────────────────────────────────────────
install_docker() {
  if command -v docker &>/dev/null; then
    log "Docker is already installed: $(docker --version)"
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
    *)
      err "Unsupported OS: $OS"
      ;;
  esac

  systemctl enable docker
  systemctl start docker
  log "Docker installed successfully"
}

# ─── Configure Docker Security ───────────────────────────────────────
configure_docker() {
  log "Configuring Docker daemon security..."

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
  "default-ulimits": {
    "nproc": { "Name": "nproc", "Hard": 1024, "Soft": 1024 },
    "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 65536 }
  },
  "live-restore": true,
  "storage-driver": "overlay2"
}
DAEMONJSON

  systemctl restart docker
  log "Docker daemon configured with security hardening"
}

# ─── Install NFS ─────────────────────────────────────────────────────
install_nfs() {
  log "Installing NFS server..."
  case $OS in
    ubuntu|debian)
      apt-get install -y -qq nfs-kernel-server
      ;;
    centos|rocky|rhel|almalinux)
      yum install -y -q nfs-utils
      systemctl enable nfs-server
      systemctl start nfs-server
      ;;
  esac
  log "NFS server installed"
}

# ─── Initialize Swarm ────────────────────────────────────────────────
init_swarm() {
  if docker info 2>/dev/null | grep -q "Swarm: active"; then
    log "Docker Swarm is already active"
    return
  fi

  log "Initializing Docker Swarm..."
  # Auto-detect the public IP for swarm advertising
  ADVERTISE_ADDR=$(ip -4 route get 1.1.1.1 | awk '{print $7; exit}')
  docker swarm init --advertise-addr "$ADVERTISE_ADDR"
  log "Docker Swarm initialized (advertise: $ADVERTISE_ADDR)"
}

# ─── Create directories ──────────────────────────────────────────────
setup_dirs() {
  log "Creating Hoster directories..."
  mkdir -p "$HOSTER_DIR"/{data,certs,backups,nfs-exports,config}
  mkdir -p "$HOSTER_DIR"/nfs-exports/volumes

  # Setup NFS export
  if ! grep -q "$HOSTER_DIR/nfs-exports" /etc/exports 2>/dev/null; then
    echo "$HOSTER_DIR/nfs-exports *(rw,sync,no_subtree_check,no_root_squash)" >> /etc/exports
    exportfs -ra 2>/dev/null || true
  fi
  log "Directories created"
}

# ─── Collect configuration ───────────────────────────────────────────
collect_config() {
  echo ""
  read -rp "$(echo -e ${BLUE}Enter admin email: ${NC})" ADMIN_EMAIL
  read -rsp "$(echo -e ${BLUE}Enter admin password: ${NC})" ADMIN_PASSWORD
  echo ""
  read -rp "$(echo -e ${BLUE}Enter platform domain \(e.g., panel.example.com\): ${NC})" PLATFORM_DOMAIN
  read -rp "$(echo -e ${BLUE}Enter Stripe secret key \(or press Enter to skip\): ${NC})" STRIPE_KEY
  echo ""

  # Generate secrets
  JWT_SECRET=$(openssl rand -hex 32)
  DB_PASSWORD=$(openssl rand -hex 16)
  VALKEY_PASSWORD=$(openssl rand -hex 16)

  # Save config
  cat > "$HOSTER_DIR/config/env" <<EOF
DATABASE_URL=postgresql://hoster:${DB_PASSWORD}@postgres:5432/hoster
VALKEY_URL=redis://:${VALKEY_PASSWORD}@valkey:6379
JWT_SECRET=${JWT_SECRET}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
PLATFORM_DOMAIN=${PLATFORM_DOMAIN}
STRIPE_SECRET_KEY=${STRIPE_KEY}
NODE_ENV=production
PORT=3000
EOF

  log "Configuration saved to $HOSTER_DIR/config/env"
}

# ─── Create Docker networks ──────────────────────────────────────────
create_networks() {
  log "Creating overlay networks..."
  docker network create --driver overlay --attachable hoster_public 2>/dev/null || true
  docker network create --driver overlay --attachable hoster_internal 2>/dev/null || true
  log "Networks ready"
}

# ─── Create seccomp profile for customer containers ─────────────────
create_seccomp_profile() {
  log "Creating seccomp profile for customer containers..."

  cat > "$HOSTER_DIR/config/seccomp-default.json" <<'SECCOMP'
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "defaultErrnoRet": 1,
  "comment": "Hoster PaaS restrictive seccomp profile for customer containers",
  "archMap": [
    {
      "architecture": "SCMP_ARCH_X86_64",
      "subArchitectures": [
        "SCMP_ARCH_X86",
        "SCMP_ARCH_X32"
      ]
    },
    {
      "architecture": "SCMP_ARCH_AARCH64",
      "subArchitectures": [
        "SCMP_ARCH_ARM"
      ]
    }
  ],
  "syscalls": [
    {
      "names": [
        "accept",
        "accept4",
        "access",
        "adjtimex",
        "alarm",
        "bind",
        "brk",
        "capget",
        "capset",
        "chdir",
        "chmod",
        "chown",
        "chown32",
        "clock_getres",
        "clock_gettime",
        "clock_nanosleep",
        "close",
        "close_range",
        "connect",
        "copy_file_range",
        "creat",
        "dup",
        "dup2",
        "dup3",
        "epoll_create",
        "epoll_create1",
        "epoll_ctl",
        "epoll_ctl_old",
        "epoll_pwait",
        "epoll_pwait2",
        "epoll_wait",
        "epoll_wait_old",
        "eventfd",
        "eventfd2",
        "execve",
        "execveat",
        "exit",
        "exit_group",
        "faccessat",
        "faccessat2",
        "fadvise64",
        "fallocate",
        "fanotify_mark",
        "fchdir",
        "fchmod",
        "fchmodat",
        "fchown",
        "fchown32",
        "fchownat",
        "fcntl",
        "fcntl64",
        "fdatasync",
        "fgetxattr",
        "flistxattr",
        "flock",
        "fork",
        "fsetxattr",
        "fstat",
        "fstat64",
        "fstatat64",
        "fstatfs",
        "fstatfs64",
        "fsync",
        "ftruncate",
        "ftruncate64",
        "futex",
        "futex_waitv",
        "futimesat",
        "get_robust_list",
        "get_thread_area",
        "getcpu",
        "getcwd",
        "getdents",
        "getdents64",
        "getegid",
        "getegid32",
        "geteuid",
        "geteuid32",
        "getgid",
        "getgid32",
        "getgroups",
        "getgroups32",
        "getitimer",
        "getpeername",
        "getpgid",
        "getpgrp",
        "getpid",
        "getppid",
        "getpriority",
        "getrandom",
        "getresgid",
        "getresgid32",
        "getresuid",
        "getresuid32",
        "getrlimit",
        "getrusage",
        "getsid",
        "getsockname",
        "getsockopt",
        "gettid",
        "gettimeofday",
        "getuid",
        "getuid32",
        "getxattr",
        "inotify_add_watch",
        "inotify_init",
        "inotify_init1",
        "inotify_rm_watch",
        "io_cancel",
        "io_destroy",
        "io_getevents",
        "io_setup",
        "io_submit",
        "io_uring_enter",
        "io_uring_register",
        "io_uring_setup",
        "ioctl",
        "kill",
        "landlock_add_rule",
        "landlock_create_ruleset",
        "landlock_restrict_self",
        "lchown",
        "lchown32",
        "lgetxattr",
        "link",
        "linkat",
        "listen",
        "listxattr",
        "llistxattr",
        "lseek",
        "lstat",
        "lstat64",
        "madvise",
        "membarrier",
        "memfd_create",
        "memfd_secret",
        "mincore",
        "mkdir",
        "mkdirat",
        "mknod",
        "mknodat",
        "mlock",
        "mlock2",
        "mlockall",
        "mmap",
        "mmap2",
        "mprotect",
        "mremap",
        "msgctl",
        "msgget",
        "msgrcv",
        "msgsnd",
        "msync",
        "munlock",
        "munlockall",
        "munmap",
        "name_to_handle_at",
        "nanosleep",
        "newfstatat",
        "open",
        "openat",
        "openat2",
        "pause",
        "pidfd_open",
        "pidfd_send_signal",
        "pipe",
        "pipe2",
        "pkey_alloc",
        "pkey_free",
        "pkey_mprotect",
        "poll",
        "ppoll",
        "prctl",
        "pread64",
        "preadv",
        "preadv2",
        "prlimit64",
        "pselect6",
        "pwrite64",
        "pwritev",
        "pwritev2",
        "read",
        "readahead",
        "readlink",
        "readlinkat",
        "readv",
        "recv",
        "recvfrom",
        "recvmmsg",
        "recvmsg",
        "remap_file_pages",
        "removexattr",
        "rename",
        "renameat",
        "renameat2",
        "restart_syscall",
        "rmdir",
        "rseq",
        "rt_sigaction",
        "rt_sigpending",
        "rt_sigprocmask",
        "rt_sigqueueinfo",
        "rt_sigreturn",
        "rt_sigsuspend",
        "rt_sigtimedwait",
        "rt_tgsigqueueinfo",
        "sched_get_priority_max",
        "sched_get_priority_min",
        "sched_getaffinity",
        "sched_getattr",
        "sched_getparam",
        "sched_getscheduler",
        "sched_setaffinity",
        "sched_setattr",
        "sched_setparam",
        "sched_setscheduler",
        "sched_yield",
        "seccomp",
        "select",
        "semctl",
        "semget",
        "semop",
        "semtimedop",
        "send",
        "sendfile",
        "sendfile64",
        "sendmmsg",
        "sendmsg",
        "sendto",
        "set_robust_list",
        "set_thread_area",
        "set_tid_address",
        "setfsgid",
        "setfsgid32",
        "setfsuid",
        "setfsuid32",
        "setgid",
        "setgid32",
        "setgroups",
        "setgroups32",
        "setitimer",
        "setpgid",
        "setpriority",
        "setregid",
        "setregid32",
        "setresgid",
        "setresgid32",
        "setresuid",
        "setresuid32",
        "setreuid",
        "setreuid32",
        "setrlimit",
        "setsid",
        "setsockopt",
        "setuid",
        "setuid32",
        "setxattr",
        "shmat",
        "shmctl",
        "shmdt",
        "shmget",
        "shutdown",
        "sigaltstack",
        "signalfd",
        "signalfd4",
        "socket",
        "socketcall",
        "socketpair",
        "splice",
        "stat",
        "stat64",
        "statfs",
        "statfs64",
        "statx",
        "symlink",
        "symlinkat",
        "sync",
        "sync_file_range",
        "syncfs",
        "sysinfo",
        "tee",
        "tgkill",
        "time",
        "timer_create",
        "timer_delete",
        "timer_getoverrun",
        "timer_gettime",
        "timer_settime",
        "timerfd_create",
        "timerfd_gettime",
        "timerfd_settime",
        "times",
        "tkill",
        "truncate",
        "truncate64",
        "ugetrlimit",
        "umask",
        "uname",
        "unlink",
        "unlinkat",
        "utime",
        "utimensat",
        "utimes",
        "vfork",
        "vmsplice",
        "wait4",
        "waitid",
        "waitpid",
        "write",
        "writev"
      ],
      "action": "SCMP_ACT_ALLOW"
    },
    {
      "names": [
        "clone"
      ],
      "action": "SCMP_ACT_ALLOW",
      "args": [
        {
          "index": 0,
          "value": 2114060288,
          "op": "SCMP_CMP_MASKED_EQ"
        }
      ],
      "comment": "Allow clone for threads but block CLONE_NEWUSER (no user namespace escape)"
    },
    {
      "names": [
        "clone3"
      ],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 38,
      "comment": "Block clone3 to prevent user namespace creation"
    },
    {
      "names": [
        "mount",
        "umount",
        "umount2",
        "pivot_root",
        "swapon",
        "swapoff"
      ],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1,
      "comment": "Block filesystem mount operations"
    },
    {
      "names": [
        "ptrace",
        "process_vm_readv",
        "process_vm_writev",
        "kcmp"
      ],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1,
      "comment": "Block process debugging/tracing"
    },
    {
      "names": [
        "reboot",
        "kexec_load",
        "kexec_file_load"
      ],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1,
      "comment": "Block system reboot/kexec"
    },
    {
      "names": [
        "init_module",
        "finit_module",
        "delete_module",
        "create_module"
      ],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1,
      "comment": "Block kernel module operations"
    },
    {
      "names": [
        "acct",
        "bpf",
        "clock_adjtime",
        "clock_settime",
        "lookup_dcookie",
        "mount_setattr",
        "move_mount",
        "open_tree",
        "perf_event_open",
        "quotactl",
        "quotactl_fd",
        "setdomainname",
        "sethostname",
        "settimeofday",
        "syslog",
        "unshare",
        "userfaultfd",
        "vm86",
        "vm86old",
        "nfsservctl",
        "personality",
        "add_key",
        "keyctl",
        "request_key"
      ],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1,
      "comment": "Block various privileged operations"
    }
  ]
}
SECCOMP

  chmod 0644 "$HOSTER_DIR/config/seccomp-default.json"
  log "Seccomp profile created at $HOSTER_DIR/config/seccomp-default.json"
}

# ─── Deploy stack ────────────────────────────────────────────────────
deploy_stack() {
  log "Deploying Hoster stack..."

  local STACK_URL="https://raw.githubusercontent.com/componentor/hoster/${HOSTER_VERSION}/docker/docker-stack.yml"
  local TRAEFIK_URL="https://raw.githubusercontent.com/componentor/hoster/${HOSTER_VERSION}/docker/traefik/traefik.yml"
  local STACK_DIR="$HOSTER_DIR"
  local TRAEFIK_DIR="$HOSTER_DIR/traefik"

  mkdir -p "$TRAEFIK_DIR"

  # Download production stack files
  log "Downloading stack files..."
  if ! curl -fsSL "$STACK_URL" -o "$STACK_DIR/docker-stack.yml"; then
    err "Failed to download docker-stack.yml from $STACK_URL"
  fi
  if ! curl -fsSL "$TRAEFIK_URL" -o "$TRAEFIK_DIR/traefik.yml"; then
    err "Failed to download traefik.yml from $TRAEFIK_URL"
  fi

  # Source the env file to get variables for substitution
  set -a
  # shellcheck disable=SC1091
  source "$HOSTER_DIR/config/env"
  set +a

  # Extract VALKEY_PASSWORD from the VALKEY_URL
  VALKEY_PASSWORD=$(echo "$VALKEY_URL" | sed -n 's|redis://:\([^@]*\)@.*|\1|p')
  export VALKEY_PASSWORD

  # Extract ACME_EMAIL from ADMIN_EMAIL if not set
  ACME_EMAIL="${ACME_EMAIL:-$ADMIN_EMAIL}"
  export ACME_EMAIL

  # Substitute the ACME email in the Traefik config
  sed -i "s|\${ACME_EMAIL}|${ACME_EMAIL}|g" "$TRAEFIK_DIR/traefik.yml"

  # Add additional env vars to config file for services
  if ! grep -q "^POSTGRES_PASSWORD=" "$HOSTER_DIR/config/env"; then
    DB_PASSWORD=$(echo "$DATABASE_URL" | sed -n 's|postgresql://hoster:\([^@]*\)@.*|\1|p')
    cat >> "$HOSTER_DIR/config/env" <<EOF
POSTGRES_USER=hoster
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=hoster
VALKEY_PASSWORD=${VALKEY_PASSWORD}
HOSTER_VERSION=${HOSTER_VERSION}
EOF
  fi

  # Deploy the stack
  log "Deploying Docker Swarm stack..."
  cd "$STACK_DIR"
  env HOSTER_VERSION="$HOSTER_VERSION" \
      PLATFORM_DOMAIN="$PLATFORM_DOMAIN" \
      VALKEY_PASSWORD="$VALKEY_PASSWORD" \
    docker stack deploy \
      -c docker-stack.yml \
      --with-registry-auth \
      hoster

  # Wait for services to converge
  log "Waiting for services to start..."
  local MAX_WAIT=120
  local WAITED=0
  local INTERVAL=5

  while [ $WAITED -lt $MAX_WAIT ]; do
    sleep $INTERVAL
    WAITED=$((WAITED + INTERVAL))

    # Check how many services are fully replicated
    local TOTAL
    TOTAL=$(docker stack services hoster --format "{{.Name}}" 2>/dev/null | wc -l | tr -d ' ')
    local READY
    READY=$(docker stack services hoster --format "{{.Replicas}}" 2>/dev/null | grep -c '/' | tr -d ' ')
    local CONVERGED
    CONVERGED=$(docker stack services hoster --format "{{.Replicas}}" 2>/dev/null | awk -F'/' '$1==$2 && $1>0' | wc -l | tr -d ' ')

    log "  Services: ${CONVERGED}/${TOTAL} ready (${WAITED}s elapsed)"

    if [ "$CONVERGED" -eq "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
      log "All services are running!"
      break
    fi
  done

  if [ $WAITED -ge $MAX_WAIT ]; then
    warn "Some services may not have started within ${MAX_WAIT}s."
    warn "Check status with: docker stack services hoster"
  fi

  # Show final service status
  log "Stack service status:"
  docker stack services hoster 2>/dev/null || true
}

# ─── Main ────────────────────────────────────────────────────────────
main() {
  detect_os
  install_docker
  configure_docker
  install_nfs
  init_swarm
  setup_dirs
  collect_config
  create_networks
  create_seccomp_profile
  deploy_stack

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  ✅ Hoster installed successfully!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Platform:    https://${PLATFORM_DOMAIN}"
  echo "  Admin email: ${ADMIN_EMAIL}"
  echo "  Traefik:     http://$(hostname -I | awk '{print $1}'):8080"
  echo ""
  echo "  To add more nodes, run on each new server:"
  echo "  curl -fsSL https://raw.githubusercontent.com/componentor/hoster/main/install/join.sh | bash"
  echo ""
  echo "  Join token:"
  docker swarm join-token worker -q 2>/dev/null || echo "  (run 'docker swarm join-token worker' to get the token)"
  echo ""
}

main "$@"
