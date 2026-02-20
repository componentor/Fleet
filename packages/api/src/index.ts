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
let sftpServer: import('ssh2').Server | undefined
let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  // Close servers first so ports are released immediately
  try { server?.close() } catch {}
  try { sftpServer?.close() } catch {}
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

// Recover from interrupted auto-updates (must run after DB is ready, before serving traffic)
try {
  await updateService.recoverFromInterruptedUpdate()
} catch (err) {
  logger.error({ err }, 'Update recovery failed — system may need manual inspection')
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

// Validate JWT_SECRET minimum length (256-bit / 32 bytes minimum)
if (process.env['NODE_ENV'] === 'production' && process.env['JWT_SECRET']!.length < 32) {
  logger.error('JWT_SECRET is too short — must be at least 32 characters (256-bit) for security')
  process.exit(1)
}

// Validate NODE_AUTH_TOKEN if set (used for inter-node communication)
if (process.env['NODE_AUTH_TOKEN'] && process.env['NODE_AUTH_TOKEN'].length < 32) {
  if (process.env['NODE_ENV'] === 'production') {
    logger.error('NODE_AUTH_TOKEN is too short — must be at least 32 characters for security')
    process.exit(1)
  }
  logger.warn('NODE_AUTH_TOKEN is shorter than 32 characters — consider using a longer token')
}

// Initialize storage manager (loads provider config from DB, defaults to local)
try {
  const { storageManager } = await import('./services/storage/storage-manager.js')
  await storageManager.initialize()
} catch (err) {
  logger.error({ err }, 'Storage manager initialization failed')
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

// Configure Docker Swarm task history limit (auto-clean old failed task records)
try {
  const { dockerService } = await import('./services/docker.service.js')
  await dockerService.configureTaskHistoryLimit(3)
} catch {
  // Swarm may not be initialized yet
}

server = serve({
  fetch: app.fetch,
  port,
})

injectWebSocket(server)

logger.info({ port }, `Fleet API running on port ${port}`)

// Start embedded SFTP server for file access to upload-based services
if (process.env['SFTP_ENABLED'] !== 'false') {
  try {
    const { startSftpServer } = await import('./services/sftp.service.js')
    startSftpServer()
  } catch (err) {
    logger.warn({ err }, 'SFTP server failed to start (non-critical)')
  }
}

updateService.startPeriodicCheck()
