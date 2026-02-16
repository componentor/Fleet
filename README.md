# Hoster

Multi-tenant PaaS hosting control panel built on Docker Swarm.

## Quick Start

### Installation (Production)

```bash
curl -fsSL https://get.hoster.app | sh
```

With a specific database:

```bash
curl -fsSL https://get.hoster.app | sh -s -- --db postgres
```

Supported databases: `postgres` (default), `sqlite`, `mysql`

After installation, open the dashboard in your browser. The setup wizard will guide you through:

1. **Choose mode** — Setup leader node or connect to an existing cluster
2. **Create admin account** — Name, email, and password for the super admin
3. **Platform configuration** — Domain and platform name (JWT secret is auto-generated)

### Development

Prerequisites: Node.js >= 20, pnpm

```bash
git clone https://github.com/your-org/hoster.git
cd hoster
pnpm install
cp env.example .env
pnpm dev
```

This starts the API (port 3000) and dashboard (port 5173). SQLite is used by default in development — no external database required.

Open http://localhost:5173 and the setup wizard will appear on first run.

## Architecture

```
packages/
  types/       Shared TypeScript types
  db/          Database layer (Drizzle ORM — SQLite/PostgreSQL/MySQL)
  api/         REST API (Hono)
  dashboard/   Web UI (Vue 3 + Tailwind)
  cli/         CLI tool (Commander)
  agent/       Node agent
```

### Key Design Decisions

- **Multi-dialect database**: `@hoster/db` abstracts SQLite, PostgreSQL, and MySQL behind a single interface. The dialect is chosen via `DB_DIALECT` env var at startup.
- **Docker Swarm**: Services are deployed as Swarm services, enabling multi-node scaling and rolling updates.
- **Multi-tenant**: Accounts can be nested (reseller model). Each account has isolated services, domains, and billing.
- **Setup wizard**: First-run setup is handled entirely through the dashboard UI. No manual database seeding or config file editing required.

## Environment Variables

Copy `env.example` to `.env`. Key variables:

| Variable | Description | Default |
|---|---|---|
| `DB_DIALECT` | Database engine (`sqlite`, `postgres`, `mysql`) | `sqlite` |
| `DATABASE_URL` | Connection string (not needed for SQLite) | — |
| `JWT_SECRET` | JWT signing secret (auto-generated during setup if not set) | — |
| `PORT` | API server port | `3000` |

See [env.example](env.example) for the full list.

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

## Tests

```bash
pnpm test                        # All tests (via Turbo)
pnpm --filter @hoster/db test    # Database tests only
pnpm --filter @hoster/api test   # API tests only
```

Tests use an in-memory SQLite database — no external services required.

## License

Private
