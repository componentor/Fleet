/**
 * Standalone SSH/SFTP gateway entry point.
 * Runs the SFTP server without the full API (no HTTP, no workers, no scheduler).
 */
import { runMigrations } from '@fleet/db/migrate'
import { logger } from './services/logger.js'

let sftpServer: import('ssh2').Server | undefined
let shuttingDown = false

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  try { sftpServer?.close() } catch {}
  logger.info('SSH gateway shutting down')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Run migrations (DB must be ready for API key lookups)
try {
  const { applied } = await runMigrations()
  if (applied > 0) logger.info({ applied }, 'Database migrations applied')
} catch (err) {
  logger.error({ err }, 'Database migration failed')
}

// Start SFTP server
const { startSftpServer } = await import('./services/sftp.service.js')
sftpServer = startSftpServer()

logger.info('SSH gateway started')
