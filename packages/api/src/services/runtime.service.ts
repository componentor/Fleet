/**
 * Runtime detection service.
 * Detects project type from file listings and generates appropriate Dockerfiles.
 */

export interface RuntimeDetection {
  runtime: string;
  dockerfile: string;
  port: number;
}

type FileReader = (name: string) => Promise<string | null>;

/**
 * Convert a multi-line config string into a Dockerfile RUN instruction
 * that writes it to a file using a shell heredoc.
 */
function writeFileRun(config: string, targetPath: string): string {
  return `RUN cat <<'NGINX_CONF' > ${targetPath}\n${config}\nNGINX_CONF`;
}

/** Default nginx server block used for static sites and build-only Node.js projects. */
export const DEFAULT_NGINX_CONFIG = `server {
  listen 80;
  include /etc/nginx/mime.types;
  root /usr/share/nginx/html;
  index index.html;

  # Hashed assets (JS/CSS) — immutable caching
  location ~* \\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp|avif)$ {
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  # SPA fallback — only for HTML navigation requests
  location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache";
  }
}`;

/** Check whether a service uses nginx based on its image name and/or stored Dockerfile. */
export function isNginxService(image: string | null, dockerfile: string | null): boolean {
  if (image && /^nginx(:|$)/i.test(image)) return true;
  if (dockerfile && /^FROM\s+nginx/mi.test(dockerfile)) return true;
  return false;
}

/**
 * Detect the runtime from a list of root-level file names.
 * Uses an optional readFile callback to inspect file contents (e.g. package.json).
 * Detection order matters — first match wins.
 */
export async function detectRuntime(
  files: string[],
  readFile?: FileReader | null,
  nginxConfig?: string | null,
): Promise<RuntimeDetection | null> {
  const fileSet = new Set(files);

  // 1. PHP — index.php or composer.json (checked before static so index.html
  //    in a PHP project doesn't get mis-detected as a static site)
  if (fileSet.has('index.php') || fileSet.has('composer.json')) {
    return {
      runtime: 'php',
      dockerfile: generatePhpDockerfile(fileSet.has('composer.json')),
      port: 80,
    };
  }

  // 2. Node.js — package.json (checked before static because a project with
  //    package.json + index.html likely needs a build step)
  if (fileSet.has('package.json')) {
    let packageJson: PackageJsonInfo | null = null;
    if (readFile) {
      try {
        const content = await readFile('package.json');
        if (content) {
          packageJson = parsePackageJson(content);
        }
      } catch {
        // Ignore read errors, fall back to defaults
      }
    }

    // Build-only projects (Vite/React/Vue with a build script but no start
    // script): install deps, run build, serve output with nginx.
    if (packageJson && !packageJson.hasStartScript && packageJson.hasBuildScript) {
      return {
        runtime: 'static',
        dockerfile: generateNodeBuildDockerfile(fileSet, packageJson, nginxConfig),
        port: 80,
      };
    }

    return {
      runtime: 'node',
      dockerfile: generateNodeDockerfile(fileSet, packageJson),
      port: packageJson?.port ?? 3000,
    };
  }

  // 3. Static site — index.html at root (no package.json or PHP)
  if (fileSet.has('index.html')) {
    return {
      runtime: 'static',
      dockerfile: generateStaticDockerfile(nginxConfig),
      port: 80,
    };
  }

  // 4. Python — requirements.txt, Pipfile, or pyproject.toml
  if (fileSet.has('requirements.txt') || fileSet.has('Pipfile') || fileSet.has('pyproject.toml')) {
    return {
      runtime: 'python',
      dockerfile: generatePythonDockerfile(fileSet),
      port: 8000,
    };
  }

  // 5. Go — go.mod
  if (fileSet.has('go.mod')) {
    return {
      runtime: 'go',
      dockerfile: generateGoDockerfile(),
      port: 8080,
    };
  }

  // 6. Rust — Cargo.toml
  if (fileSet.has('Cargo.toml')) {
    return {
      runtime: 'rust',
      dockerfile: generateRustDockerfile(),
      port: 8080,
    };
  }

  // 7. Ruby — Gemfile
  if (fileSet.has('Gemfile') || fileSet.has('config.ru')) {
    return {
      runtime: 'ruby',
      dockerfile: generateRubyDockerfile(fileSet),
      port: 3000,
    };
  }

  return null;
}

// ── Static (nginx) ──────────────────────────────────────────────────────────

