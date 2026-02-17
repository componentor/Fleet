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

export const domainsCommand = new Command('domains')
  .description('Manage domains')

domainsCommand
  .command('list')
  .description('List all domains')
  .action(async () => {
    try {
      requireAuth()

      const spinner = ora('Fetching domains...').start()

      const domains = await apiRequest<
        Array<{
          id: string
          domain: string
          serviceName?: string
          ssl: boolean
          createdAt: string
        }>
      >('GET', '/api/v1/domains')

      spinner.stop()

      if (!domains || domains.length === 0) {
        console.log(chalk.yellow('No domains found.'))
        return
      }

      const table = new Table({
        head: [
          chalk.cyan('Domain'),
          chalk.cyan('Service'),
          chalk.cyan('SSL'),
          chalk.cyan('Created'),
        ],
      })

      for (const d of domains) {
        table.push([
          d.domain,
          d.serviceName || '-',
          d.ssl ? chalk.green('Yes') : chalk.red('No'),
          new Date(d.createdAt).toLocaleDateString(),
        ])
      }

      console.log(table.toString())
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })

domainsCommand
  .command('add')
  .description('Add a domain')
  .argument('<domain>', 'Domain name')
  .requiredOption('--service <name>', 'Service name to attach the domain to')
  .action(async (domain: string, options: { service: string }) => {
    try {
      requireAuth()

      const spinner = ora(`Adding domain ${chalk.cyan(domain)}...`).start()

      const serviceId = await resolveServiceId(options.service)
      await apiRequest('POST', '/api/v1/domains', { domain, serviceId })

      spinner.succeed(chalk.green(`Domain ${chalk.cyan(domain)} added to service ${chalk.cyan(options.service)}.`))
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })

domainsCommand
  .command('remove')
  .description('Remove a domain')
  .argument('<domain>', 'Domain name')
  .action(async (domain: string) => {
    try {
      requireAuth()

      const spinner = ora(`Removing domain ${chalk.cyan(domain)}...`).start()

      // Find domain ID
      const domains = await apiRequest<Array<{ id: string; domain: string }>>(
        'GET',
        '/api/v1/domains',
      )
      const found = domains.find((d) => d.domain === domain)
      if (!found) {
        spinner.fail(chalk.red(`Domain "${domain}" not found.`))
        process.exit(1)
      }

      await apiRequest('DELETE', `/api/v1/domains/${found.id}`)

      spinner.succeed(chalk.green(`Domain ${chalk.cyan(domain)} removed.`))
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
