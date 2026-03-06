import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

export interface FleetConfig {
  apiUrl: string
  accessToken?: string
  refreshToken?: string
  apiKey?: string
  accountId?: string
}

export interface ProjectConfig {
  service?: string
  accountId?: string
  apiUrl?: string
}

const CONFIG_DIR = join(homedir(), '.siglar')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const PROJECT_CONFIG_NAME = '.siglar.json'

const DEFAULT_CONFIG: FleetConfig = {
  apiUrl: 'http://localhost:3000',
}

export function loadConfig(): FleetConfig {
  try {
    const data = readFileSync(CONFIG_FILE, 'utf-8')
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: FleetConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

export function clearConfig(): void {
  try {
    unlinkSync(CONFIG_FILE)
  } catch {
    // File may not exist, that's fine
  }
}

export function getApiUrl(): string {
  const project = loadProjectConfig()
  if (project?.apiUrl) return project.apiUrl
  return loadConfig().apiUrl
}

export function getAccountId(): string | undefined {
  const project = loadProjectConfig()
  if (project?.accountId) return project.accountId
  return loadConfig().accountId
}

/**
 * Walk up from CWD to find a .siglar.json project config file.
 */
export function loadProjectConfig(): ProjectConfig | null {
  let dir = process.cwd()
  const root = resolve('/')

  while (dir !== root) {
    const configPath = join(dir, PROJECT_CONFIG_NAME)
    if (existsSync(configPath)) {
      try {
        const data = readFileSync(configPath, 'utf-8')
        return JSON.parse(data) as ProjectConfig
      } catch {
        return null
      }
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Write a .siglar.json project config file in the given directory.
 */
export function writeProjectConfig(dir: string, config: ProjectConfig): void {
  const configPath = join(dir, PROJECT_CONFIG_NAME)
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}
