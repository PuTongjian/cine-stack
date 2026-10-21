import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
config({ path: resolve(rootDir, '.env'), quiet: true });
export const dataDir = resolve(rootDir, process.env.DATA_DIR || 'data');
