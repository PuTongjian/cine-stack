import { defineConfig } from 'prisma/config';
import { resolve } from 'node:path';
export default defineConfig({ schema: 'prisma/schema.prisma', datasource: { url: `file:${resolve(process.env.DATA_DIR || '../../data', 'library.db')}` } });
