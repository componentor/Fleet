# siglar

Deploy to Siglar from your terminal.

For the TypeScript SDK, see [`@siglar/sdk`](https://www.npmjs.com/package/@siglar/sdk).

## Installation

```bash
npm install -g siglar
```

## Usage

```bash
# First time setup
siglar init      # Creates .siglar.json (auto-gitignored)
siglar login     # Saves your API key

# Deploy
siglar publish   # Package and deploy your project

# Monitor
siglar status    # Show service status
siglar logs      # Show recent logs
```

## Configuration

The CLI reads config from multiple sources (highest priority first):

1. **Environment variables**: `SIGLAR_API_KEY`, `SIGLAR_URL`, `SIGLAR_SERVICE_ID`
2. **`.env` / `.env.local`**: Reads `SIGLAR_*` keys automatically
3. **`.siglar.json`**: Project config file (created by `siglar init`)

Example `.siglar.json`:

```json
{
  "url": "https://yoursiglar.com/api/v1",
  "apiKey": "your_api_key",
  "name": "my-app"
}
```

Example `.env`:

```env
SIGLAR_API_KEY=your_api_key
SIGLAR_URL=https://yoursiglar.com/api/v1
```

## How `siglar publish` works

1. Creates a tar.gz archive of your project (uses `git archive` if available, respects `.gitignore`)
2. If a service with the configured name already exists, rebuilds it
3. Otherwise creates a new service and auto-detects the build method (Dockerfile, docker-compose, etc.)
4. Saves the `serviceId` to `.siglar.json` for faster subsequent deploys

## Automatic deployments (CI/CD)

Use `siglar publish` in your CI pipeline to deploy on every push. Since the CLI reads environment variables, you don't need a config file — just set `SIGLAR_API_KEY`, `SIGLAR_URL`, and `SIGLAR_SERVICE_ID` as secrets.

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Siglar

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install -g siglar

      - run: siglar publish
        env:
          SIGLAR_API_KEY: ${{ secrets.SIGLAR_API_KEY }}
          SIGLAR_URL: ${{ secrets.SIGLAR_URL }}
          SIGLAR_SERVICE_ID: ${{ secrets.SIGLAR_SERVICE_ID }}
```

### GitLab CI

```yaml
# .gitlab-ci.yml
deploy:
  image: node:20-alpine
  stage: deploy
  only:
    - main
  script:
    - npm install -g siglar
    - siglar publish
  variables:
    SIGLAR_API_KEY: $SIGLAR_API_KEY
    SIGLAR_URL: $SIGLAR_URL
    SIGLAR_SERVICE_ID: $SIGLAR_SERVICE_ID
```

### Bitbucket Pipelines

```yaml
# bitbucket-pipelines.yml
pipelines:
  branches:
    main:
      - step:
          name: Deploy to Siglar
          image: node:20
          script:
            - npm install -g siglar
            - siglar publish
```

Set `SIGLAR_API_KEY`, `SIGLAR_URL`, and `SIGLAR_SERVICE_ID` in your repository's pipeline variables.

### Getting the service ID

Run `siglar publish` once locally — it creates the service and saves the `serviceId` to `.siglar.json`. Copy that ID into your CI secrets as `SIGLAR_SERVICE_ID`. Or find it in your Siglar dashboard under the service settings.
