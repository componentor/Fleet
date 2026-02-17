import { Command } from 'commander'
import chalk from 'chalk'
import { requireAuth, apiRequest } from '../client.js'

export const whoamiCommand = new Command('whoami')
  .description('Show current user info')
  .action(async () => {
    try {
      requireAuth()

      const user = await apiRequest<{
        name: string
        email: string
        role: string
      }>('GET', '/api/v1/auth/me')

      console.log(chalk.bold('Name:  ') + user.name)
      console.log(chalk.bold('Email: ') + user.email)
      console.log(chalk.bold('Role:  ') + user.role)
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`))
      process.exit(1)
    }
  })
