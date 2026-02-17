import { Command } from 'commander'
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import chalk from 'chalk'
import ora from 'ora'

export const initCommand = new Command('init')
  .description('Initialize the first node and deploy the Fleet stack')
  .option('-d, --domain <domain>', 'Platform domain (e.g., panel.example.com)')
  .option('-e, --email <email>', 'Admin email address')
  .action(async (options: { domain?: string; email?: string }) => {
    try {
      console.log(chalk.bold.blue('Initializing Fleet platform...\n'))

      const domain = options.domain || 'localhost'
      const email = options.email || 'admin@localhost'

      // Generate secrets
      const jwtSecret = randomBytes(32).toString('hex')
      const dbPassword = randomBytes(16).toString('hex')

      // Step 1: Check Docker
      const dockerSpinner = ora('Checking Docker...').start()
      try {
        execSync('docker info', { stdio: 'ignore' })
        dockerSpinner.succeed('Docker is installed')
      } catch {
        dockerSpinner.fail(chalk.red('Docker is not installed. Please install Docker first.'))
        process.exit(1)
      }

      // Step 2: Initialize Docker Swarm
      const swarmSpinner = ora('Initializing Docker Swarm...').start()
      try {
        execSync('docker swarm init', { stdio: 'ignore' })
        swarmSpinner.succeed('Swarm initialized')
      } catch {
        swarmSpinner.succeed('Swarm already initialized')
      }

      // Step 3: Create overlay networks
      const networkSpinner = ora('Creating overlay networks...').start()
      try {
        execSync('docker network create --driver overlay --attachable fleet_public', {
          stdio: 'ignore',
        })
        execSync('docker network create --driver overlay --attachable fleet_internal', {
          stdio: 'ignore',
        })
        networkSpinner.succeed('Networks created')
      } catch {
        networkSpinner.succeed('Networks already exist')
      }

      console.log('')
      console.log(chalk.green.bold('Fleet initialized!'))
      console.log(chalk.bold('  Domain:      ') + domain)
      console.log(chalk.bold('  Admin email: ') + email)
      console.log(chalk.bold('  JWT Secret:  ') + jwtSecret.substring(0, 8) + '...')
      console.log(chalk.bold('  DB Password: ') + dbPassword.substring(0, 8) + '...')
      console.log('')
      console.log(
        chalk.dim('  Deploy the stack with: docker stack deploy -c docker-compose.yml fleet'),
      )
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
