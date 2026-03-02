# Fleet Installation Guide — GCP 3-Node HA Cluster

Production deployment guide for Fleet on Google Cloud Platform with 3 manager nodes, Docker Swarm HA, shared NFS storage, and Cloudflare DNS failover.

---

## Architecture Overview

```
                     ┌──────────────────────┐
                     │     Cloudflare DNS    │
                     │  (IP failover / LB)   │
                     └──────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
     ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
     │   Node 1 (mgr) │ │   Node 2 (mgr) │ │   Node 3 (mgr) │
     │  e2-standard-2 │ │  e2-standard-2 │ │  e2-standard-2 │
     │  100 GB SSD    │ │  100 GB SSD    │ │  100 GB SSD    │
     │                │ │                │ │                │
     │ • Traefik      │ │ • Traefik      │ │ • Traefik      │
     │ • Fleet API    │ │ • Fleet API    │ │ • Fleet API    │
     │ • Dashboard    │ │ • Dashboard    │ │ • Dashboard    │
     │ • PostgreSQL   │ │ • (PG replica) │ │ • (PG replica) │
     │ • Valkey       │ │ • (VK replica) │ │ • (VK replica) │
     │ • NFS Server   │ │ • NFS Client   │ │ • NFS Client   │
     │ • Registry     │ │ • Agent        │ │ • Agent        │
     │ • Agent        │ │ • User Svcs    │ │ • User Svcs    │
     │ • User Svcs    │ │                │ │                │
     └────────────────┘ └────────────────┘ └────────────────┘

     Optional:
     ┌────────────────┐
     │   Node 4 (wkr) │  ← Compute-only, smaller disk
     │  e2-standard-2 │
     │  50 GB SSD     │
     │                │
     │ • NFS Client   │
     │ • Agent        │
     │ • User Svcs    │
     └────────────────┘
```

**Failover behavior**: If 1 or 2 manager nodes go down, the remaining node(s) automatically take over. Docker Swarm requires a majority (2 of 3) for write operations, but a single surviving manager continues serving existing workloads. Cloudflare detects the failure and routes traffic to the healthy node(s).

---

## Prerequisites

