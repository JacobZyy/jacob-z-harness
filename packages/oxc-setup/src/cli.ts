import process from 'node:process'
import * as p from '@clack/prompts'
import c from 'ansis'
import { cac } from 'cac'
import { checkAndInstallBinaries } from './utils.ts'
import { initGlobal } from './commands/init.ts'
import { patchOpencode } from './commands/opencode.ts'
import { initProjectInteractive } from './commands/project.ts'

import { version } from '../package.json'

const cli = cac('oxc-setup')

cli
  .command('', 'Interactive setup for oxlint + oxfmt')
  .action(async () => {
    p.intro(`${c.green`oxc-setup`} ${c.dim`v${version}`}`)

    const mode = await p.select({
      message: 'What would you like to configure?',
      options: [
        { label: 'Global (personal) setup', value: 'global', hint: '~/.config/oxc/ + opencode.json' },
        { label: 'Project setup', value: 'project', hint: 'auto-detect company/personal' },
      ],
    })

    if (p.isCancel(mode)) {
      p.cancel('Operation cancelled.')
      process.exit(0)
    }

    if (mode === 'global') {
      const s = p.spinner()
      s.start('Setting up global configs...')
      await initGlobal()
      await patchOpencode()
      s.stop('Global configs done')
      checkAndInstallBinaries()
    }
    else {
      const s = p.spinner()
      s.start('Detecting project type...')
      s.stop()
      await initProjectInteractive()
      checkAndInstallBinaries()
    }

    p.outro(c.green('Setup completed!'))
  })

cli.help()
cli.version(version)
cli.parse()
