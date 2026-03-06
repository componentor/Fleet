#!/usr/bin/env node
import { program } from 'commander'
import { loginCommand } from './commands/login.js'
import { logoutCommand } from './commands/logout.js'
import { whoamiCommand } from './commands/whoami.js'
import { deployCommand } from './commands/deploy.js'
import { servicesCommand } from './commands/services.js'
import { logsCommand } from './commands/logs.js'
import { scaleCommand } from './commands/scale.js'
import { stopCommand } from './commands/stop.js'
import { startCommand } from './commands/start.js'
import { restartCommand } from './commands/restart.js'
import { destroyCommand } from './commands/destroy.js'
import { domainsCommand } from './commands/domains.js'
import { backupsCommand } from './commands/backups.js'
import { sshCommand } from './commands/ssh.js'
import { sshKeysCommand } from './commands/ssh-keys.js'
import { marketplaceCommand } from './commands/marketplace.js'
import { initCommand } from './commands/init.js'
import { joinCommand } from './commands/join.js'
import { statusCommand } from './commands/status.js'

program
  .name('siglar')
  .description('Siglar CLI — manage your hosting platform')
  .version('0.1.0')

// Auth commands
program.addCommand(loginCommand)
program.addCommand(logoutCommand)
program.addCommand(whoamiCommand)

// Service commands
program.addCommand(deployCommand)
program.addCommand(servicesCommand)
program.addCommand(logsCommand)
program.addCommand(scaleCommand)
program.addCommand(stopCommand)
program.addCommand(startCommand)
program.addCommand(restartCommand)
program.addCommand(destroyCommand)
program.addCommand(sshCommand)

// Resource commands
program.addCommand(domainsCommand)
program.addCommand(backupsCommand)
program.addCommand(sshKeysCommand)
program.addCommand(marketplaceCommand)

// Infrastructure commands
program.addCommand(initCommand)
program.addCommand(joinCommand)
program.addCommand(statusCommand)

program.parse()
