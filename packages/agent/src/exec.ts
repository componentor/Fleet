import Docker from 'dockerode'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebSocket } from 'ws'
import { logger } from './logger.js'

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
const docker = new Docker({ socketPath: DOCKER_SOCKET })

/**
 * Handle non-interactive exec requests (e.g. database queries).
 * POST /exec { containerId, cmd, timeoutMs?, env? }
 * Returns JSON { stdout, stderr, exitCode }
 */
export async function handleExecRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authToken: string | undefined,
): Promise<void> {
  // Verify auth
  const authHeader = req.headers['authorization']
  if (authToken && (!authHeader || authHeader !== `Bearer ${authToken}`)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  // Parse body
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1_000_000) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request too large' }))
      return
    }
  }

  let parsed: { containerId: string; cmd: string[]; timeoutMs?: number; env?: string[] }
  try {
    parsed = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON' }))
    return
  }

  const { containerId, cmd, timeoutMs = 30_000, env } = parsed
  if (!containerId || !Array.isArray(cmd) || cmd.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Missing containerId or cmd' }))
    return
  }

  try {
    const container = docker.getContainer(containerId)
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: env,
    })

    const stream = await exec.start({ hijack: true, stdin: false, Tty: false })

    // Collect output with timeout
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        stream.destroy()
        reject(new Error('Exec timed out'))
      }, timeoutMs)

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []

      // Docker multiplexes stdout/stderr with 8-byte header frames when Tty: false
      docker.modem.demuxStream(stream, {
        write: (chunk: Buffer) => { stdoutChunks.push(chunk) },
      } as any, {
        write: (chunk: Buffer) => { stderrChunks.push(chunk) },
      } as any)

      stream.on('end', () => {
        clearTimeout(timer)
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        })
      })

      stream.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })
    })

    // Get exit code
    const inspectResult = await exec.inspect()
    const exitCode = inspectResult.ExitCode ?? -1

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Exec failed'
    logger.error({ err, containerId }, 'Exec request failed')
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: message, stdout: '', exitCode: -1 }))
  }
}

/**
 * Handle streaming exec requests (e.g. database export).
 * POST /exec-stream { containerId, cmd, timeoutMs?, env? }
 * Streams stdout directly as the response body.
 */
export async function handleExecStreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authToken: string | undefined,
): Promise<void> {
  // Verify auth
  const authHeader = req.headers['authorization']
  if (authToken && (!authHeader || authHeader !== `Bearer ${authToken}`)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1_000_000) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request too large' }))
      return
    }
  }

  let parsed: { containerId: string; cmd: string[]; timeoutMs?: number; env?: string[] }
  try {
    parsed = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON' }))
    return
  }

  const { containerId, cmd, timeoutMs = 300_000, env } = parsed
  if (!containerId || !Array.isArray(cmd) || cmd.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Missing containerId or cmd' }))
    return
  }

  try {
    const container = docker.getContainer(containerId)
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: env,
    })

    const stream = await exec.start({ hijack: true, stdin: false, Tty: false })

    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })

    const timer = setTimeout(() => {
      stream.destroy()
      res.end()
    }, timeoutMs)

    // Pipe stdout directly to response, discard stderr
    docker.modem.demuxStream(stream, res, {
      write: () => {}, // discard stderr
    } as any)

    stream.on('end', () => {
      clearTimeout(timer)
      res.end()
    })

    stream.on('error', (err: Error) => {
      clearTimeout(timer)
      logger.error({ err, containerId }, 'Exec stream error')
      res.end()
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Exec stream failed'
    logger.error({ err, containerId }, 'Exec stream request failed')
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: message }))
    }
  }
}

/**
 * Handle exec-with-input requests (e.g. database import).
 * POST /exec-input with multipart: JSON params + file data
 * Uses X-Exec-Params header for { containerId, cmd, timeoutMs?, env? }
 * Request body is piped as stdin to the exec process.
 * Returns JSON { stdout, stderr, exitCode }
 */
export async function handleExecInputRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authToken: string | undefined,
): Promise<void> {
  // Verify auth
  const authHeader = req.headers['authorization']
  if (authToken && (!authHeader || authHeader !== `Bearer ${authToken}`)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  // Exec params come from header to allow body to be stdin data
  const paramsHeader = req.headers['x-exec-params']
  if (!paramsHeader || typeof paramsHeader !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Missing X-Exec-Params header' }))
    return
  }

  let parsed: { containerId: string; cmd: string[]; timeoutMs?: number; env?: string[] }
  try {
    parsed = JSON.parse(paramsHeader)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid X-Exec-Params header' }))
    return
  }

  const { containerId, cmd, timeoutMs = 600_000, env } = parsed
  if (!containerId || !Array.isArray(cmd) || cmd.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Missing containerId or cmd' }))
    return
  }

  try {
    const container = docker.getContainer(containerId)
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: env,
    })

    const stream = await exec.start({ hijack: true, stdin: true, Tty: false })

    // Pipe request body as stdin
    req.pipe(stream, { end: true })

    // Collect output
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        stream.destroy()
        reject(new Error('Exec timed out'))
      }, timeoutMs)

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []

      docker.modem.demuxStream(stream, {
        write: (chunk: Buffer) => { stdoutChunks.push(chunk) },
      } as any, {
        write: (chunk: Buffer) => { stderrChunks.push(chunk) },
      } as any)

      stream.on('end', () => {
        clearTimeout(timer)
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        })
      })

      stream.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })
    })

    const inspectResult = await exec.inspect()
    const exitCode = inspectResult.ExitCode ?? -1

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Exec input failed'
    logger.error({ err, containerId }, 'Exec input request failed')
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: message, stdout: '', stderr: '', exitCode: -1 }))
    }
  }
}

