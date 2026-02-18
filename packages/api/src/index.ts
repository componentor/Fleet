import { serve } from '@hono/node-server'
import { app, injectWebSocket } from './app.js'
import { updateService } from './services/update.service.js'
import { templateService } from './services/template.service.js'
import { schedulerService } from './services/scheduler.service.js'
import { initWorkers, shutdownWorkers } from './services/queue.service.js'
import { closeValkey } from './services/valkey.service.js'
import { db, platformSettings, eq } from '@fleet/db'
import { runMigrations } from '@fleet/db/migrate'
import { logger } from './services/logger.js'

// Register shutdown handlers early — before any async work
let server: ReturnType<typeof serve> | undefined
let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  // Close the HTTP server first so the port is released immediately
  try { server?.close() } catch {}
  logger.info('Shutting down gracefully...')
  updateService.stopPeriodicCheck()
  schedulerService.shutdown()
  await Promise.allSettled([
    shutdownWorkers(),
    closeValkey(),
  ])
  logger.info('Shutdown complete')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const port = Number(process.env['PORT'] ?? 3000)

// Run database migrations on startup
try {
  const { applied } = await runMigrations()
  if (applied > 0) logger.info({ applied }, 'Database migrations applied')
} catch (err) {
  logger.error({ err }, 'Database migration failed')
}

// Load JWT secret from DB if not set via env (setup wizard stores it encrypted in platformSettings)
if (!process.env['JWT_SECRET']) {
  try {
    const row = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, 'platform:jwtSecret'),
    })
    if (row) {
      const { decrypt } = await import('./services/crypto.service.js')
      const value = row.value as string
      // Handle both legacy JSON-stringified and encrypted values
      try {
        const parsed = JSON.parse(value)
        process.env['JWT_SECRET'] = typeof parsed === 'string' ? parsed : value
      } catch {
        process.env['JWT_SECRET'] = decrypt(value)
      }
    }
  } catch {
    // DB may not be initialized yet (first run)
  }
}

// Auto-generate a temporary JWT secret for dev mode if still not set
if (!process.env['JWT_SECRET']) {
  if (process.env['NODE_ENV'] === 'production') {
    logger.error('JWT_SECRET is not set — configure it via env or run the setup wizard')
    process.exit(1)
  }
  const { randomBytes } = await import('node:crypto')
  process.env['JWT_SECRET'] = randomBytes(32).toString('hex')
  logger.warn('JWT_SECRET not configured — using auto-generated secret (dev mode, tokens will not survive restarts)')
}

// Sync built-in marketplace templates from disk into DB
try { await templateService.syncBuiltinTemplates() } catch {}

// Initialize BullMQ workers (deployment, backup, maintenance)
try { await initWorkers() } catch (err) {
  logger.error({ err }, 'Worker initialization failed')
}

// Initialize background job scheduler (registers repeatable BullMQ jobs)
try { await schedulerService.initialize() } catch (err) {
  logger.error({ err }, 'Scheduler initialization failed')
}

server = serve({
  fetch: app.fetch,
  port,
})

injectWebSocket(server)

logger.info({ port }, `Fleet API running on port ${port}`)

updateService.startPeriodicCheck()
