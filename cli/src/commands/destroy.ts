import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
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

export const destroyCommand = new Command('destroy')
  .description('Destroy a service')
  .argument('<service>', 'Service name')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (service: string, options: { force?: boolean }) => {
    try {
      requireAuth()

      if (!options.force) {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Are you sure you want to destroy ${chalk.cyan(service)}?`,
            default: false,
          },
        ])

        if (!confirm) {
          console.log(chalk.yellow('Aborted.'))
          return
        }
      }

      const spinner = ora(`Destroying ${chalk.cyan(service)}...`).start()

      const serviceId = await resolveServiceId(service)
      await apiRequest('DELETE', `/api/v1/services/${serviceId}`)

      spinner.succeed(chalk.green(`Service ${chalk.cyan(service)} destroyed.`))
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