- Google Cloud account with billing enabled
- A domain name pointed at Cloudflare (free plan is fine)
- `gcloud` CLI installed locally ([install guide](https://cloud.google.com/sdk/docs/install))
- SSH access to created VMs

---

## Step 1: Create GCP Infrastructure

### 1.1 Set Project and Region

```bash
# Set your project
gcloud config set project YOUR_PROJECT_ID

# Choose a region (pick one close to your users)
export GCP_REGION=europe-north1
export GCP_ZONE_A=${GCP_REGION}-a
export GCP_ZONE_B=${GCP_REGION}-b
export GCP_ZONE_C=${GCP_REGION}-c
```

### 1.2 Create Firewall Rules

```bash
# Allow HTTP/HTTPS from anywhere
gcloud compute firewall-rules create fleet-web \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=fleet-node \
  --description="Fleet web traffic (HTTP/HTTPS)"

# Allow Docker Swarm communication between nodes
gcloud compute firewall-rules create fleet-swarm \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:2377,tcp:7946,udp:7946,udp:4789 \
  --source-tags=fleet-node \
  --target-tags=fleet-node \
  --description="Docker Swarm inter-node communication"

# Allow NFS between nodes
gcloud compute firewall-rules create fleet-nfs \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:111,tcp:2049,udp:111,udp:2049 \
  --source-tags=fleet-node \
  --target-tags=fleet-node \
  --description="NFS file sharing between nodes"

# Allow SSH gateway (optional, for user SSH access to containers)
gcloud compute firewall-rules create fleet-ssh \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:2222 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=fleet-node \
  --description="Fleet SSH gateway"
```

### 1.3 Create the 3 Manager Nodes

Spread across availability zones for maximum resilience:

```bash
# Node 1 — Primary manager (Zone A)
gcloud compute instances create fleet-mgr-1 \
  --zone=$GCP_ZONE_A \
  --machine-type=e2-standard-2 \
  --boot-disk-size=100GB \
  --boot-disk-type=pd-ssd \
  --image-project=ubuntu-os-cloud \
  --image-family=ubuntu-2404-lts-amd64 \
  --tags=fleet-node \
  --metadata=startup-script='#!/bin/bash
apt-get update -qq && apt-get upgrade -y -qq'

# Node 2 — Manager (Zone B)
gcloud compute instances create fleet-mgr-2 \
  --zone=$GCP_ZONE_B \
  --machine-type=e2-standard-2 \
  --boot-disk-size=100GB \
  --boot-disk-type=pd-ssd \
  --image-project=ubuntu-os-cloud \
  --image-family=ubuntu-2404-lts-amd64 \
  --tags=fleet-node \
  --metadata=startup-script='#!/bin/bash
apt-get update -qq && apt-get upgrade -y -qq'

# Node 3 — Manager (Zone C)
gcloud compute instances create fleet-mgr-3 \
  --zone=$GCP_ZONE_C \
  --machine-type=e2-standard-2 \
  --boot-disk-size=100GB \
  --boot-disk-type=pd-ssd \
  --image-project=ubuntu-os-cloud \
  --image-family=ubuntu-2404-lts-amd64 \
  --tags=fleet-node \
  --metadata=startup-script='#!/bin/bash
apt-get update -qq && apt-get upgrade -y -qq'
```

### 1.4 (Optional) Create Compute-Only Worker Node

```bash
# Node 4 — Worker only (smaller disk, any zone)
gcloud compute instances create fleet-worker-1 \
  --zone=$GCP_ZONE_A \
  --machine-type=e2-standard-2 \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-ssd \
  --image-project=ubuntu-os-cloud \
  --image-family=ubuntu-2404-lts-amd64 \
  --tags=fleet-node \
  --metadata=startup-script='#!/bin/bash
apt-get update -qq && apt-get upgrade -y -qq'
```

### 1.5 Get the IP Addresses

```bash
# Get external IPs (you'll need these for Cloudflare and Swarm)
gcloud compute instances list --filter="tags.items=fleet-node" \
  --format="table(name, zone, networkInterfaces[0].accessConfigs[0].natIP, networkInterfaces[0].networkIP)"
```

Save these IPs — you'll reference them throughout this guide:

```bash
export NODE1_EXTERNAL_IP=<fleet-mgr-1 external IP>
export NODE2_EXTERNAL_IP=<fleet-mgr-2 external IP>
export NODE3_EXTERNAL_IP=<fleet-mgr-3 external IP>
export NODE1_INTERNAL_IP=<fleet-mgr-1 internal IP>
export NODE2_INTERNAL_IP=<fleet-mgr-2 internal IP>
export NODE3_INTERNAL_IP=<fleet-mgr-3 internal IP>
```

---

## Step 2: Install Fleet on Node 1 (Primary)

SSH into Node 1:

```bash
gcloud compute ssh fleet-mgr-1 --zone=$GCP_ZONE_A
```

### 2.1 Run the Fleet Installer

**If the repo is public:**

```bash
curl -fsSL https://raw.githubusercontent.com/componentor/fleet/main/install/install.sh | sudo bash
```

**If the repo is private:**

Copy the install script to the server and run it with a [GitHub Personal Access Token](https://github.com/settings/tokens) (needs `repo` and `read:packages` scopes):

```bash
# From your local machine
scp install/install.sh root@<NODE1_EXTERNAL_IP>:/tmp/

# On the server
sudo GITHUB_TOKEN=ghp_your_token_here bash /tmp/install.sh
```

> **Note:** The `GITHUB_TOKEN` is saved to `/opt/fleet/config/env` so the auto-updater can check for new releases and pull updates from the private repo. You can also set it later in the config file.

The installer will:
1. Install Docker, NFS server, and system dependencies
2. Configure Docker security hardening
3. Initialize Docker Swarm
4. Ask for your admin email, password, and domain
5. Generate all secrets (JWT, encryption key, DB password, etc.)
6. Deploy the Fleet stack

**When prompted:**
- **Admin email**: Your super admin email
- **Admin password**: Strong password for the admin account
- **Platform domain**: e.g., `fleet.yourdomain.com`
- **Stripe key**: Press Enter to skip (can configure later in admin UI)

### 2.2 Save the Swarm Join Tokens

After the installer completes, save the join tokens for the other nodes:

```bash
# Manager join token (for nodes 2 and 3)
sudo docker swarm join-token manager
# Copy the entire "docker swarm join --token ..." command

# Worker join token (for node 4, if adding)
sudo docker swarm join-token worker
# Copy the entire "docker swarm join --token ..." command
```

### 2.3 Verify Node 1 is Running

```bash
sudo docker node ls
sudo docker stack services fleet
```

You should see all Fleet services starting up.

---

## Step 3: Join Nodes 2 and 3 as Managers

SSH into each node and run the same base setup, then join the swarm.

### On Node 2:

```bash
gcloud compute ssh fleet-mgr-2 --zone=$GCP_ZONE_B
```

```bash
# Install Docker and dependencies
sudo apt-get update -qq
sudo apt-get install -y -qq \
  ca-certificates curl wget gnupg lsb-release \
  openssl git tar gzip unzip xz-utils \
  jq htop net-tools nfs-common

# Install Docker
curl -fsSL https://get.docker.com | sudo sh

# Configure Docker daemon
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "no-new-privileges": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "default-ulimits": {
    "nproc": { "Name": "nproc", "Hard": 1024, "Soft": 1024 },
    "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 65536 }
  },
  "storage-driver": "overlay2"
}
EOF
sudo systemctl restart docker

# Join the swarm as a manager (paste the command from Step 2.2)
sudo docker swarm join --token <MANAGER_TOKEN> <NODE1_INTERNAL_IP>:2377
```

### On Node 3:

```bash
gcloud compute ssh fleet-mgr-3 --zone=$GCP_ZONE_C
```

Run the exact same commands as Node 2, using the same manager join token.

### Verify All Managers

Back on Node 1:

```bash
sudo docker node ls
```

You should see 3 nodes, all with `Status: Ready` and `Manager Status: Leader/Reachable`:

```
ID            HOSTNAME      STATUS   AVAILABILITY   MANAGER STATUS
abc123 *      fleet-mgr-1   Ready    Active         Leader
def456        fleet-mgr-2   Ready    Active         Reachable
ghi789        fleet-mgr-3   Ready    Active         Reachable
```

---

## Step 4: Set Up NFS Shared Storage

NFS shares uploads, backups, and build artifacts across all nodes. Node 1 acts as the NFS server; nodes 2, 3, and 4 mount it.

### 4.1 On Node 1 (NFS Server)

The installer already set up NFS. Verify and expand the exports for all node IPs:

```bash
# Edit NFS exports to allow all nodes
sudo tee /etc/exports <<EOF
/opt/fleet/nfs-exports ${NODE1_INTERNAL_IP}/32(rw,sync,no_subtree_check,no_root_squash)
/opt/fleet/nfs-exports ${NODE2_INTERNAL_IP}/32(rw,sync,no_subtree_check,no_root_squash)
/opt/fleet/nfs-exports ${NODE3_INTERNAL_IP}/32(rw,sync,no_subtree_check,no_root_squash)
EOF

# If you have a 4th node, add its IP too:
# echo "/opt/fleet/nfs-exports ${NODE4_INTERNAL_IP}/32(rw,sync,no_subtree_check,no_root_squash)" | sudo tee -a /etc/exports

sudo exportfs -ra
sudo systemctl restart nfs-kernel-server

# Verify exports
sudo exportfs -v
```

### 4.2 On Nodes 2, 3 (and 4 if applicable)

Mount the NFS share on each additional node:

```bash
# Create the mount point
sudo mkdir -p /opt/fleet/nfs-exports

# Mount NFS from Node 1
sudo mount -t nfs ${NODE1_INTERNAL_IP}:/opt/fleet/nfs-exports /opt/fleet/nfs-exports

# Make it persistent across reboots
echo "${NODE1_INTERNAL_IP}:/opt/fleet/nfs-exports /opt/fleet/nfs-exports nfs defaults,_netdev 0 0" | sudo tee -a /etc/fstab

# Verify the mount
df -h /opt/fleet/nfs-exports
ls /opt/fleet/nfs-exports/
```

### 4.3 Copy Fleet Config to All Nodes

The Fleet config from Node 1 needs to be on all nodes (for the agent and stack services):

```bash
# On Node 1 — copy config to NFS so other nodes can access it
sudo cp -r /opt/fleet/config /opt/fleet/nfs-exports/config

# On Nodes 2 and 3 — create the local config directory and symlink
sudo mkdir -p /opt/fleet
sudo ln -sf /opt/fleet/nfs-exports/config /opt/fleet/config
```

Alternatively, `scp` the config files directly:

```bash
# From Node 1
sudo scp -r /opt/fleet/config/* fleet-mgr-2:/opt/fleet/config/
sudo scp -r /opt/fleet/config/* fleet-mgr-3:/opt/fleet/config/
```

---

## Step 5: (Optional) Add Worker Node 4

SSH into Node 4:

```bash
gcloud compute ssh fleet-worker-1 --zone=$GCP_ZONE_A
```

```bash
# Install Docker and dependencies (same as Step 3)
sudo apt-get update -qq
sudo apt-get install -y -qq \
  ca-certificates curl wget gnupg lsb-release \
  openssl git tar gzip unzip xz-utils \
  jq htop net-tools nfs-common

curl -fsSL https://get.docker.com | sudo sh

sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "no-new-privileges": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "default-ulimits": {
    "nproc": { "Name": "nproc", "Hard": 1024, "Soft": 1024 },
    "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 65536 }
  },
  "storage-driver": "overlay2"
}
EOF
sudo systemctl restart docker

# Join as a WORKER (not manager) — use the worker token from Step 2.2
sudo docker swarm join --token <WORKER_TOKEN> <NODE1_INTERNAL_IP>:2377

# Mount NFS
sudo mkdir -p /opt/fleet/nfs-exports
sudo mount -t nfs ${NODE1_INTERNAL_IP}:/opt/fleet/nfs-exports /opt/fleet/nfs-exports
echo "${NODE1_INTERNAL_IP}:/opt/fleet/nfs-exports /opt/fleet/nfs-exports nfs defaults,_netdev 0 0" | sudo tee -a /etc/fstab

# Copy config
sudo mkdir -p /opt/fleet
sudo ln -sf /opt/fleet/nfs-exports/config /opt/fleet/config
```

Verify from Node 1:

```bash
sudo docker node ls
# Should show 4 nodes: 3 managers + 1 worker
```

---

## Step 6: Label Nodes

Label nodes for service placement control:

```bash
# On Node 1 — label all nodes
# Get node IDs
sudo docker node ls

# Label managers
sudo docker node update --label-add role=manager --label-add zone=a $(docker node ls -q -f name=fleet-mgr-1)
sudo docker node update --label-add role=manager --label-add zone=b $(docker node ls -q -f name=fleet-mgr-2)
sudo docker node update --label-add role=manager --label-add zone=c $(docker node ls -q -f name=fleet-mgr-3)

# Label worker (if applicable)
sudo docker node update --label-add role=worker --label-add zone=a $(docker node ls -q -f name=fleet-worker-1)
```

---

## Step 7: Configure Cloudflare DNS Failover

### 7.1 Add Your Domain to Cloudflare

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Add your domain if not already added
3. Ensure nameservers are pointed to Cloudflare

### 7.2 Create DNS Records for Each Node

Create A records for the Fleet subdomain, one per manager node:

| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| A | fleet | `<NODE1_EXTERNAL_IP>` | Proxied (orange cloud) | Auto |
| A | fleet | `<NODE2_EXTERNAL_IP>` | Proxied (orange cloud) | Auto |
| A | fleet | `<NODE3_EXTERNAL_IP>` | Proxied (orange cloud) | Auto |

With multiple A records and Cloudflare proxy enabled, Cloudflare will:
- Load balance traffic across all 3 nodes
- Automatically remove unhealthy nodes from rotation
- Provide DDoS protection and SSL termination at the edge

### 7.3 Cloudflare SSL Settings

Go to **SSL/TLS** in the Cloudflare dashboard:

1. Set SSL mode to **Full (strict)**
   - Cloudflare terminates SSL at the edge
   - Traefik provides the origin SSL certificate via Let's Encrypt
2. Enable **Always Use HTTPS**
3. Set **Minimum TLS Version** to 1.2

### 7.4 (Recommended) Set Up Cloudflare Health Checks

For automatic failover, set up health checks. Go to **Traffic > Load Balancing** (requires Cloudflare paid plan) or use the free-tier approach:

**Free tier (multiple A records):**
- Cloudflare automatically distributes requests across multiple A records
- If a node becomes unreachable, Cloudflare will eventually stop routing to it
- Recovery time: 1-5 minutes

**Paid tier (Load Balancer with health checks):**

1. Go to **Traffic > Load Balancing**
2. Create a pool named `fleet-managers`:
   - Origin 1: `fleet-mgr-1` = `<NODE1_EXTERNAL_IP>`, weight 1
   - Origin 2: `fleet-mgr-2` = `<NODE2_EXTERNAL_IP>`, weight 1
   - Origin 3: `fleet-mgr-3` = `<NODE3_EXTERNAL_IP>`, weight 1
   - Health check: `GET /health`, expected code 200, interval 15s
3. Create a load balancer for `fleet.yourdomain.com` using the pool
4. Steering policy: **Failover** (or **Random** for even distribution)

### 7.5 Update Fleet Config for Cloudflare Proxy

Since Cloudflare proxies requests, Fleet needs to trust the proxy headers. On Node 1:

```bash
# Add TRUST_PROXY to the Fleet config
echo "TRUST_PROXY=1" | sudo tee -a /opt/fleet/config/env

# Redeploy the stack to pick up the change
sudo docker stack deploy -c /opt/fleet/docker-stack.yml fleet
```

---

## Step 8: Configure SSL (Let's Encrypt via Traefik)

Traefik is deployed globally on all manager nodes and handles SSL automatically.

### 8.1 Verify Traefik is Running

```bash
sudo docker service ls | grep traefik
# Should show mode=global, replicas=3/3
```

### 8.2 Certificate Storage

Traefik stores Let's Encrypt certificates in `/opt/fleet/certs/acme.json` on the NFS share, so all nodes share the same certificates.

```bash
# Ensure the certs directory exists and is on NFS
sudo mkdir -p /opt/fleet/certs
# The acme.json file is created automatically by Traefik
```

### 8.3 Cloudflare + Traefik SSL

With Cloudflare proxying enabled (orange cloud), the SSL chain is:

```
User → Cloudflare Edge (SSL) → Your Node (Let's Encrypt SSL) → Fleet API
```

This is the **Full (strict)** mode — both hops are encrypted.

**Important**: If you use Cloudflare's proxy, Traefik's HTTP challenge for Let's Encrypt may not work because Cloudflare intercepts port 80. Two solutions:

**Option A: Use Cloudflare DNS challenge (recommended)**

Edit the Traefik config to use DNS challenge instead of HTTP:

```bash
# On Node 1, update the Traefik config
sudo tee /opt/fleet/traefik.yml <<'EOF'
api:
  dashboard: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
    http:
      tls:
        certResolver: letsencrypt

providers:
  docker:
    swarmMode: true
    exposedByDefault: false
    network: fleet_public

certificatesResolvers:
  letsencrypt:
    acme:
      email: "your-email@example.com"
      storage: /certs/acme.json
      dnsChallenge:
        provider: cloudflare

log:
  level: INFO

accessLog: {}
EOF
```

Add your Cloudflare API token to the Fleet config:

```bash
echo "CF_DNS_API_TOKEN=your-cloudflare-api-token" | sudo tee -a /opt/fleet/config/env
```

**Option B: Temporarily disable Cloudflare proxy**

Set the DNS record to "DNS only" (grey cloud), let Traefik obtain the certificate via HTTP challenge, then re-enable the proxy. The certificate will auto-renew.

---

## Step 9: Verify the Deployment

### 9.1 Check All Services

```bash
# All Fleet stack services should be running
sudo docker stack services fleet

# Expected output (all replicas should match):
# fleet_api         replicated   3/3
# fleet_dashboard   replicated   3/3
# fleet_postgres    replicated   1/1
# fleet_valkey      replicated   1/1
# fleet_traefik     global       3/3
# fleet_registry    replicated   1/1
# fleet_agent       global       3/3 (or 4/4)
# fleet_ssh-gateway replicated   3/3
```

### 9.2 Test Health Endpoint

```bash
# From any node
curl -s http://localhost:3000/health | jq .

# From outside (via your domain)
curl -s https://fleet.yourdomain.com/health | jq .
```

### 9.3 Access the Dashboard

Open `https://fleet.yourdomain.com` in your browser. The setup wizard will appear on first visit if not already completed during install.

### 9.4 Test Failover

```bash
# On Node 2, stop Docker to simulate failure
gcloud compute ssh fleet-mgr-2 --zone=$GCP_ZONE_B -- "sudo systemctl stop docker"

# From Node 1, check the cluster
sudo docker node ls
# Node 2 should show "Status: Down"

# Verify the dashboard is still accessible
curl -s https://fleet.yourdomain.com/health

# Restart Node 2
gcloud compute ssh fleet-mgr-2 --zone=$GCP_ZONE_B -- "sudo systemctl start docker"
```

---

## Step 10: Post-Installation Configuration

### 10.1 Super Admin Settings

Log in to the dashboard and go to **Admin > Settings** to configure:

- **Email**: SMTP or Resend credentials for transactional emails
- **GitHub OAuth**: Client ID/Secret for GitHub login and Git deploy
- **Google OAuth**: Client ID/Secret for Google login
- **Billing**: Stripe secret key and webhook secret
- **DNS**: Cloudflare API token and zone ID for automatic DNS

### 10.2 Configure Stripe Webhooks

If using billing, set up Stripe webhooks:

1. Go to [Stripe Dashboard > Developers > Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://fleet.yourdomain.com/api/v1/billing/webhook`
3. Select events: `checkout.session.completed`, `customer.subscription.*`, `invoice.*`
4. Copy the webhook signing secret to Fleet admin settings

### 10.3 Set Up Automated Backups

In the admin dashboard under **Backups**, configure:
- Backup schedules (daily recommended)
- Retention policy (30 days default)
- Storage backend (local NFS or S3-compatible)

---

## NFS High Availability Note

In this setup, Node 1 is the single NFS server. If Node 1 goes down:
- Docker Swarm re-schedules containers to Nodes 2 and 3
- Existing running containers continue until they need NFS access
- New deployments and uploads will fail until NFS is restored

**To improve NFS resilience**, consider one of these approaches:

### Option A: GlusterFS (recommended for 3+ nodes)

Replace NFS with GlusterFS replicated storage across all 3 managers:

```bash
# On each node
sudo apt-get install -y glusterfs-server
sudo systemctl enable --now glusterd

# On Node 1 — peer with other nodes
sudo gluster peer probe ${NODE2_INTERNAL_IP}
sudo gluster peer probe ${NODE3_INTERNAL_IP}

# Create a replicated volume
sudo mkdir -p /data/brick
sudo gluster volume create fleet-data replica 3 \
  ${NODE1_INTERNAL_IP}:/data/brick \
  ${NODE2_INTERNAL_IP}:/data/brick \
  ${NODE3_INTERNAL_IP}:/data/brick
sudo gluster volume start fleet-data

# Mount on all nodes
sudo mkdir -p /opt/fleet/nfs-exports
sudo mount -t glusterfs localhost:/fleet-data /opt/fleet/nfs-exports
echo "localhost:/fleet-data /opt/fleet/nfs-exports glusterfs defaults,_netdev 0 0" | sudo tee -a /etc/fstab
```

### Option B: Google Filestore (managed NFS)

Use GCP's managed NFS service:

```bash
gcloud filestore instances create fleet-storage \
  --zone=$GCP_ZONE_A \
  --tier=BASIC_SSD \
  --file-share=name=fleet,capacity=100GB \
  --network=name=default

# Mount on all nodes
sudo mkdir -p /opt/fleet/nfs-exports
sudo mount <FILESTORE_IP>:/fleet /opt/fleet/nfs-exports
```

---

## Monitoring with Prometheus + Grafana

Fleet exposes Docker and node metrics that Prometheus can scrape. This section sets up a monitoring stack on your Swarm cluster.

### 1. Create Prometheus Config

On Node 1, create the Prometheus configuration:

```bash
sudo mkdir -p /opt/fleet/prometheus
sudo tee /opt/fleet/prometheus/prometheus.yml > /dev/null <<'YAML'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  # Prometheus self-monitoring
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  # Docker daemon metrics (enable in daemon.json)
  - job_name: 'docker'
    static_configs:
      - targets:
          - 'node1:9323'
          - 'node2:9323'
          - 'node3:9323'

  # Node Exporter — system-level metrics (CPU, RAM, disk, network)
  - job_name: 'node-exporter'
    static_configs:
      - targets:
          - 'node1:9100'
          - 'node2:9100'
          - 'node3:9100'

  # cAdvisor — per-container resource usage
  - job_name: 'cadvisor'
    static_configs:
      - targets:
          - 'node1:8080'
          - 'node2:8080'
          - 'node3:8080'

  # Traefik metrics (already exposed on :8082 by Fleet's Traefik config)
  - job_name: 'traefik'
    static_configs:
      - targets:
          - 'node1:8082'
          - 'node2:8082'
          - 'node3:8082'
YAML
```

> Replace `node1`, `node2`, `node3` with internal IPs or hostnames.

### 2. Enable Docker Daemon Metrics

On **each node**, add `"metrics-addr"` to `/etc/docker/daemon.json`:

```bash
sudo tee /etc/docker/daemon.json > /dev/null <<'JSON'
{
  "metrics-addr": "0.0.0.0:9323",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  }
}
JSON
sudo systemctl restart docker
```

### 3. Deploy Monitoring Stack

Create a Docker Compose file for the monitoring stack:

```bash
sudo tee /opt/fleet/docker-compose.monitoring.yml > /dev/null <<'YAML'
version: "3.8"

services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - /opt/fleet/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
      - '--web.enable-lifecycle'
    ports:
      - "9090:9090"
    deploy:
      placement:
        constraints:
          - node.role == manager
      replicas: 1
      resources:
        limits:
          memory: 512M
    networks:
      - monitoring

  node-exporter:
    image: prom/node-exporter:latest
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--path.rootfs=/rootfs'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    ports:
      - "9100:9100"
    deploy:
      mode: global
    networks:
      - monitoring

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
    ports:
      - "8080:8080"
    deploy:
      mode: global
      resources:
        limits:
          memory: 128M
    networks:
      - monitoring

  grafana:
    image: grafana/grafana:latest
    volumes:
      - grafana_data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-admin}
      - GF_USERS_ALLOW_SIGN_UP=false
      - GF_SERVER_ROOT_URL=https://grafana.${PLATFORM_DOMAIN}
    ports:
      - "3001:3000"
    deploy:
      placement:
        constraints:
          - node.role == manager
      replicas: 1
      resources:
        limits:
          memory: 256M
    networks:
      - monitoring

volumes:
  prometheus_data:
  grafana_data:

networks:
  monitoring:
    driver: overlay
YAML
```

### 4. Deploy the Stack

```bash
# Set a secure Grafana password
export GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 24)
echo "Grafana admin password: ${GRAFANA_ADMIN_PASSWORD}"

# Deploy
sudo docker stack deploy -c /opt/fleet/docker-compose.monitoring.yml monitoring
```

### 5. Verify

```bash
# Check services are running
sudo docker service ls | grep monitoring

# Test Prometheus targets page
curl -s http://localhost:9090/api/v1/targets | python3 -m json.tool | head -30

# Test Grafana
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/login
```

### 6. Configure Grafana

1. Open Grafana at `http://<NODE_IP>:3001` (or add a Traefik route for `grafana.yourdomain.com`)
2. Log in with `admin` / the password you set
3. Add Prometheus as a data source:
   - URL: `http://prometheus:9090`
   - Access: Server (default)
4. Import recommended dashboards:
   - **Docker Swarm**: Dashboard ID `11467`
   - **Node Exporter Full**: Dashboard ID `1860`
   - **cAdvisor**: Dashboard ID `14282`
   - **Traefik**: Dashboard ID `17346`

### 7. (Optional) Expose Grafana via Traefik

Add labels to the Grafana service for HTTPS access:

```bash
sudo docker service update \
  --label-add "traefik.enable=true" \
  --label-add "traefik.http.routers.grafana.rule=Host(\`grafana.${PLATFORM_DOMAIN}\`)" \
  --label-add "traefik.http.routers.grafana.entrypoints=websecure" \
  --label-add "traefik.http.routers.grafana.tls.certresolver=letsencrypt" \
  --label-add "traefik.http.services.grafana.loadbalancer.server.port=3000" \
  --network-add fleet_proxy \
  monitoring_grafana
```

### 8. Alerting (Optional)

Add alert rules to Prometheus for critical conditions:

```bash
sudo tee /opt/fleet/prometheus/alert-rules.yml > /dev/null <<'YAML'
groups:
  - name: fleet-alerts
    rules:
      - alert: NodeDown
        expr: up{job="node-exporter"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Node {{ $labels.instance }} is down"

      - alert: HighCPU
        expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU on {{ $labels.instance }}: {{ $value }}%"

      - alert: HighMemory
        expr: (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 > 90
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory on {{ $labels.instance }}: {{ $value }}%"

      - alert: DiskSpaceLow
        expr: (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Disk space low on {{ $labels.instance }}: {{ $value }}% used"

      - alert: ContainerRestarting
        expr: rate(container_last_seen{name=~"fleet_.*"}[5m]) > 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Container {{ $labels.name }} is restarting frequently"

      - alert: SwarmNodeNotReady
        expr: swarm_node_info{status!="ready"} == 1
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Swarm node {{ $labels.hostname }} is not ready"
YAML
```

Then update Prometheus config to load the rules:

```bash
# Add to prometheus.yml under global:
#   rule_files:
#     - /etc/prometheus/alert-rules.yml

# Mount the rules file in the stack
sudo docker service update \
  --mount-add type=bind,source=/opt/fleet/prometheus/alert-rules.yml,target=/etc/prometheus/alert-rules.yml,readonly \
  monitoring_prometheus

# Reload Prometheus config
curl -X POST http://localhost:9090/-/reload
```

### GCP Firewall for Monitoring

The monitoring ports should **not** be exposed externally. Use GCP firewall rules to restrict access:

```bash
# Only allow monitoring ports on internal network
gcloud compute firewall-rules create fleet-monitoring \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:9090,tcp:9100,tcp:9323,tcp:8080,tcp:3001 \
  --source-ranges="10.128.0.0/9" \
  --target-tags=fleet-node \
  --description="Fleet monitoring stack (internal only)"
```

To access Grafana from your local machine, use SSH tunneling:

```bash
gcloud compute ssh fleet-node-1 -- -L 3001:localhost:3001
# Then open http://localhost:3001 in your browser
```

---

## Cost Estimate (GCP)

| Resource | Spec | Monthly Cost (approx) |
|----------|------|----------------------|
| 3x e2-standard-2 (manager) | 2 vCPU, 8 GB RAM, 100 GB SSD each | ~$150 ($50/node) |
| 1x e2-standard-2 (worker) | 2 vCPU, 8 GB RAM, 50 GB SSD | ~$45 |
| Network egress | ~100 GB/month | ~$10 |
| **Total (3 nodes)** | | **~$160/month** |
| **Total (4 nodes)** | | **~$205/month** |

Prices vary by region. Use [GCP Pricing Calculator](https://cloud.google.com/products/calculator) for exact estimates.

---

## Maintenance

### Updating Fleet

```bash
# On Node 1 — pull new images and redeploy
export FLEET_VERSION=latest  # or a specific tag
sudo docker stack deploy -c /opt/fleet/docker-stack.yml fleet
```

Fleet supports rolling updates — services are updated one at a time with automatic rollback on failure.

### Monitoring

```bash
# Check service health
sudo docker stack services fleet

# View API logs
sudo docker service logs fleet_api --tail 100 -f

# View all node status
sudo docker node ls

# Check disk usage
df -h
```

### Adding More Worker Nodes

```bash
# On the new node, install Docker (Step 3), mount NFS (Step 4.2), then:
sudo docker swarm join --token <WORKER_TOKEN> <NODE1_INTERNAL_IP>:2377
```

### Database Backups

Fleet automatically backs up the database on schedule. Manual backup:

```bash
# From Node 1
sudo docker exec $(sudo docker ps -q -f name=fleet_postgres) \
  pg_dump -U fleet fleet | gzip > fleet-backup-$(date +%Y%m%d).sql.gz
```

---

## Troubleshooting

### Service Not Starting

```bash
# Check service status
sudo docker service ps fleet_api --no-trunc
# Look at the "Error" column for details

# Check service logs
sudo docker service logs fleet_api --tail 50
```

### Node Not Joining Swarm

```bash
# Ensure ports 2377, 7946, 4789 are open between nodes
# Check from the joining node:
nc -zv <NODE1_INTERNAL_IP> 2377

# If token expired, generate a new one on Node 1:
sudo docker swarm join-token manager
```

### NFS Mount Failing

```bash
# Test NFS connectivity from the client node
showmount -e ${NODE1_INTERNAL_IP}

# Ensure nfs-common is installed
sudo apt-get install -y nfs-common

# Try manual mount
sudo mount -t nfs -v ${NODE1_INTERNAL_IP}:/opt/fleet/nfs-exports /opt/fleet/nfs-exports
```

### Cloudflare Not Routing to Healthy Node

- Verify the DNS records have the correct external IPs
- Ensure the proxy is enabled (orange cloud icon)
- Test the health endpoint directly: `curl http://<NODE_EXTERNAL_IP>/health`
- Check that GCP firewall rules allow port 80/443 from `0.0.0.0/0`

### Swarm Split Brain (2 of 3 Managers Down)

If 2 managers are down, the remaining manager cannot make cluster changes (quorum lost). Existing workloads keep running but no new deployments are possible.

To recover:
```bash
# If managers are permanently lost, force a new cluster on the surviving node:
sudo docker swarm init --force-new-cluster --advertise-addr <SURVIVING_NODE_IP>
# Then join replacement nodes as new managers
```

---

## Security Checklist

- [x] All traffic encrypted via HTTPS (Cloudflare + Traefik + Let's Encrypt)
- [x] Docker daemon hardened (`no-new-privileges`, ulimits, log rotation)
- [x] Swarm inter-node traffic on private network (GCP internal IPs)
- [x] NFS restricted to node IPs only
- [x] Proxy headers trusted only when `TRUST_PROXY=1`
- [x] Strong auto-generated secrets (JWT, encryption key, DB password)
- [ ] Set up Cloudflare WAF rules (recommended)
- [ ] Enable GCP audit logging
- [ ] Configure email for admin alerts
- [ ] Set up external monitoring (Uptime Robot, etc.)
- [ ] Review and rotate secrets periodically
