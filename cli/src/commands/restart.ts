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

export const restartCommand = new Command('restart')
  .description('Restart a service')
  .argument('<service>', 'Service name')
  .action(async (service: string) => {
    try {
      requireAuth()

      const spinner = ora(`Restarting ${chalk.cyan(service)}...`).start()

      const serviceId = await resolveServiceId(service)
      await apiRequest('POST', `/api/v1/services/${serviceId}/restart`)

      spinner.succeed(chalk.green(`Service ${chalk.cyan(service)} restarted.`))
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
