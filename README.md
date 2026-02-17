# Fleet

Multi-tenant PaaS hosting control panel built on Docker Swarm. Deploy, manage, and scale Docker services with a modern dashboard, built-in billing, domain management, SSH access, automated backups, and a marketplace — all from a single self-hosted platform.

## Features

- **Docker Swarm Orchestration** — Deploy services as Swarm services with rolling updates, health checks, and multi-node scaling
- **Multi-Tenant Architecture** — Accounts with nested sub-accounts (reseller model), RBAC roles (owner, admin, member, viewer)
- **Built-in Billing** — Stripe integration with configurable plans, usage tracking, checkout sessions, and webhook handling
- **Domain Management** — Attach custom domains, automatic DNS via Cloudflare, optional domain purchasing
- **SSH Key Management** — Upload and manage SSH keys per account
- **Automated Backups** — Scheduled volume backups with configurable retention
- **Marketplace** — One-click deployable app templates managed by super admins
- **Email System** — Transactional emails via SMTP or Resend with customizable templates
- **Real-time Monitoring** — Service metrics, node health, and resource usage
- **Two-Factor Authentication** — TOTP-based 2FA with backup codes
- **Error Tracking** — Built-in error logging with super admin dashboard (no external services required)
- **API Keys** — Generate scoped API keys for programmatic access

## Quick Start

### Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/your-org/fleet.git
cd fleet

# Configure environment
cp env.example .env
# Edit .env with your settings (at minimum: JWT_SECRET, ENCRYPTION_KEY, POSTGRES_PASSWORD)

# Start all services
docker compose -f docker/docker-compose.prod.yml up -d
```

This starts the API, dashboard, PostgreSQL, Valkey (Redis), and Traefik (reverse proxy with automatic HTTPS).

Open your domain in the browser — the setup wizard will guide you through initial configuration.

### Development

Prerequisites: Node.js >= 22, pnpm

```bash
git clone https://github.com/your-org/fleet.git
cd fleet
pnpm install
cp env.example .env
pnpm dev
```

This starts the API (port 3000) and dashboard (port 5173). SQLite is used by default in development — no external database required.

Open http://localhost:5173 and the setup wizard will appear on first run.

### Setup Wizard

On first launch the setup wizard handles everything:

1. **Choose mode** — Initialize a leader node or connect to an existing cluster
2. **Create admin account** — Name, email, and password for the super admin (email verification is skipped for the first admin)
3. **Platform configuration** — Domain, platform name, and auto-generated JWT secret

## Architecture

```
fleet/
  packages/
    types/        Shared TypeScript type definitions
    db/           Database layer (Drizzle ORM — SQLite / PostgreSQL / MySQL)
    api/          REST API server (Hono)
    dashboard/    Web UI (Vue 3 + Vite + Tailwind CSS v4)
    cli/          CLI tool (Commander)
    agent/        Node agent for remote Docker management
  landing/        Marketing landing page (Vue 3 + Vite + Tailwind CSS v4)
  docker/         Dockerfiles and docker-compose configs
