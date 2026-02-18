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

export const logsCommand = new Command('logs')
  .description('View service logs')
  .argument('<service>', 'Service name')
  .option('-f, --follow', 'Follow log output in real time')
  .option('--tail <n>', 'Number of lines to show', '100')
  .action(async (service: string, options: { follow?: boolean; tail: string }) => {
    try {
      requireAuth()

      const spinner = ora('Fetching logs...').start()

      const serviceId = await resolveServiceId(service)
      const tail = parseInt(options.tail, 10) || 100

      const logs = await apiRequest<{ lines: string[] }>(
        'GET',
        `/api/v1/services/${serviceId}/logs?tail=${tail}`,
      )

      spinner.stop()

      if (logs.lines && logs.lines.length > 0) {
        for (const line of logs.lines) {
          console.log(line)
        }
      } else if (!options.follow) {
        console.log(chalk.yellow('No logs available.'))
        return
      }

      if (options.follow) {
        console.log(chalk.dim('--- streaming logs (Ctrl+C to stop) ---'))

        const wsUrl = buildWsUrl(`/api/v1/terminal/logs/${serviceId}`)
        const ws = new WebSocket(wsUrl)

        ws.addEventListener('message', (event) => {
          const data = typeof event.data === 'string' ? event.data : String(event.data)
          process.stdout.write(data)
        })

        ws.addEventListener('error', () => {
          console.error(chalk.red('\nWebSocket connection error.'))
          process.exit(1)
        })

        ws.addEventListener('close', (event) => {
          if (event.code !== 1000) {
            console.error(chalk.red(`\nLog stream closed: ${event.reason || 'unknown reason'}`))
          }
          process.exit(0)
        })

        // Keep process alive and clean up on Ctrl+C
        process.on('SIGINT', () => {
          ws.close()
          process.exit(0)
        })

        // Prevent the process from exiting
        await new Promise(() => {})
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
