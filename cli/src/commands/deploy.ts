import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { requireAuth, apiRequest } from '../client.js'

export const deployCommand = new Command('deploy')
  .description('Deploy a new service')
  .requiredOption('--name <name>', 'Service name')
  .requiredOption('--image <image>', 'Docker image')
  .option('--replicas <n>', 'Number of replicas', '1')
  .option('--env <KEY=VAL...>', 'Environment variables', collectEnv, [] as string[])
  .action(async (options: { name: string; image: string; replicas: string; env: string[] }) => {
    try {
      requireAuth()

      const spinner = ora(`Deploying service ${chalk.cyan(options.name)}...`).start()

      // Parse environment variables
      const env: Record<string, string> = {}
      for (const entry of options.env) {
        const eqIndex = entry.indexOf('=')
        if (eqIndex === -1) {
          spinner.fail(chalk.red(`Invalid env format: ${entry}. Expected KEY=VALUE`))
          process.exit(1)
        }
        env[entry.substring(0, eqIndex)] = entry.substring(eqIndex + 1)
      }

      const service = await apiRequest<{
        id: string
        name: string
        replicas: number
        url?: string
      }>('POST', '/api/v1/services', {
        name: options.name,
        image: options.image,
        replicas: parseInt(options.replicas, 10) || 1,
        env,
      })

      spinner.succeed(chalk.green('Service deployed successfully!'))
      console.log(chalk.bold('  Name:     ') + service.name)
      console.log(chalk.bold('  Replicas: ') + service.replicas)
      if (service.url) {
        console.log(chalk.bold('  URL:      ') + chalk.cyan(service.url))
      }
    } catch (err) {
      console.error(chalk.red(`Deploy failed: ${(err as Error).message}`))
      process.exit(1)
    }
  })

function collectEnv(value: string, previous: string[]): string[] {
  return previous.concat([value])
}
