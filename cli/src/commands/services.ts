import { Command } from 'commander'
import chalk from 'chalk'
import Table from 'cli-table3'
import ora from 'ora'
import { requireAuth, apiRequest } from '../client.js'

export const servicesCommand = new Command('services')
  .description('List all services')
  .action(async () => {
    try {
      requireAuth()

      const spinner = ora('Fetching services...').start()

      const services = await apiRequest<
        Array<{
          name: string
          image: string
          replicas: number
          status: string
          createdAt: string
        }>
      >('GET', '/api/v1/services')

      spinner.stop()

      if (!services || services.length === 0) {
        console.log(chalk.yellow('No services found.'))
        return
      }

      const table = new Table({
        head: [
          chalk.cyan('Name'),
          chalk.cyan('Image'),
          chalk.cyan('Replicas'),
          chalk.cyan('Status'),
          chalk.cyan('Created'),
        ],
      })

      for (const svc of services) {
        table.push([
          svc.name,
          svc.image,
          String(svc.replicas),
          formatStatus(svc.status),
          new Date(svc.createdAt).toLocaleDateString(),
        ])
      }

      console.log(table.toString())
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })

function formatStatus(status: string): string {
  switch (status?.toLowerCase()) {
    case 'running':
      return chalk.green(status)
    case 'stopped':
      return chalk.red(status)
    case 'deploying':
      return chalk.yellow(status)
    default:
      return status || 'unknown'
  }
}
