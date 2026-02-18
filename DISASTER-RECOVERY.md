# Fleet — Multi-Site Disaster Recovery & High Availability

This document describes how to set up Fleet for multi-site disaster recovery with automatic failover across multiple server locations (racks, data centers, or geographic regions).

---

## Architecture Overview

```
                    ┌─────────────────┐
                    │   Global DNS    │
                    │  (Cloudflare /  │
                    │   Route 53)     │
                    └────────┬────────┘
                             │ Health-based routing
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Site A   │  │  Site B   │  │  Site C   │
        │ (Primary) │  │ (Standby) │  │ (Standby) │
        └──────────┘  └──────────┘  └──────────┘
```

Each site runs:
- Docker Swarm cluster (3+ managers, N workers)
- PostgreSQL with streaming replication
- Valkey (Redis) with Sentinel
- Shared storage (GlusterFS or Ceph)
- Traefik for ingress + Let's Encrypt

---

## 1. Docker Swarm Multi-Site

Docker Swarm natively supports multi-node clusters across locations.

### Setup

```bash
# Site A — Initialize the Swarm (primary manager)
docker swarm init --advertise-addr <SITE_A_MANAGER_IP>

# Site B — Join as manager
docker swarm join --token <MANAGER_TOKEN> <SITE_A_MANAGER_IP>:2377

# Site C — Join as manager
docker swarm join --token <MANAGER_TOKEN> <SITE_A_MANAGER_IP>:2377

# Add worker nodes at each site
docker swarm join --token <WORKER_TOKEN> <SITE_A_MANAGER_IP>:2377
```

### Node Labels for Placement

Label nodes by site so services can be constrained:

```bash
docker node update --label-add site=site-a <node-id>
docker node update --label-add site=site-b <node-id>
docker node update --label-add site=site-c <node-id>
```

### Cross-Site Networking

Use an overlay network with encryption for cross-site traffic:

```bash
docker network create \
  --driver overlay \
  --opt encrypted \
  --subnet 10.10.0.0/16 \
  fleet-overlay
```

**Important**: Ensure the following ports are open between sites:
- TCP 2377 (Swarm management)
- TCP/UDP 7946 (node communication)
- UDP 4789 (overlay network)

---

## 2. PostgreSQL Streaming Replication

Use **Patroni** for automated PostgreSQL failover.

### Architecture

```
Site A:  PostgreSQL Primary  ──►  Patroni Leader
Site B:  PostgreSQL Replica  ──►  Patroni Standby (sync)
Site C:  PostgreSQL Replica  ──►  Patroni Standby (async)
```

### Patroni Configuration

```yaml
# patroni.yml (each site)
scope: fleet-cluster
name: pg-site-a  # pg-site-b, pg-site-c

restapi:
  listen: 0.0.0.0:8008

etcd3:
  hosts: etcd-site-a:2379,etcd-site-b:2379,etcd-site-c:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576  # 1MB
    synchronous_mode: true
    postgresql:
      use_pg_rewind: true
      parameters:
        max_connections: 200
        shared_buffers: 1GB
        wal_level: replica
        max_wal_senders: 10
        max_replication_slots: 10
        hot_standby: on
        synchronous_commit: on

postgresql:
  listen: 0.0.0.0:5432
  data_dir: /var/lib/postgresql/data
  authentication:
    replication:
      username: replicator
      password: "${REPLICATION_PASSWORD}"
    superuser:
      username: postgres
      password: "${POSTGRES_PASSWORD}"
```

### Connection String

Use a connection pooler (PgBouncer) or Patroni's REST API for leader discovery:

```env
# In Fleet's .env
DATABASE_URL=postgresql://fleet:password@pgbouncer:6432/fleet?sslmode=require
```

### Automatic Failover

Patroni + etcd handles automatic failover:
1. etcd detects leader health failure (TTL expires)
2. Patroni promotes the most up-to-date replica
3. PgBouncer/HAProxy routes to the new leader
4. Fleet API reconnects automatically (Drizzle handles reconnection)

---

## 3. Valkey (Redis) Sentinel

### Architecture

```
Site A:  Valkey Primary  + Sentinel
Site B:  Valkey Replica  + Sentinel
Site C:  Valkey Replica  + Sentinel
```

### Sentinel Configuration

```conf
# sentinel.conf (each site)
sentinel monitor fleet-master <SITE_A_VALKEY_IP> 6379 2
sentinel down-after-milliseconds fleet-master 5000
sentinel failover-timeout fleet-master 60000
sentinel parallel-syncs fleet-master 1
sentinel auth-pass fleet-master <VALKEY_PASSWORD>
```

### Fleet Connection

```env
# Use Sentinel-aware connection in Fleet
VALKEY_SENTINELS=sentinel-a:26379,sentinel-b:26379,sentinel-c:26379
VALKEY_MASTER_NAME=fleet-master
VALKEY_PASSWORD=<password>
```

Update `packages/api/src/services/valkey.service.ts` to use Sentinel:

```typescript
import Redis from 'ioredis';

const valkey = new Redis({
  sentinels: [
    { host: 'sentinel-a', port: 26379 },
    { host: 'sentinel-b', port: 26379 },
    { host: 'sentinel-c', port: 26379 },
  ],
  name: 'fleet-master',
  password: process.env['VALKEY_PASSWORD'],
});
```

---

## 4. Shared Storage (GlusterFS)

For service source code, backups, and uploaded files.

### Setup

```bash
# On each site (install GlusterFS)
apt install glusterfs-server
systemctl enable --now glusterd

# Create a replicated volume across all sites
gluster volume create fleet-data replica 3 \
  site-a:/data/brick \
  site-b:/data/brick \
  site-c:/data/brick

gluster volume start fleet-data

# Mount on all nodes
mount -t glusterfs localhost:/fleet-data /mnt/fleet-data
```