function generateStaticDockerfile(nginxConfig?: string | null): string {
  const config = nginxConfig ?? DEFAULT_NGINX_CONFIG;
  const lines = [
    'FROM nginx:alpine',
    'COPY . /usr/share/nginx/html',
    writeFileRun(config, '/etc/nginx/conf.d/default.conf'),
    'EXPOSE 80',
    'CMD ["nginx", "-g", "daemon off;"]',
  ];
  return lines.join('\n') + '\n';
}

// ── PHP (Apache) ────────────────────────────────────────────────────────────

function generatePhpDockerfile(hasComposer: boolean): string {
  const lines = [
    'FROM php:8.3-apache',
    'COPY . /var/www/html/',
  ];

  if (hasComposer) {
    lines.push(
      'RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \\',
      '    && composer install --no-dev --optimize-autoloader --working-dir=/var/www/html',
    );
  }

  lines.push(
    'RUN chown -R www-data:www-data /var/www/html',
    'EXPOSE 80',
  );

  return lines.join('\n') + '\n';
}

// ── Node.js ─────────────────────────────────────────────────────────────────

interface PackageJsonInfo {
  nodeVersion: string | null;
  hasStartScript: boolean;
  hasBuildScript: boolean;
  startCommand: string | null;
  port: number | null;
  packageManager: 'npm' | 'yarn' | 'pnpm';
}

function parsePackageJson(content: string): PackageJsonInfo | null {
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const scripts = pkg['scripts'] as Record<string, string> | undefined;
    const engines = pkg['engines'] as Record<string, string> | undefined;
    const packageManager = pkg['packageManager'] as string | undefined;

    let nodeVersion: string | null = null;
    if (engines?.['node']) {
      // Extract major version from semver range like ">=18", "^20", "20.x"
      const match = engines['node'].match(/(\d+)/);
      if (match) nodeVersion = match[1]!;
    }

    let pm: 'npm' | 'yarn' | 'pnpm' = 'npm';
    if (packageManager?.startsWith('yarn')) pm = 'yarn';
    else if (packageManager?.startsWith('pnpm')) pm = 'pnpm';

    return {
      nodeVersion,
      hasStartScript: !!scripts?.['start'],
      hasBuildScript: !!scripts?.['build'],
      startCommand: scripts?.['start'] ?? null,
      port: null,
      packageManager: pm,
    };
  } catch {
    return null;
  }
}

function generateNodeDockerfile(fileSet: Set<string>, pkg: PackageJsonInfo | null): string {
  const nodeVersion = pkg?.nodeVersion ?? '20';

  // Detect package manager from lock files
  let pm: 'npm' | 'yarn' | 'pnpm' = pkg?.packageManager ?? 'npm';
  if (fileSet.has('pnpm-lock.yaml')) pm = 'pnpm';
  else if (fileSet.has('yarn.lock')) pm = 'yarn';

  const lines = [`FROM node:${nodeVersion}-alpine`, 'WORKDIR /app'];

  // Install pnpm if needed
  if (pm === 'pnpm') {
    lines.push('RUN corepack enable && corepack prepare pnpm@latest --activate');
  }

  // Copy dependency files first (layer caching)
  switch (pm) {
    case 'pnpm':
      lines.push('COPY package.json pnpm-lock.yaml* ./');
      lines.push('RUN pnpm install --frozen-lockfile --prod');
      break;
    case 'yarn':
      lines.push('COPY package.json yarn.lock* ./');
      lines.push('RUN yarn install --production --frozen-lockfile');
      break;
    default:
      lines.push('COPY package*.json ./');
      lines.push('RUN npm ci --omit=dev');
      break;
  }

  lines.push('COPY . .');
  lines.push('EXPOSE 3000');
  lines.push('CMD ["npm", "start"]');

  return lines.join('\n') + '\n';
}

// ── Node.js build-only (Vite / React / Vue → nginx) ─────────────────────────

