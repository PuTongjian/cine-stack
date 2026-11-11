import 'reflect-metadata'
import { mkdir } from 'node:fs/promises'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app/app.module.js'
import { quarkTv, strm, tasks } from './app/services.js'
import { createAuth } from './infrastructure/auth.js'
import { dataDir } from './infrastructure/config.js'
import { database } from './infrastructure/database.js'

await mkdir(dataDir, { recursive: true })
await database.$connect()
await quarkTv.initialize()
await strm.initialize()
await tasks.initialize()
const app = await NestFactory.create(AppModule)
// Deployment origins must be explicitly configured; local development stays available.
app.use((req: any, res: any, next: any) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin
    if (
      origin &&
      origin !== process.env.APP_ORIGIN &&
      !/^http:\/\/(127\.0\.0\.1|localhost):(3001|5173|8080)$/.test(origin)
    )
      return res.status(403).json({ message: 'ORIGIN_DENIED' })
    if (!req.is('application/json'))
      return res.status(415).json({ message: 'JSON_REQUIRED' })
  }
  next()
})
// Register parsers before authentication middleware, which reads the login body.
app.use((await import('express')).json({ limit: '64kb' }))
app.use(await createAuth(req => strm.authorize(req)))
app.enableShutdownHooks()
await app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || '127.0.0.1'
)
