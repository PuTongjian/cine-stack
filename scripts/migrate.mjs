import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dataDir = resolve(process.env.DATA_DIR || 'data')
await mkdir(dataDir, { recursive: true })
new DatabaseSync(resolve(dataDir, 'library.db')).close()
const result = spawnSync(
  process.execPath,
  ['../../node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  {
    cwd: 'apps/api',
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: 'inherit',
  }
)
process.exitCode = result.status || 0
