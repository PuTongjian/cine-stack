import './config.js'
import { resolve } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'
import { dataDir } from './config.js'
export const database = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: `file:${resolve(dataDir, 'library.db')}`,
  }),
})
