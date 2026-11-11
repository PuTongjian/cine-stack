import { resolve } from 'node:path'
import { defineConfig } from 'prisma/config'
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: `file:${resolve(process.env.DATA_DIR || '../../data', 'library.db')}`,
  },
})
