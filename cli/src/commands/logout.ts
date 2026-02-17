import { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig, saveConfig } from '../config.js'

export const logoutCommand = new Command('logout')
  .description('Log out from Fleet')
  .action(() => {
    try {
      const config = loadConfig()
      delete config.accessToken
      delete config.refreshToken
      saveConfig(config)
      console.log(chalk.green('Logged out successfully.'))
    } catch (err) {
      console.error(chalk.red(`Logout failed: ${(err as Error).message}`))
      process.exit(1)
    }
  })
