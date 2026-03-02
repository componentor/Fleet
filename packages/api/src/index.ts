import { serve } from '@hono/node-server'
import { app, injectWebSocket } from './app.js'
import { updateService } from './services/update.service.js'
import { templateService } from './services/template.service.js'
import { schedulerService } from './services/scheduler.service.js'
import { initWorkers, shutdownWorkers } from './services/queue.service.js'
import { closeValkey } from './services/valkey.service.js'
import { db, platformSettings, eq } from '@fleet/db'
import { runMigrations } from '@fleet/db/migrate'
import { logger, logToErrorTable } from './services/logger.js'

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
  logToErrorTable({ level: 'fatal', message: `Database migration failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'startup', operation: 'migration' } })
}

// Run database seeders on startup (idempotent — safe to re-run)
try {
  const { runSeeders } = await import('@fleet/db/seed')
  const { executed } = await runSeeders()
  if (executed > 0) logger.info({ executed }, 'Database seeders executed')
} catch (err) {
  logger.warn({ err }, 'Database seeder warning (non-fatal)')
  logToErrorTable({ level: 'error', message: `Database seeder failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'startup', operation: 'seeder' } })
}

// Recover from interrupted auto-updates (must run after DB is ready, before serving traffic)
try {
  await updateService.recoverFromInterruptedUpdate()
} catch (err) {
  logger.error({ err }, 'Update recovery failed — system may need manual inspection')
  logToErrorTable({ level: 'error', message: `Update recovery failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'startup', operation: 'update-recovery' } })
}

// Load persisted version from DB (survives container restarts after updates)
try {
  await updateService.initVersion()
} catch { /* non-critical */ }

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
  logToErrorTable({ level: 'error', message: `Storage manager initialization failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'startup', operation: 'storage-init' } })
}

// Initialize orchestrator (both Swarm + K8s backends, default from DB or env var)
try {
  const { initOrchestrator, setDefaultOrchestratorType } = await import('./services/orchestrator.js')
  await initOrchestrator()
  // Override default from DB setting if configured
  const dbSetting = await db.query.platformSettings.findFirst({ where: eq(platformSettings.key, 'orchestrator:default') })
  if (dbSetting?.value) {
    const val = typeof dbSetting.value === 'string' ? dbSetting.value : JSON.stringify(dbSetting.value);
    const parsed = val.replace(/"/g, '');
    if (parsed === 'swarm' || parsed === 'kubernetes') {
      setDefaultOrchestratorType(parsed)
      logger.info(`Orchestrator default set to ${parsed} (from database)`)
    }
  }
} catch (err) {
  logger.error({ err }, 'Orchestrator initialization failed')
  logToErrorTable({ level: 'error', message: `Orchestrator initialization failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'startup', operation: 'orchestrator-init' } })
}

// Sync built-in marketplace templates from disk into DB
try { await templateService.syncBuiltinTemplates() } catch {}

// Initialize BullMQ workers (deployment, backup, maintenance)
try { await initWorkers() } catch (err) {
  logger.error({ err }, 'Worker initialization failed')
  logToErrorTable({ level: 'error', message: `Worker initialization failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'startup', operation: 'worker-init' } })
}

// Initialize cross-replica build cancellation via Valkey pub/sub
try {
  const { buildService } = await import('./services/build.service.js')
  await buildService.initCancelSubscription()
} catch { /* non-critical */ }

// Verify built-in registry is reachable (non-blocking startup check)
try {
  const RAW_REG = process.env['REGISTRY_URL'] ?? ''
  const { getPlatformDomain } = await import('./routes/settings.js')
  const platformDom = await getPlatformDomain()
  // Resolve the canonical registry URL — prefer DB domain over env
  const REGISTRY_URL = (RAW_REG && !RAW_REG.match(/:\d+$/) && RAW_REG !== 'localhost') ? RAW_REG : (platformDom || RAW_REG)
  const REGISTRY_USER = process.env['REGISTRY_USER'] ?? 'fleet'
  const REGISTRY_PASSWORD = process.env['REGISTRY_PASSWORD'] ?? ''
  if (REGISTRY_URL) {
    const resp = await fetch(`https://${REGISTRY_URL}/v2/`, {
      signal: AbortSignal.timeout(10000),
      headers: REGISTRY_USER && REGISTRY_PASSWORD
        ? { Authorization: `Basic ${Buffer.from(`${REGISTRY_USER}:${REGISTRY_PASSWORD}`).toString('base64')}` }
        : {},
    })
    if (resp.status === 200) {
      logger.info({ registry: REGISTRY_URL }, 'Built-in registry is healthy')
    } else {
      logger.warn({ registry: REGISTRY_URL, status: resp.status }, 'Registry returned non-200 — builds may fail until repaired')
    }
  }
} catch (err) {
  logger.warn({ err }, 'Built-in registry health check failed — builds may fail. Use Settings > Registry > Repair to fix.')
}

