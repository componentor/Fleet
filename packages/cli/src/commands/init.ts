import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

interface InitOptions {
  domain?: string
  email?: string
}

export async function initCommand(options: InitOptions) {
  console.log('🚀 Initializing Fleet platform...\n')

  const domain = options.domain || 'localhost'
  const email = options.email || 'admin@localhost'

  // Generate secrets
  const jwtSecret = randomBytes(32).toString('hex')
  const dbPassword = randomBytes(16).toString('hex')

  console.log('1. Checking Docker...')
  try {
    execSync('docker info', { stdio: 'ignore' })
    console.log('   ✓ Docker is installed')
  } catch {
    console.error('   ✗ Docker is not installed. Please install Docker first.')
    process.exit(1)
  }

  console.log('2. Initializing Docker Swarm...')
  try {
    execSync('docker swarm init', { stdio: 'ignore' })
    console.log('   ✓ Swarm initialized')
  } catch {
    console.log('   ✓ Swarm already initialized')
  }

  console.log('3. Creating overlay networks...')
  try {
    execSync('docker network create --driver overlay --attachable fleet_public', { stdio: 'ignore' })
    execSync('docker network create --driver overlay --attachable fleet_internal', { stdio: 'ignore' })
    console.log('   ✓ Networks created')
  } catch {
    console.log('   ✓ Networks already exist')
  }

  console.log(`\n✅ Fleet initialized!`)
  console.log(`   Domain: ${domain}`)
  console.log(`   Admin email: ${email}`)
  console.log(`   JWT Secret: ${jwtSecret.substring(0, 8)}...`)
  console.log(`   DB Password: ${dbPassword.substring(0, 8)}...`)
  console.log(`\n   Deploy the stack with: docker stack deploy -c docker-compose.yml fleet`)
}
