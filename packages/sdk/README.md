# @siglar/sdk

TypeScript SDK for the Siglar hosting platform API. Zero dependencies — uses native `fetch`.

For the CLI, see [`siglar`](https://www.npmjs.com/package/siglar) (`npm i -g siglar`).

## Installation

```bash
npm install @siglar/sdk
```

## Quick Start

```typescript
import { SiglarClient } from '@siglar/sdk'

const siglar = new SiglarClient({
  apiKey: 'your_api_key_here',
  baseUrl: 'https://yoursiglar.com/api/v1',
})

// Create a service
const service = await siglar.services.create({
  name: 'my-app',
  image: 'nginx:alpine',
  ports: [{ target: 80 }],
})

// List services
const services = await siglar.services.list()

// Deploy, restart, stop, start
await siglar.services.redeploy(service.id)
await siglar.services.restart(service.id)

// Logs
const { logs } = await siglar.services.logs(service.id, { tail: 500 })
```

## Error Handling

```typescript
import { SiglarClient, SiglarApiError } from '@siglar/sdk'

try {
  await siglar.services.get('nonexistent-id')
} catch (err) {
  if (err instanceof SiglarApiError) {
    console.log(err.status)  // 404
    console.log(err.message) // "Service not found"
  }
}
```

## Requirements

- Node.js 18+ (uses native `fetch`)
- Works in browsers and edge runtimes that support `fetch`
