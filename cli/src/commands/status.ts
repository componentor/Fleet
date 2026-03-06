import { Command } from 'commander'
import { execSync } from 'node:child_process'
import chalk from 'chalk'
import Table from 'cli-table3'

export const statusCommand = new Command('status')
  .description('Show cluster status')
  .action(async () => {
    try {
      console.log(chalk.bold.blue('Fleet Cluster Status\n'))

      // Swarm Nodes
      console.log(chalk.bold('Swarm Nodes:'))
      try {
        const nodesRaw = execSync(
          'docker node ls --format "{{.Hostname}}|{{.Status}}|{{.Availability}}|{{.ManagerStatus}}"',
          { encoding: 'utf-8' },
        ).trim()

        if (nodesRaw) {
          const nodeTable = new Table({
            head: [
              chalk.cyan('Hostname'),
              chalk.cyan('Status'),
              chalk.cyan('Availability'),
              chalk.cyan('Manager'),
            ],
          })

          for (const line of nodesRaw.split('\n')) {
            const parts = line.split('|')
            nodeTable.push([
              parts[0] || '-',
              formatNodeStatus(parts[1] || ''),
              parts[2] || '-',
              parts[3] || '-',
            ])
          }

          console.log(nodeTable.toString())
        }
      } catch {
        console.log(chalk.yellow('  Could not fetch node information.'))
      }

      console.log('')

      // Services
      console.log(chalk.bold('Services:'))
      try {
        const servicesRaw = execSync(
          'docker service ls --format "{{.Name}}|{{.Replicas}}|{{.Image}}"',
          { encoding: 'utf-8' },
        ).trim()

        if (servicesRaw) {
          const serviceTable = new Table({
            head: [
              chalk.cyan('Name'),
              chalk.cyan('Replicas'),
              chalk.cyan('Image'),
            ],
          })

          for (const line of servicesRaw.split('\n')) {
            const parts = line.split('|')
            serviceTable.push([parts[0] || '-', parts[1] || '-', parts[2] || '-'])
          }

          console.log(serviceTable.toString())
        }
      } catch {
        console.log(chalk.yellow('  Could not fetch service information.'))
      }
    } catch {
      console.error(
        chalk.red('Failed to get cluster status. Is Docker Swarm initialized?'),
      )
      console.error(chalk.yellow('Run: siglar init'))
      process.exit(1)
    }
  })

function formatNodeStatus(status: string): string {
  switch (status?.toLowerCase()) {
    case 'ready':
      return chalk.green(status)
    case 'down':
      return chalk.red(status)
    default:
      return status || '-'
  }
}
