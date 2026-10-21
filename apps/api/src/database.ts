import './config.js';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { dataDir } from './config.js';
import { resolve } from 'node:path';
export const database = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${resolve(dataDir, 'library.db')}` }) });
