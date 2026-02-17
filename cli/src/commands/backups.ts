import { Command } from 'commander'
import chalk from 'chalk'
import Table from 'cli-table3'
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

export const backupsCommand = new Command('backups')
  .description('Manage backups')

backupsCommand
  .command('list')
  .description('List all backups')
  .action(async () => {
    try {
      requireAuth()

      const spinner = ora('Fetching backups...').start()

      const backups = await apiRequest<
        Array<{
          id: string
          serviceName?: string
          status: string
          size?: string
          createdAt: string
        }>
      >('GET', '/api/v1/backups')

      spinner.stop()

      if (!backups || backups.length === 0) {
        console.log(chalk.yellow('No backups found.'))
        return
      }

      const table = new Table({
        head: [
          chalk.cyan('ID'),
          chalk.cyan('Service'),
          chalk.cyan('Status'),
          chalk.cyan('Size'),
          chalk.cyan('Created'),
        ],
      })

      for (const b of backups) {
        table.push([
          b.id,
          b.serviceName || '-',
          formatStatus(b.status),
          b.size || '-',
          new Date(b.createdAt).toLocaleDateString(),
        ])
      }

      console.log(table.toString())
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })

backupsCommand
  .command('create')
  .description('Create a backup')
  .requiredOption('--service <name>', 'Service name to back up')
  .action(async (options: { service: string }) => {
    try {
      requireAuth()

      const spinner = ora(`Creating backup for ${chalk.cyan(options.service)}...`).start()

      const serviceId = await resolveServiceId(options.service)
      const backup = await apiRequest<{ id: string }>('POST', '/api/v1/backups', { serviceId })

      spinner.succeed(
        chalk.green(`Backup created for ${chalk.cyan(options.service)} (ID: ${backup.id}).`),
      )
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })

backupsCommand
  .command('restore')
  .description('Restore a backup')
  .argument('<id>', 'Backup ID')
  .action(async (id: string) => {
    try {
      requireAuth()

      const spinner = ora(`Restoring backup ${chalk.cyan(id)}...`).start()

      await apiRequest('POST', `/api/v1/backups/${id}/restore`)

      spinner.succeed(chalk.green(`Backup ${chalk.cyan(id)} restored successfully.`))
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })

function formatStatus(status: string): string {
  switch (status?.toLowerCase()) {
    case 'completed':
      return chalk.green(status)
    case 'failed':
      return chalk.red(status)
    case 'in_progress':
    case 'pending':
      return chalk.yellow(status)
    default:
      return status || 'unknown'
  }
}
