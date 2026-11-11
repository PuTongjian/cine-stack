import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { NextFunction, Request, Response } from 'express'
import { dataDir } from './config.js'

export async function createAuth(authorizeStream?: (req: Request) => boolean) {
  const credentialsFile = resolve(dataDir, 'admin.json')
  let credentials: { salt: string; hash: string; secret: string }
  try {
    credentials = JSON.parse(await readFile(credentialsFile, 'utf8'))
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw new Error('ADMIN_CONFIG_INVALID')
    const password = process.env.ADMIN_PASSWORD
    if (!password || password.length < 12)
      throw new Error('ADMIN_PASSWORD must contain at least 12 characters.')
    const salt = randomBytes(16).toString('hex')
    credentials = {
      salt,
      hash: scryptSync(password, salt, 32).toString('hex'),
      secret: randomBytes(32).toString('hex'),
    }
    await writeFile(credentialsFile, JSON.stringify(credentials), {
      mode: 0o600,
      flag: 'wx',
    })
  }
  const sign = (payload: string) =>
    createHmac('sha256', credentials.secret).update(payload).digest('base64url')
  const verify = (token: string) => {
    const [payload, signature] = token.split('.')
    if (!payload || !signature || !/^\d+$/.test(payload)) return false
    const expected = Buffer.from(sign(payload))
    const actual = Buffer.from(signature)
    return (
      expected.length === actual.length &&
      timingSafeEqual(expected, actual) &&
      Number(payload) > Date.now()
    )
  }
  const attempts = new Map<string, { count: number; until: number }>()
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) return next()
    if (
      ['GET', 'HEAD'].includes(req.method) &&
      (req.path === '/api/health' || authorizeStream?.(req))
    )
      return next()
    const cookie =
      req.headers.cookie
        ?.split(';')
        .map(part => part.trim())
        .find(part => part.startsWith('movie_session='))
        ?.slice(14) || ''
    if (req.path === '/api/auth/login' && req.method === 'POST') {
      const address = req.ip || 'local'
      const attempt = attempts.get(address)
      if (attempt && attempt.until > Date.now() && attempt.count >= 10)
        return res
          .status(429)
          .json({ message: '尝试次数过多，请 10 分钟后重试。' })
      const password = req.body?.password
      if (typeof password !== 'string' || password.length > 256)
        return res.status(400).json({ message: 'INVALID_PASSWORD' })
      const hash = scryptSync(password, credentials.salt, 32)
      if (!timingSafeEqual(hash, Buffer.from(credentials.hash, 'hex'))) {
        attempts.set(address, {
          count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1,
          until: Date.now() + 600_000,
        })
        return res.status(401).json({ message: '管理密码不正确' })
      }
      attempts.delete(address)
      const payload = String(Date.now() + 7 * 86400_000)
      res.setHeader(
        'Set-Cookie',
        `movie_session=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`
      )
      return res.json({ authenticated: true })
    }
    if (req.path === '/api/auth/status')
      return res.json({ authenticated: verify(cookie) })
    if (!verify(cookie))
      return res.status(401).json({ message: 'AUTH_REQUIRED' })
    if (req.path === '/api/auth/logout' && req.method === 'POST') {
      res.setHeader(
        'Set-Cookie',
        'movie_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
      )
      return res.json({ authenticated: false })
    }
    next()
  }
}
