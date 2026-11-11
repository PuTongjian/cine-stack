import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
export const rootDir = fileURLToPath(new URL('../../../../', import.meta.url))
config({ path: resolve(rootDir, '.env'), quiet: true })
export const dataDir = resolve(rootDir, process.env.DATA_DIR || 'data')
