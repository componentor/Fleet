import { serve } from '@hono/node-server'
import { app, injectWebSocket } from './app.js'
import { updateService } from './services/update.service.js'
import { templateService } from './services/template.service.js'
import { schedulerService } from './services/scheduler.service.js'
import { initWorkers, shutdownWorkers } from './services/queue.service.js'
import { closeValkey } from './services/valkey.service.js'
import { db, platformSettings, eq } from '@fleet/db'

// Register shutdown handlers early — before any async work
let server: ReturnType<typeof serve> | undefined
function shutdown() {
  updateService.stopPeriodicCheck()
  schedulerService.shutdown()
  shutdownWorkers().catch(() => {})
  closeValkey().catch(() => {})
  try { server?.close() } catch {}
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const port = Number(process.env['PORT'] ?? 3000)

// Load JWT secret from DB if not set via env (setup wizard stores it in platformSettings)
if (!process.env['JWT_SECRET']) {
  try {
    const row = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, 'platform:jwtSecret'),
    })
    if (row) {
      process.env['JWT_SECRET'] = row.value as string
    }
  } catch {
    // DB may not be initialized yet (first run)
  }
}

// Sync built-in marketplace templates from disk into DB
try { await templateService.syncBuiltinTemplates() } catch {}

// Initialize BullMQ workers (deployment, backup, maintenance)
try { await initWorkers() } catch (err) {
  console.error('Worker initialization failed:', err)
}

// Initialize background job scheduler (registers repeatable BullMQ jobs)
try { await schedulerService.initialize() } catch (err) {
  console.error('Scheduler initialization failed:', err)
}

server = serve({
  fetch: app.fetch,
  port,
})

injectWebSocket(server)

console.log(`Fleet API running on port ${port}`)

updateService.startPeriodicCheck()
