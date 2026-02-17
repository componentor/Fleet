import { Command } from 'commander'
import { execSync } from 'node:child_process'
import chalk from 'chalk'
import ora from 'ora'

export const joinCommand = new Command('join')
  .description('Join this node to an existing Fleet swarm')
  .option('-t, --token <token>', 'Swarm join token')
  .option('-a, --address <address>', 'Manager node address (ip:port)')
  .action(async (options: { token?: string; address?: string }) => {
    try {
      console.log(chalk.bold.blue('Joining Fleet swarm...\n'))

      if (!options.token || !options.address) {
        console.log(chalk.yellow('No token/address provided. Starting setup wizard...'))
        console.log(
          chalk.dim('Visit http://localhost:80 to complete the setup via the web wizard.'),
        )
        return
      }

      // Step 1: Check Docker
      const dockerSpinner = ora('Checking Docker...').start()
      try {
        execSync('docker info', { stdio: 'ignore' })
        dockerSpinner.succeed('Docker is installed')
      } catch {
        dockerSpinner.fail(chalk.red('Docker is not installed. Please install Docker first.'))
        process.exit(1)
      }

      // Step 2: Join swarm
      const joinSpinner = ora('Joining swarm...').start()
      try {
        execSync(`docker swarm join --token ${options.token} ${options.address}`, {
          stdio: 'inherit',
        })
        joinSpinner.succeed('Joined swarm')
      } catch {
        joinSpinner.fail(chalk.red('Failed to join swarm'))
        process.exit(1)
      }

      console.log('')
      console.log(chalk.green.bold('Node joined the Fleet swarm!'))
      console.log(chalk.dim('  The agent will be automatically deployed to this node.'))
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