```

### Tech Stack

| Layer | Technology |
|---|---|
| API | Hono (Node.js), Pino logging |
| Database | Drizzle ORM (SQLite, PostgreSQL, MySQL) |
| Cache / Rate Limiting | Valkey (Redis-compatible) |
| Dashboard | Vue 3, Vue Router, Pinia, Tailwind CSS v4 |
| Auth | Argon2 password hashing, JWT (access + refresh), TOTP 2FA |
| Billing | Stripe (Checkout, Subscriptions, Webhooks) |
| Email | SMTP / Resend with template system |
| Containerization | Docker Swarm |
| Reverse Proxy | Traefik v3 with Let's Encrypt |
| Landing Page | Vue 3, Vite, Tailwind CSS v4 |

### Key Design Decisions

- **Multi-dialect database**: `@fleet/db` abstracts SQLite, PostgreSQL, and MySQL behind a single interface. The dialect is chosen via `DB_DIALECT` env var at startup.
- **Docker Swarm**: Services are deployed as Swarm services, enabling multi-node scaling and rolling updates.
- **Multi-tenant**: Accounts can be nested (reseller model). Each account has isolated services, domains, and billing.
- **RBAC**: Four roles (owner > admin > member > viewer) with middleware-enforced permissions on every route.
- **No external error tracking**: Errors are stored directly in the database and viewable via the super admin dashboard.
- **Setup wizard**: First-run setup is handled entirely through the dashboard UI. No manual database seeding required.

## Configuration

Copy `env.example` to `.env`. Key variables:

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | Environment (`development` / `production`) | `development` |
| `PORT` | API server port | `3000` |
| `DB_DIALECT` | Database engine (`sqlite`, `postgres`, `mysql`) | `sqlite` |
| `DATABASE_URL` | Connection string (not needed for SQLite) | — |
| `JWT_SECRET` | JWT signing secret (auto-generated during setup if not set) | — |
| `ENCRYPTION_KEY` | AES-256-GCM encryption key for secrets | — |
| `VALKEY_URL` | Valkey/Redis connection URL | — |
| `STRIPE_SECRET_KEY` | Stripe API secret key | — |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | — |
| `EMAIL_PROVIDER` | Email provider (`smtp` or `resend`) | `smtp` |
| `CORS_ORIGIN` | Allowed CORS origin | — |

See [env.example](env.example) for the complete list including OAuth, Cloudflare, and Docker Compose variables.

## Scripts

```bash
pnpm dev          # Start all packages in dev mode
pnpm build        # Build all packages
pnpm test         # Run all tests
pnpm typecheck    # Type-check all packages
pnpm db:generate  # Generate Drizzle migrations
pnpm db:migrate   # Run migrations
pnpm db:push      # Push schema to database
```

### Landing Page

```bash
pnpm --filter @fleet/landing dev      # Dev server on port 5174
pnpm --filter @fleet/landing build    # Production build
```

## Tests

```bash
pnpm test                        # All tests (via Turbo)
pnpm --filter @fleet/api test   # API tests only
pnpm --filter @fleet/db test    # Database tests only
```

Tests use an in-memory SQLite database — no external services required.

Test suites cover:
- **Auth** — Registration, login, email verification, password reset, 2FA, token refresh
- **Billing** — Plan listing, checkout sessions, webhook idempotency
- **RBAC** — Role-based access control, super admin routes, error tracking permissions

## Production Deployment

### Docker Compose

The production setup uses `docker/docker-compose.prod.yml` with five services:

- **api** — Fleet API server (512MB memory limit, non-root user, health check)
- **dashboard** — Vue SPA served by nginx (health check)
- **postgres** — PostgreSQL 17 Alpine with persistent volume
- **valkey** — Valkey 8 Alpine (Redis-compatible) with persistent volume
- **traefik** — Reverse proxy with automatic HTTPS via Let's Encrypt

```bash
# Generate secrets
openssl rand -hex 32  # Use for JWT_SECRET
openssl rand -hex 32  # Use for ENCRYPTION_KEY
openssl rand -hex 16  # Use for POSTGRES_PASSWORD

# Deploy
docker compose -f docker/docker-compose.prod.yml up -d
```

### Security

The API includes production-ready security defaults:

- **Rate limiting** — Global (120 req/min) and per-route (auth: 20 req/15min) with Valkey-backed sliding window
- **Security headers** — X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy
- **Request size limits** — 2MB default body size limit
- **Password hashing** — Argon2id
- **Token hashing** — Email verification and password reset tokens are SHA256-hashed before storage
- **Encrypted secrets** — TOTP secrets and backup codes encrypted with AES-256-GCM
- **Webhook idempotency** — Stripe webhooks are deduplicated via `webhook_events` table
- **Graceful shutdown** — SIGTERM/SIGINT handlers close connections cleanly

## License

Private
