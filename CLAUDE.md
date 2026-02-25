# Fleet — Project Instructions

## Database Migrations

**CRITICAL**: When modifying ANY file in `packages/db/src/dialects/*/schema/*.ts`, you MUST also create a corresponding SQL migration file. Forgetting this will crash production on deploy.

### How to create a migration

1. Write the SQL migration for **all 3 dialects**:
   - `packages/db/src/migrations/pg/NNNN_<name>.sql` (PostgreSQL)
   - `packages/db/src/migrations/sqlite/NNNN_<name>.sql` (SQLite)
   - `packages/db/src/migrations/mysql/NNNN_<name>.sql` (MySQL)
2. Update the `meta/_journal.json` in each dialect's migrations folder (increment idx, use next sequence number for tag)
3. Use `IF NOT EXISTS` / `IF EXISTS` where the dialect supports it to make migrations idempotent

### Dialect syntax differences

| Operation | PostgreSQL | SQLite | MySQL |
|-----------|-----------|--------|-------|
| UUID column | `uuid` | `text` | `varchar(36)` |
| Boolean | `boolean DEFAULT true` | `integer DEFAULT 1` | `boolean DEFAULT true` |
| Integer | `integer` | `integer` | `int` |
| Table quotes | `"table"` | `"table"` | `` `table` `` |

## Code Style

- API: Hono + Zod OpenAPI, TypeScript strict
- Dashboard: Vue 3 `<script setup>`, Tailwind CSS, lucide-vue-next icons, Pinia stores
- `useApi()` composable for API calls (supports `.get()`, `.post()`, `.patch()`, `.put()`, `.delete()`)
- No component library — raw Tailwind