### Fleet Configuration

```env
# Point Fleet's storage paths to GlusterFS
UPLOAD_DIR=/mnt/fleet-data/uploads
BACKUP_DIR=/mnt/fleet-data/backups
NFS_BACKUP_DIR=/mnt/fleet-data/nfs-backups
```

### Alternative: Ceph

For larger deployments, Ceph provides better scalability:

```bash
# Install Ceph and create a CephFS volume
ceph fs volume create fleet-data
# Mount via FUSE or kernel driver
mount -t ceph mon1,mon2,mon3:/ /mnt/fleet-data -o name=admin,secret=<key>
```

---

## 5. Global DNS Failover

### Cloudflare (Recommended)

Use Cloudflare Load Balancing with health checks:

1. Create a Load Balancer pool with origins at each site
2. Configure health checks against `/health` endpoint
3. Set failover priority: Site A > Site B > Site C
4. Enable "Failover" steering policy

```
Pool: fleet-production
  Origin A: site-a.fleet.example.com (priority: 1)
  Origin B: site-b.fleet.example.com (priority: 2)
  Origin C: site-c.fleet.example.com (priority: 3)

Health Check:
  Path: /health
  Interval: 15s
  Timeout: 5s
  Retries: 2
  Expected codes: 200
```

### AWS Route 53

Use Route 53 health checks with failover routing:

```
fleet.example.com → Failover routing
  Primary:   site-a IP (health check: /health)
  Secondary: site-b IP (health check: /health)
```

---

## 6. Adding New Sites

When a new site comes online, it automatically syncs:

### Step 1: Join Docker Swarm

```bash
docker swarm join --token <MANAGER_TOKEN> <EXISTING_MANAGER_IP>:2377
docker node update --label-add site=site-d <node-id>
```

### Step 2: Add PostgreSQL Replica

```bash
# Patroni auto-bootstraps from the current leader
patroni /etc/patroni.yml
# The new replica streams WAL from the leader automatically
```

### Step 3: Add Valkey Replica

```bash
# Start Valkey as replica of the current master
valkey-server --replicaof <CURRENT_MASTER_IP> 6379
# Add Sentinel monitoring
valkey-sentinel /etc/sentinel.conf
```

### Step 4: Extend GlusterFS

```bash
# Add the new brick and rebalance
gluster volume add-brick fleet-data replica 4 site-d:/data/brick
gluster volume rebalance fleet-data start
```

### Step 5: Update DNS

Add the new site to the Cloudflare/Route 53 load balancer pool.

---

## 7. Failure Scenarios & Recovery

### Scenario: Single Site Down

| Component | Behavior |
|-----------|----------|
| Docker Swarm | Automatically reschedules containers to remaining sites |
| PostgreSQL | Patroni promotes replica within ~30 seconds |
| Valkey | Sentinel promotes replica within ~5 seconds |
| GlusterFS | Self-heals from remaining replicas |
| DNS | Cloudflare removes unhealthy origin within ~30 seconds |
| Fleet API | Reconnects to new DB/Valkey leader automatically |

**Total failover time: ~30-60 seconds**

### Scenario: Network Partition

- Patroni uses quorum (etcd) to prevent split-brain
- Valkey Sentinel requires majority to promote
- GlusterFS uses quorum for write operations
- Docker Swarm managers require majority for cluster operations

### Scenario: Complete Data Loss at One Site

1. Rebuild the site's infrastructure
2. Join Docker Swarm (auto-syncs service state)
3. Bootstrap PostgreSQL replica (auto-streams from leader)
4. Start Valkey replica (auto-syncs from master)
5. Add GlusterFS brick (auto-rebalances data)

---

## 8. Monitoring & Alerts

Set up monitoring for cross-site health:

```yaml
# Prometheus alerting rules
groups:
  - name: fleet-ha
    rules:
      - alert: SiteDown
        expr: up{job="fleet-health"} == 0
        for: 1m
        labels:
          severity: critical

      - alert: ReplicationLag
        expr: pg_replication_lag_seconds > 10
        for: 2m
        labels:
          severity: warning

      - alert: ValkeyReplicationBroken
        expr: redis_connected_slaves < 2
        for: 1m
        labels:
          severity: critical

      - alert: GlusterVolumeDown
        expr: gluster_volume_status != 1
        for: 1m
        labels:
          severity: critical
```

---

## 9. Minimum Requirements

| Sites | Managers | Workers | PostgreSQL | Valkey | Storage |
|-------|----------|---------|-----------|--------|---------|
| 2 | 3 total | 2+ per site | 1 primary + 1 replica | 1 primary + 1 replica + 3 sentinels | 2-way replication |
| 3 | 3-5 total | 2+ per site | 1 primary + 2 replicas | 1 primary + 2 replicas + 3 sentinels | 3-way replication |
| 5+ | 5-7 total | 2+ per site | 1 primary + 4 replicas | 1 primary + 4 replicas + 5 sentinels | 3+ way replication |

**Note**: Always use an odd number of managers/sentinels for quorum.

---

## 10. Network Requirements

| Connection | Bandwidth | Latency | Notes |
|------------|-----------|---------|-------|
| Between sites | 1 Gbps+ | < 50ms | For Swarm overlay, PG replication |
| PG streaming | 100 Mbps+ | < 20ms | Synchronous replication needs low latency |
| GlusterFS | 1 Gbps+ | < 30ms | File replication is bandwidth-intensive |
| etcd cluster | 10 Mbps+ | < 50ms | Consensus requires stable latency |

For sites with high latency (> 50ms), consider:
- Using asynchronous PG replication for remote sites
- Reducing GlusterFS replica count for distant sites
- Using Ceph with erasure coding instead of full replication
