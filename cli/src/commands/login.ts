import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
import ora from 'ora'
import { loadConfig, saveConfig } from '../config.js'
import { apiRequest } from '../client.js'

export const loginCommand = new Command('login')
  .description('Log in to Fleet')
  .option('--api-url <url>', 'Fleet API URL')
  .option('--api-key <key>', 'Authenticate with an API key instead of email/password')
  .action(async (options: { apiUrl?: string; apiKey?: string }) => {
    try {
      const config = loadConfig()

      if (options.apiUrl) {
        config.apiUrl = options.apiUrl
        saveConfig(config)
      }

      // API key authentication
      if (options.apiKey) {
        config.apiKey = options.apiKey
        delete config.accessToken
        delete config.refreshToken
        saveConfig(config)

        const spinner = ora('Verifying API key...').start()

        try {
          const me = await apiRequest<{ email: string }>('GET', '/api/v1/auth/me')
          spinner.succeed(chalk.green(`Authenticated as ${me.email} (API key)`))
        } catch {
          config.apiKey = undefined
          saveConfig(config)
          spinner.fail(chalk.red('Invalid API key'))
          process.exit(1)
        }

        await selectAccount(config)
        return
      }

      // Interactive email/password login
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
        delete config.apiKey
        saveConfig(config)

        spinner.succeed(chalk.green(`Logged in as ${email}`))
      } else {
        config.accessToken = response.accessToken
        config.refreshToken = response.refreshToken
        delete config.apiKey
        saveConfig(config)

        spinner.succeed(chalk.green(`Logged in as ${email}`))
      }

      await selectAccount(config)
    } catch (err) {
      console.error(chalk.red(`Login failed: ${(err as Error).message}`))
      process.exit(1)
    }
  })

async function selectAccount(config: ReturnType<typeof loadConfig>): Promise<void> {
  try {
    const accounts = await apiRequest<Array<{ id: string; name: string; slug: string }>>(
      'GET',
      '/api/v1/accounts',
    )

    if (accounts.length === 0) {
      return
    }

    if (accounts.length === 1) {
      config.accountId = accounts[0].id
      saveConfig(config)
      console.log(chalk.dim(`  Account: ${accounts[0].name}`))
      return
    }

    const { accountId } = await inquirer.prompt<{ accountId: string }>([
      {
        type: 'list',
        name: 'accountId',
        message: 'Select an account:',
        choices: accounts.map((a) => ({ name: `${a.name} (${a.slug})`, value: a.id })),
      },
    ])

    config.accountId = accountId
    saveConfig(config)
  } catch {
    // Account selection is optional — may fail if API key has limited scopes
  }
}
