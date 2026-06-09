import { execSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import * as p from '@clack/prompts'
import c from 'ansis'
import { COMPANY_GIT_HOST } from './constants.ts'

// ============================================================
// JSON 文件操作
// ============================================================

export async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8')
  return JSON.parse(content) as T
}

export async function writeJson(filePath: string, data: unknown, options?: { createDir?: boolean }) {
  if (options?.createDir) {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dirname(filePath), { recursive: true })
  }
  const content = JSON.stringify(data, null, 2) + '\n'
  await writeFile(filePath, content, 'utf-8')
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises')
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}

// ============================================================
// Git 探测
// ============================================================

export function getGitRemoteUrl(): string | null {
  try {
    return execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim() || null
  }
  catch {
    return null
  }
}

export function isCompanyProject(): boolean {
  const url = getGitRemoteUrl()
  return url?.includes(COMPANY_GIT_HOST) ?? false
}

// ============================================================
// 二进制检查 & 自动安装
// ============================================================

function which(cmd: string): string | null {
  try {
    return execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8' }).trim() || null
  }
  catch {
    return null
  }
}

function getNodeMajorVersion(): number {
  const v = process.version.replace('v', '').split('.')[0]
  return Number.parseInt(v, 10)
}

export function checkAndInstallBinaries(): void {
  const hasOxlint = which('oxlint')
  const hasOxfmt = which('oxfmt')

  if (hasOxlint && hasOxfmt) {
    p.log.success(c.green('oxlint and oxfmt are already installed'))
    return
  }

  const missing: string[] = []
  if (!hasOxlint) missing.push('oxlint')
  if (!hasOxfmt) missing.push('oxfmt')

  p.log.warn(c.yellow(`Missing binaries: ${missing.join(', ')}`))

  const hasBun = which('bun')
  if (hasBun) {
    p.log.info(c.cyan('Installing via bun...'))
    try {
      execSync('bun install -g oxlint oxfmt', { stdio: 'inherit' })
      p.log.success(c.green('Installed oxlint and oxfmt via bun'))
    }
    catch (e) {
      p.log.error(c.red(`Failed to install via bun: ${e instanceof Error ? e.message : String(e)}`))
      process.exit(1)
    }
    return
  }

  const nodeMajor = getNodeMajorVersion()
  if (nodeMajor < 18) {
    p.log.error(c.red(`Node.js ${process.version} is too old (need >= 18).`))
    p.log.error(c.red('Please upgrade Node.js or install bun: https://bun.sh'))
    process.exit(1)
  }

  p.log.info(c.cyan('Installing via npm...'))
  try {
    execSync('npm install -g oxlint oxfmt', { stdio: 'inherit' })
    p.log.success(c.green('Installed oxlint and oxfmt via npm'))
  }
  catch (e) {
    p.log.error(c.red(`Failed to install via npm: ${e instanceof Error ? e.message : String(e)}`))
    process.exit(1)
  }
}
