import { execSync } from 'node:child_process'

interface JoinOptions {
  token?: string
  address?: string
}

export async function joinCommand(options: JoinOptions) {
  console.log('🔗 Joining Hoster swarm...\n')

  if (!options.token || !options.address) {
    console.log('No token/address provided. Starting setup wizard...')
    console.log('Visit http://localhost:80 to complete the setup via the web wizard.')
    // TODO: Start temporary HTTP server with setup wizard
    return
  }

  console.log('1. Checking Docker...')
  try {
    execSync('docker info', { stdio: 'ignore' })
    console.log('   ✓ Docker is installed')
  } catch {
    console.error('   ✗ Docker is not installed. Please install Docker first.')
    process.exit(1)
  }

  console.log('2. Joining swarm...')
  try {
    execSync(`docker swarm join --token ${options.token} ${options.address}`, {
      stdio: 'inherit',
    })
    console.log('   ✓ Joined swarm')
  } catch {
    console.error('   ✗ Failed to join swarm')
    process.exit(1)
  }

  console.log('\n✅ Node joined the Hoster swarm!')
  console.log('   The agent will be automatically deployed to this node.')
}
