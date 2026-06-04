import { loadStrategy } from './lib/lint-strategy.ts'
// plugins/hyperclaudemia/scripts/lint-strategy-warmup.ts
/// <reference types="bun-types" />
import { createHookLogger } from './logger.ts'

const log = createHookLogger('SessionStart', 'lint-strategy-warmup.ts')

function main(): void {
  try {
    const cwd = process.cwd()
    const { strategy, eslintVersion } = loadStrategy(cwd)
    log.done(`warmed strategy for ${cwd}: ${strategy}${eslintVersion ? ` (eslint@${eslintVersion})` : ''}`)
  }
  catch (e) {
    log.done(`warmup failed: ${(e as Error).message}`, 'warn')
  }
  process.exit(0)
}

main()
