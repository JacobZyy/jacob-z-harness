import { mkdir } from 'node:fs/promises'
import * as p from '@clack/prompts'
import c from 'ansis'
import {
  OXC_CONFIG_DIR,
  OXFMTRC_GLOBAL_PATH,
  OXLINTRC_GLOBAL_PATH,
  PERSONAL_OXFMTRC,
  PERSONAL_OXLINTRC,
} from '../constants.ts'
import { fileExists, writeJson } from '../utils.ts'

export async function initGlobal() {
  await mkdir(OXC_CONFIG_DIR, { recursive: true })
  p.log.success(c.green(`Ensured directory: ${OXC_CONFIG_DIR}`))

  const oxlintExists = await fileExists(OXLINTRC_GLOBAL_PATH)
  if (oxlintExists) {
    p.log.warn(c.yellow(`Already exists (skipped): ${OXLINTRC_GLOBAL_PATH}`))
  }
  else {
    await writeJson(OXLINTRC_GLOBAL_PATH, { ...PERSONAL_OXLINTRC })
    p.log.success(c.green(`Created: ${OXLINTRC_GLOBAL_PATH}`))
  }

  const oxfmtExists = await fileExists(OXFMTRC_GLOBAL_PATH)
  if (oxfmtExists) {
    p.log.warn(c.yellow(`Already exists (skipped): ${OXFMTRC_GLOBAL_PATH}`))
  }
  else {
    await writeJson(OXFMTRC_GLOBAL_PATH, { ...PERSONAL_OXFMTRC })
    p.log.success(c.green(`Created: ${OXFMTRC_GLOBAL_PATH}`))
  }
}
