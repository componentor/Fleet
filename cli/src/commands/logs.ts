import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { requireAuth, apiRequest } from '../client.js'

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
  .option('-f, --follow', 'Follow log output')
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

      if (!logs.lines || logs.lines.length === 0) {
        console.log(chalk.yellow('No logs available.'))
        return
      }

      for (const line of logs.lines) {
        console.log(line)
      }

      if (options.follow) {
        console.log(chalk.yellow('\nNote: Live log streaming is not yet supported in the CLI.'))
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
