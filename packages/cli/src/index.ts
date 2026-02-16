#!/usr/bin/env node
import { program } from 'commander'
import { initCommand } from './commands/init.js'
import { joinCommand } from './commands/join.js'
import { statusCommand } from './commands/status.js'

program
  .name('hoster')
  .description('Hoster CLI — manage your hosting platform')
  .version('0.1.0')

program
  .command('init')
  .description('Initialize the first node and deploy the Hoster stack')
  .option('-d, --domain <domain>', 'Platform domain (e.g., panel.example.com)')
  .option('-e, --email <email>', 'Admin email address')
  .action(initCommand)

program
  .command('join')
  .description('Join this node to an existing Hoster swarm')
  .option('-t, --token <token>', 'Swarm join token')
  .option('-a, --address <address>', 'Manager node address (ip:port)')
  .action(joinCommand)

program
  .command('status')
  .description('Show cluster status')
  .action(statusCommand)

program.parse()
