import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface FleetConfig {
  apiUrl: string
  accessToken?: string
  refreshToken?: string
}

const CONFIG_DIR = join(homedir(), '.fleet')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

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
  return loadConfig().apiUrl
}