// Initialize background job scheduler (registers repeatable BullMQ jobs)
try { await schedulerService.initialize() } catch (err) {
  logger.error({ err }, 'Scheduler initialization failed')
  logToErrorTable({ level: 'error', message: `Scheduler initialization failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'startup', operation: 'scheduler-init' } })
}

// Configure Docker Swarm task history limit (auto-clean old failed task records)
try {
  const { orchestrator } = await import('./services/orchestrator.js')
  await orchestrator.configureTaskHistoryLimit(3)
} catch {
  // Swarm may not be initialized yet
}

// Ensure distributed storage mounts are healthy (service volumes + platform certs).
// This handles cases where docker stack deploy reverts volume config, or a node restart,
// or a server crash during volume migration.
try {
  const { storageManager } = await import('./services/storage/storage-manager.js')
  const { orchestrator } = await import('./services/orchestrator.js')
  const { dockerService } = await import('./services/docker.service.js')

  // Ensure service volume base mount exists on all nodes (idempotent)
  if (storageManager.isVolumeDistributed) {
    try {
      await orchestrator.ensureServiceVolumeMount()
    } catch (err) {
      logger.warn({ err }, 'Failed to ensure service volume mount on startup')
    }
  }

  // Ensure platform volumes (Traefik certs) match the configured storage provider
  const expectedMode = storageManager.isVolumeDistributed ? 'distributed' : 'local'
  const currentMode = await orchestrator.getPlatformVolumeMode()
  if (expectedMode !== currentMode) {
    logger.info({ expectedMode, currentMode }, 'Platform volume mode mismatch detected — applying correct configuration')
    await orchestrator.updatePlatformVolumeMounts(expectedMode)
  }

  // Auto-repair user services with stale volume mounts.
  // Handles: crash during migration, stack redeploy reverting mounts, or newly added storage.
  // Safe to run repeatedly — detects current mount type vs expected and only repairs mismatches.
  // Data is copied from old volume before switching; old volume is NEVER deleted (safe to retry).
  try {
    const useHostMount = storageManager.volumes.isReady() && !!storageManager.volumes.getHostMountPath
    const allSvcs: any[] = await orchestrator.listServices()
    const userServices = allSvcs.filter((s: any) =>
      s.Spec?.Name?.startsWith('fleet-') && !s.Spec?.Name?.startsWith('fleet_'),
    )

    let repairCount = 0
    for (const svc of userServices) {
      const spec = svc.Spec
      if (!spec?.TaskTemplate?.ContainerSpec) continue
      const mounts: any[] = spec.TaskTemplate.ContainerSpec.Mounts ?? []
      let needsRepair = false

      for (const mount of mounts) {
        if (mount.Source === '/var/run/docker.sock') continue
        if (useHostMount && mount.Type === 'volume') { needsRepair = true; break }
        if (!useHostMount && mount.Type === 'bind' && mount.Source?.startsWith('/mnt/fleet-volumes/')) { needsRepair = true; break }
      }
      if (!needsRepair) continue

      // Rebuild mounts with data migration
      const newMounts: any[] = []
      let mountChanged = false
      for (const mount of mounts) {
        if (mount.Source === '/var/run/docker.sock' || (mount.Type === 'bind' && !mount.Source?.startsWith('/mnt/fleet-volumes/'))) {
          newMounts.push(mount)
          continue
        }
        if (useHostMount && mount.Type === 'volume') {
          const volumeName = mount.Source
          const hostPath = storageManager.volumes.getHostMountPath!(volumeName) ?? volumeName
          // Only convert to bind mount if the directory is successfully created
          let volumeReady = false
          try {
            await storageManager.volumes.createVolume(volumeName, 0)
            volumeReady = true
          } catch {
            // createVolume throws if volume already exists — that's fine
            // Check if the volume is accessible by running ensureVolume
            try {
              if (storageManager.volumes.ensureVolume) {
                await storageManager.volumes.ensureVolume(volumeName)
                volumeReady = true
              }
            } catch (ensureErr) {
              logger.warn({ err: ensureErr, volumeName }, 'Volume directory not available on distributed storage — keeping Docker volume mount')
            }
          }
          if (volumeReady) {
            try { await orchestrator.copyVolumeData(volumeName, hostPath) } catch { /* best effort — old volume preserved */ }
            newMounts.push({ Source: hostPath, Target: mount.Target, Type: 'bind', ReadOnly: mount.ReadOnly ?? false })
            mountChanged = true
          } else {
            // Keep original Docker volume mount — don't break the service
            newMounts.push(mount)
          }
        } else if (!useHostMount && mount.Type === 'bind' && mount.Source?.startsWith('/mnt/fleet-volumes/')) {
          const volumeName = mount.Source.split('/').pop()!
          try { await orchestrator.copyVolumeData(mount.Source, volumeName) } catch { /* best effort */ }
          newMounts.push({ Source: volumeName, Target: mount.Target, Type: 'volume', ReadOnly: mount.ReadOnly ?? false })
          mountChanged = true
        } else {
          newMounts.push(mount)
        }
      }
      if (!mountChanged) continue

      try {
        // Raw Swarm spec update — Swarm-specific mount repair
        const dockerSvc = dockerService.getDockerClient().getService(svc.ID)
        spec.TaskTemplate.ContainerSpec.Mounts = newMounts
        await dockerSvc.update({
          ...spec,
          version: svc.Version?.Index,
          TaskTemplate: { ...spec.TaskTemplate, ForceUpdate: ((spec.TaskTemplate as any).ForceUpdate ?? 0) + 1 },
        } as any)
        repairCount++
      } catch (err) {
        logger.warn({ err, service: spec.Name }, 'Failed to repair service volume mount on startup')
      }
    }

    if (repairCount > 0) {
      logger.info({ repairCount }, 'Auto-repaired service volume mounts on startup')
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to auto-repair service volume mounts on startup')
  }
} catch {
  // Non-critical — volume checks can fail if Swarm or storage not ready
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
