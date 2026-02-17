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

export const scaleCommand = new Command('scale')
  .description('Scale a service')
  .argument('<service>', 'Service name')
  .argument('<replicas>', 'Number of replicas')
  .action(async (service: string, replicas: string) => {
    try {
      requireAuth()

      const replicaCount = parseInt(replicas, 10)
      if (isNaN(replicaCount) || replicaCount < 0) {
        console.error(chalk.red('Error: Replicas must be a non-negative integer.'))
        process.exit(1)
      }

      const spinner = ora(`Scaling ${chalk.cyan(service)} to ${replicaCount} replicas...`).start()

      const serviceId = await resolveServiceId(service)
      await apiRequest('PATCH', `/api/v1/services/${serviceId}`, { replicas: replicaCount })

      spinner.succeed(
        chalk.green(`Service ${chalk.cyan(service)} scaled to ${replicaCount} replicas.`),
      )
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