/**
 * Handle container stats requests.
 * POST /stats { containerIds: string[] }
 * Returns JSON { stats: { [containerId]: ContainerStats } }
 * Uses the Docker stats API (one-shot) for each container on this node.
 */
export async function handleStatsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  authToken: string | undefined,
): Promise<void> {
  // Verify auth
  const authHeader = req.headers['authorization']
  if (authToken && (!authHeader || authHeader !== `Bearer ${authToken}`)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 100_000) {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Request too large' }))
      return
    }
  }

  let parsed: { containerIds: string[] }
  try {
    parsed = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON' }))
    return
  }

  const { containerIds } = parsed
  if (!Array.isArray(containerIds) || containerIds.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Missing containerIds array' }))
    return
  }

  const stats: Record<string, any> = {}

  await Promise.all(
    containerIds.slice(0, 50).map(async (id) => {
      try {
        const container = docker.getContainer(id)
        const s = await container.stats({ stream: false }) as any

        const cpuDelta = (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0)
        const systemDelta = (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0)
        const numCpus = s.cpu_stats?.online_cpus ?? s.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1
        const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0

        const memoryUsageBytes = s.memory_stats?.usage ?? 0
        const memoryLimitBytes = s.memory_stats?.limit ?? 1
        const memoryPercent = (memoryUsageBytes / memoryLimitBytes) * 100

        let networkRxBytes = 0
        let networkTxBytes = 0
        if (s.networks) {
          for (const netStats of Object.values(s.networks) as any[]) {
            networkRxBytes += netStats.rx_bytes ?? 0
            networkTxBytes += netStats.tx_bytes ?? 0
          }
        }

        let blockReadBytes = 0
        let blockWriteBytes = 0
        const ioStats = s.blkio_stats?.io_service_bytes_recursive ?? []
        for (const entry of ioStats) {
          if (entry.op === 'read' || entry.op === 'Read') blockReadBytes += entry.value ?? 0
          if (entry.op === 'write' || entry.op === 'Write') blockWriteBytes += entry.value ?? 0
        }

        stats[id] = {
          cpuPercent: Math.round(cpuPercent * 100) / 100,
          memoryUsageBytes,
          memoryLimitBytes,
          memoryPercent: Math.round(memoryPercent * 100) / 100,
          networkRxBytes,
          networkTxBytes,
          blockReadBytes,
          blockWriteBytes,
          pids: s.pids_stats?.current ?? 0,
        }
      } catch {
        // Container not found on this node or stats unavailable
      }
    }),
  )

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ stats }))
}

/**
 * Handle interactive terminal WebSocket connections.
 * Pipes bidirectionally between WebSocket and Docker exec stream.
 */
export async function handleExecWebSocket(
  ws: WebSocket,
  containerId: string,
  cmd: string[],
): Promise<void> {
  try {
    const container = docker.getContainer(containerId)

    // Try multiple shells — some images only have sh or bash
    let exec: Docker.Exec | null = null
    let stream: NodeJS.ReadWriteStream | null = null

    for (const shell of cmd) {
      try {
        exec = await container.exec({
          Cmd: [shell],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
        })
        stream = await exec.start({ hijack: true, stdin: true, Tty: true })
        break
      } catch {
        // Try next shell
      }
    }

    if (!exec || !stream) {
      ws.close(4004, 'No shell available in container')
      return
    }

    const execId = exec.id

    // Docker stream → WebSocket
    stream.on('data', (chunk: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(chunk)
      }
    })

    stream.on('end', () => {
      ws.close(1000, 'Container stream ended')
    })

    stream.on('error', (err: Error) => {
      logger.error({ err, containerId }, 'Docker stream error')
      ws.close(1011, 'Container error')
    })

    // WebSocket → Docker stream
    ws.on('message', (data: Buffer | string) => {
      // Check for resize messages
      if (typeof data === 'string' || (Buffer.isBuffer(data) && data[0] === 0x7b)) {
        try {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'resize' && msg.cols && msg.rows) {
            // Resize the exec TTY
            if (execId) {
              docker.getExec(execId).resize({ h: msg.rows, w: msg.cols }).catch(() => {})
            }
            return
          }
        } catch {
          // Not JSON, treat as terminal input
        }
      }
      stream!.write(data)
    })

    ws.on('close', () => {
      stream!.end()
    })

    ws.on('error', (err: Error) => {
      logger.error({ err, containerId }, 'WebSocket error')
      stream!.end()
    })
  } catch (err) {
    logger.error({ err, containerId }, 'Failed to start terminal session')
    ws.close(4004, 'Failed to start terminal')
  }
}