function generateNodeBuildDockerfile(fileSet: Set<string>, pkg: PackageJsonInfo, nginxConfig?: string | null): string {
  const nodeVersion = pkg.nodeVersion ?? '20';

  let pm: 'npm' | 'yarn' | 'pnpm' = pkg.packageManager ?? 'npm';
  if (fileSet.has('pnpm-lock.yaml')) pm = 'pnpm';
  else if (fileSet.has('yarn.lock')) pm = 'yarn';

  const lines = [
    `FROM node:${nodeVersion}-alpine AS builder`,
    'WORKDIR /app',
  ];

  if (pm === 'pnpm') {
    lines.push('RUN corepack enable && corepack prepare pnpm@latest --activate');
  }

  // Install ALL deps (including devDependencies for the bundler)
  switch (pm) {
    case 'pnpm':
      lines.push('COPY package.json pnpm-lock.yaml* ./');
      lines.push('RUN pnpm install --frozen-lockfile');
      break;
    case 'yarn':
      lines.push('COPY package.json yarn.lock* ./');
      lines.push('RUN yarn install --frozen-lockfile');
      break;
    default:
      lines.push('COPY package*.json ./');
      lines.push('RUN npm ci');
      break;
  }

  lines.push('COPY . .');

  const buildCmd = pm === 'pnpm' ? 'pnpm run build' : pm === 'yarn' ? 'yarn build' : 'npm run build';
  lines.push(`RUN ${buildCmd}`);

  // Serve the built output with nginx
  const config = nginxConfig ?? DEFAULT_NGINX_CONFIG;
  lines.push('');
  lines.push('FROM nginx:alpine');
  lines.push(`COPY --from=builder /app/dist /usr/share/nginx/html`);
  lines.push(writeFileRun(config, '/etc/nginx/conf.d/default.conf'));
  lines.push('EXPOSE 80');
  lines.push('CMD ["nginx", "-g", "daemon off;"]');

  return lines.join('\n') + '\n';
}

// ── Python ──────────────────────────────────────────────────────────────────

function generatePythonDockerfile(fileSet: Set<string>): string {
  const lines = [
    'FROM python:3.12-slim',
    'WORKDIR /app',
  ];

  if (fileSet.has('Pipfile')) {
    lines.push(
      'COPY Pipfile Pipfile.lock* ./',
      'RUN pip install --no-cache-dir pipenv && pipenv install --deploy --system',
    );
  } else if (fileSet.has('pyproject.toml')) {
    lines.push(
      'COPY pyproject.toml ./',
      'RUN pip install --no-cache-dir .',
    );
  } else {
    lines.push(
      'COPY requirements.txt ./',
      'RUN pip install --no-cache-dir -r requirements.txt',
    );
  }

  lines.push('COPY . .');
  lines.push('EXPOSE 8000');

  // Detect Django
  if (fileSet.has('manage.py')) {
    lines.push('CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]');
  } else if (fileSet.has('app.py') || fileSet.has('main.py')) {
    // Flask or FastAPI
    const entrypoint = fileSet.has('app.py') ? 'app' : 'main';
    lines.push(`CMD ["python", "-m", "uvicorn", "${entrypoint}:app", "--host", "0.0.0.0", "--port", "8000"]`);
  } else {
    lines.push('CMD ["python", "app.py"]');
  }

  return lines.join('\n') + '\n';
}

// ── Go (multi-stage) ────────────────────────────────────────────────────────

function generateGoDockerfile(): string {
  return `FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app/server .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
COPY --from=builder /app/server /server
EXPOSE 8080
CMD ["/server"]
`;
}

// ── Rust (multi-stage) ──────────────────────────────────────────────────────

function generateRustDockerfile(): string {
  return `FROM rust:1.77-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/app /usr/local/bin/app
EXPOSE 8080
CMD ["app"]
`;
}

// ── Ruby ────────────────────────────────────────────────────────────────────

function generateRubyDockerfile(fileSet: Set<string>): string {
  const lines = [
    'FROM ruby:3.3-slim',
    'RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev && rm -rf /var/lib/apt/lists/*',
    'WORKDIR /app',
  ];

  if (fileSet.has('Gemfile')) {
    lines.push(
      'COPY Gemfile Gemfile.lock* ./',
      'RUN bundle install --without development test',
    );
  }

  lines.push('COPY . .');
  lines.push('EXPOSE 3000');

  if (fileSet.has('config.ru') && fileSet.has('Gemfile')) {
    // Rails or Rack app
    lines.push('CMD ["bundle", "exec", "rails", "server", "-b", "0.0.0.0"]');
  } else if (fileSet.has('config.ru')) {
    lines.push('CMD ["rackup", "-o", "0.0.0.0"]');
  } else {
    lines.push('CMD ["ruby", "app.rb"]');
  }

  return lines.join('\n') + '\n';
}
