import { Command } from 'commander'
import chalk from 'chalk'
import Table from 'cli-table3'
import ora from 'ora'
import { requireAuth, apiRequest } from '../client.js'

export const marketplaceCommand = new Command('marketplace')
  .description('Browse and deploy marketplace apps')

marketplaceCommand
  .command('list')
  .description('List marketplace apps')
  .action(async () => {
    try {
      requireAuth()

      const spinner = ora('Fetching marketplace apps...').start()

      const apps = await apiRequest<
        Array<{
          slug: string
          name: string
          description: string
          category: string
        }>
      >('GET', '/api/v1/marketplace')

      spinner.stop()

      if (!apps || apps.length === 0) {
        console.log(chalk.yellow('No marketplace apps found.'))
        return
      }

      const table = new Table({
        head: [
          chalk.cyan('Name'),
          chalk.cyan('Description'),
          chalk.cyan('Category'),
        ],
      })

      for (const app of apps) {
        table.push([app.name, app.description, app.category])
      }

      console.log(table.toString())
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })

marketplaceCommand
  .command('deploy')
  .description('Deploy a marketplace app')
  .argument('<slug>', 'App slug')
  .action(async (slug: string) => {
    try {
      requireAuth()

      const spinner = ora(`Deploying ${chalk.cyan(slug)} from marketplace...`).start()

      const result = await apiRequest<{ name?: string; url?: string }>(
        'POST',
        `/api/v1/marketplace/${slug}/deploy`,
      )

      spinner.succeed(chalk.green(`Marketplace app ${chalk.cyan(slug)} deployed successfully!`))
      if (result?.name) {
        console.log(chalk.bold('  Service: ') + result.name)
      }
      if (result?.url) {
        console.log(chalk.bold('  URL:     ') + chalk.cyan(result.url))
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
