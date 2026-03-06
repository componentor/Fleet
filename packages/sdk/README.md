# @fleet/sdk

TypeScript SDK for the Fleet hosting platform API. Zero dependencies — uses native `fetch`.

## Installation

```bash
npm install @fleet/sdk
```

## Quick Start

```typescript
import { FleetClient } from '@fleet/sdk'

const fleet = new FleetClient({
  apiKey: 'fleet_your_api_key_here',
  baseUrl: 'https://yourfleet.com/api/v1',
})
```

## Services

```typescript
// Create a service
const service = await fleet.services.create({
  name: 'my-app',
  image: 'nginx:alpine',
  ports: [{ target: 80 }],
  env: { NODE_ENV: 'production' },
})

// List all services
const services = await fleet.services.list()

// Get a specific service
const svc = await fleet.services.get(service.id)

// Update a service
await fleet.services.update(service.id, {
  replicas: 3,
  env: { NODE_ENV: 'production', API_URL: 'https://api.example.com' },
})

// Lifecycle operations
await fleet.services.restart(service.id)
await fleet.services.stop(service.id)
await fleet.services.start(service.id)
await fleet.services.redeploy(service.id)

// Get logs
const { logs } = await fleet.services.logs(service.id, { tail: 500 })

// Delete
await fleet.services.delete(service.id)
```

## Deployments

```typescript
// List deployments
const deployments = await fleet.deployments.list(service.id)

// Wait for a deployment to complete (polls until succeeded/failed)
const result = await fleet.deployments.waitUntilReady(
  service.id,
  deployment.id,
  { timeoutMs: 120_000 },
)

if (result.status === 'succeeded') {
  console.log('Deployed successfully!')
}
```

## DNS

```typescript
// Create a DNS zone
const zone = await fleet.dns.zones.create({ domain: 'example.com' })

// Add records
await fleet.dns.records.create({
  zoneId: zone.id,
  type: 'A',
  name: '@',
  content: '1.2.3.4',
})

await fleet.dns.records.create({
  zoneId: zone.id,
  type: 'CNAME',
  name: 'www',
  content: 'example.com',
})

// List records
const records = await fleet.dns.records.list(zone.id)
```

## Domains

```typescript
// List shared domains
const domains = await fleet.domains.list()
```

## Error Handling

```typescript
import { FleetClient, FleetApiError } from '@fleet/sdk'

try {
  await fleet.services.get('nonexistent-id')
} catch (err) {
  if (err instanceof FleetApiError) {
    console.log(err.status)  // 404
    console.log(err.message) // "Service not found"
  }
}
```

## API Key Scopes

API keys can have scopes: `read`, `write`, `admin`, or `*` (full access).

- **read** — List and get resources
- **write** — Create, update, delete resources
- **admin** — Full access including account management

Create API keys in your Fleet dashboard under Account Settings > API Keys.

## Requirements

- Node.js 18+ (uses native `fetch`)
- Works in browsers and edge runtimes that support `fetch`
