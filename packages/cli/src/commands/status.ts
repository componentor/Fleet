import { execSync } from 'node:child_process'

export async function statusCommand() {
  console.log('📊 Hoster Cluster Status\n')

  try {
    console.log('Swarm Nodes:')
    console.log('─'.repeat(60))
    const nodes = execSync('docker node ls --format "table {{.Hostname}}\t{{.Status}}\t{{.Availability}}\t{{.ManagerStatus}}"', {
      encoding: 'utf-8',
    })
    console.log(nodes)

    console.log('Services:')
    console.log('─'.repeat(60))
    const services = execSync('docker service ls --format "table {{.Name}}\t{{.Replicas}}\t{{.Image}}"', {
      encoding: 'utf-8',
    })
    console.log(services)
  } catch (err) {
    console.error('Failed to get cluster status. Is Docker Swarm initialized?')
    console.error('Run: hoster init')
  }
}
