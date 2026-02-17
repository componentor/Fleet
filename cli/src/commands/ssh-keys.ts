import { Command } from 'commander'
import chalk from 'chalk'
import Table from 'cli-table3'
import ora from 'ora'
import { requireAuth, apiRequest } from '../client.js'

export const sshKeysCommand = new Command('ssh-keys')
  .description('Manage SSH keys')

sshKeysCommand
  .command('list')
  .description('List all SSH keys')
  .action(async () => {
    try {
      requireAuth()

      const spinner = ora('Fetching SSH keys...').start()

      const keys = await apiRequest<
        Array<{
          id: string
          name: string
          fingerprint?: string
          createdAt: string
        }>
      >('GET', '/api/v1/ssh-keys')

      spinner.stop()

      if (!keys || keys.length === 0) {
        console.log(chalk.yellow('No SSH keys found.'))
        return
      }

      const table = new Table({
        head: [
          chalk.cyan('ID'),
          chalk.cyan('Name'),
          chalk.cyan('Fingerprint'),
          chalk.cyan('Created'),
        ],
      })

      for (const key of keys) {
        table.push([
          key.id,
          key.name,
          key.fingerprint || '-',
          new Date(key.createdAt).toLocaleDateString(),
        ])
      }

      console.log(table.toString())
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })

sshKeysCommand
  .command('add')
  .description('Add an SSH key')
  .requiredOption('--name <name>', 'Key name')
  .requiredOption('--key <pubkey>', 'Public key')
  .action(async (options: { name: string; key: string }) => {
    try {
      requireAuth()

      const spinner = ora(`Adding SSH key ${chalk.cyan(options.name)}...`).start()

      await apiRequest('POST', '/api/v1/ssh-keys', {
        name: options.name,
        publicKey: options.key,
      })

      spinner.succeed(chalk.green(`SSH key ${chalk.cyan(options.name)} added.`))
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })

sshKeysCommand
  .command('remove')
  .description('Remove an SSH key')
  .argument('<id>', 'SSH key ID')
  .action(async (id: string) => {
    try {
      requireAuth()

      const spinner = ora('Removing SSH key...').start()

      await apiRequest('DELETE', `/api/v1/ssh-keys/${id}`)

      spinner.succeed(chalk.green(`SSH key ${chalk.cyan(id)} removed.`))
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
