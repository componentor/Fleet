import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
import ora from 'ora'
import { loadConfig, saveConfig } from '../config.js'
import { apiRequest } from '../client.js'

export const loginCommand = new Command('login')
  .description('Log in to Fleet')
  .option('--api-url <url>', 'Fleet API URL')
  .action(async (options: { apiUrl?: string }) => {
    try {
      const config = loadConfig()

      if (options.apiUrl) {
        config.apiUrl = options.apiUrl
        saveConfig(config)
      }

      const { email } = await inquirer.prompt<{ email: string }>([
        {
          type: 'input',
          name: 'email',
          message: 'Email:',
          validate: (input: string) => (input.includes('@') ? true : 'Please enter a valid email'),
        },
      ])

      const { password } = await inquirer.prompt<{ password: string }>([
        {
          type: 'password',
          name: 'password',
          message: 'Password:',
          mask: '*',
          validate: (input: string) => (input.length > 0 ? true : 'Password is required'),
        },
      ])

      const spinner = ora('Logging in...').start()

      const response = await apiRequest<{
        accessToken?: string
        refreshToken?: string
        requiresTwoFactor?: boolean
        userId?: string
        tempToken?: string
      }>('POST', '/api/v1/auth/login', { email, password }, { skipAuth: true })

      if (response.requiresTwoFactor) {
        spinner.stop()

        const { code } = await inquirer.prompt<{ code: string }>([
          {
            type: 'input',
            name: 'code',
            message: 'Two-factor authentication code:',
            validate: (input: string) =>
              /^\d{6}$/.test(input) ? true : 'Please enter a 6-digit code',
          },
        ])

        spinner.start('Verifying 2FA code...')

        const twoFaResponse = await apiRequest<{
          accessToken: string
          refreshToken: string
        }>(
          'POST',
          '/api/v1/auth/2fa/verify',
          { userId: response.userId, code, tempToken: response.tempToken },
          { skipAuth: true },
        )

        config.accessToken = twoFaResponse.accessToken
        config.refreshToken = twoFaResponse.refreshToken
        saveConfig(config)

        spinner.succeed(chalk.green(`Logged in as ${email}`))
      } else {
        config.accessToken = response.accessToken
        config.refreshToken = response.refreshToken
        saveConfig(config)

        spinner.succeed(chalk.green(`Logged in as ${email}`))
      }
    } catch (err) {
      console.error(chalk.red(`Login failed: ${(err as Error).message}`))
      process.exit(1)
    }
  })
