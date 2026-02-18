import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { requireAuth, apiRequest, buildWsUrl } from '../client.js'

async function resolveServiceId(name: string): Promise<string> {
  const services = await apiRequest<Array<{ id: string; name: string }>>('GET', '/api/v1/services')
  const service = services.find((s) => s.name === name)
  if (!service) {
    throw new Error(`Service "${name}" not found`)
  }
  return service.id
}

export const sshCommand = new Command('ssh')
  .description('Open an interactive shell in a running service container')
  .argument('<service>', 'Service name')
  .action(async (service: string) => {
    try {
      requireAuth()

      const spinner = ora('Connecting...').start()

      const serviceId = await resolveServiceId(service)
      const wsUrl = buildWsUrl(`/api/v1/terminal/${serviceId}`)

      const ws = new WebSocket(wsUrl)

      ws.addEventListener('open', () => {
        spinner.stop()

        // Put stdin in raw mode for interactive terminal
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true)
        }
        process.stdin.resume()

        // Send initial terminal size
        const cols = process.stdout.columns || 80
        const rows = process.stdout.rows || 24
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))

        // Forward stdin to WebSocket
        process.stdin.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data.toString())
          }
        })

        // Handle terminal resize
        process.stdout.on('resize', () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'resize',
              cols: process.stdout.columns || 80,
              rows: process.stdout.rows || 24,
            }))
          }
        })
      })

      ws.addEventListener('message', (event) => {
        const data = typeof event.data === 'string' ? event.data : String(event.data)
        process.stdout.write(data)
      })

      ws.addEventListener('error', () => {
        cleanup()
        console.error(chalk.red('\nConnection error.'))
        process.exit(1)
      })

      ws.addEventListener('close', (event) => {
        cleanup()
        if (event.code === 4003) {
          console.error(chalk.red('\nAccess denied.'))
        } else if (event.code !== 1000) {
          console.error(chalk.red(`\nConnection closed: ${event.reason || 'unknown reason'}`))
        }
        process.exit(0)
      })

      function cleanup() {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false)
        }
        process.stdin.pause()
      }

      process.on('SIGINT', () => {
        ws.close()
        cleanup()
        process.exit(0)
      })

      // Prevent the process from exiting
      await new Promise(() => {})
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
