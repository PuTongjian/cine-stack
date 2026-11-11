import { createHash } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import { QuarkTvClient } from '../../../packages/crawler-engine/src/quark/tv.mjs'

afterEach(() => vi.useRealTimers())
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status })

test('QR login signs requests, waits for confirmation and persists tokens without exposing them', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
  const saveCredentials = vi.fn()
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      json({
        status: 200,
        qr_data: 'aW1hZ2U=',
        query_token: 'secret-query-token',
      })
    )
    .mockResolvedValueOnce(json({ status: -1, errno: 11003 }, 400))
    .mockResolvedValueOnce(json({ status: 200, code: 'secret-code' }))
    .mockResolvedValueOnce(
      json({
        code: 200,
        data: {
          access_token: 'secret-access',
          refresh_token: 'secret-refresh',
          expires_in: 3600,
        },
      })
    )
  const client = new QuarkTvClient({
    credentials: { deviceId: 'device' },
    saveCredentials,
    fetchImpl,
  })
  expect(await client.startLogin()).toEqual({
    image: 'data:image/png;base64,aW1hZ2U=',
    expiresAt: Date.now() + 300_000,
  })
  expect(await client.pollLogin()).toEqual({ status: 'waiting' })
  expect(await client.pollLogin()).toEqual({ status: 'authorized' })
  expect(client.status()).toEqual({ authorized: true, pending: false })
  expect(saveCredentials).toHaveBeenCalledWith({
    deviceId: 'device',
    accessToken: 'secret-access',
    refreshToken: 'secret-refresh',
    expiresAt: Date.now() + 3600_000,
  })
  const [url, options] = fetchImpl.mock.calls[0]
  expect(url.origin).toBe('https://open-api-drive.quark.cn')
  expect(url.searchParams.get('device_id')).toBe('device')
  expect(options.headers['x-pan-token']).toBe(
    createHash('sha256')
      .update(
        `GET&/oauth/authorize&${Date.now()}&kw2dvtd7p4t3pjl2d9ed9yc8yej8kw2d`
      )
      .digest('hex')
  )
  const [exchangeUrl, exchangeOptions] = fetchImpl.mock.calls[3]
  expect(exchangeUrl).toBe('https://api.extscreen.com/quarkdrive/token')
  expect(JSON.parse(exchangeOptions.body).code).toBe('secret-code')
  expect(JSON.stringify(client.status())).not.toMatch(/secret/)
})

test('expired QR cannot be exchanged and malformed QR data cannot be rendered', async () => {
  vi.useFakeTimers()
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(json({ qr_data: 'aW1hZ2U=', query_token: 'query' }))
    .mockResolvedValueOnce(
      json({ qr_data: '<svg onload=alert(1)>', query_token: 'query' })
    )
  const client = new QuarkTvClient({ fetchImpl })
  await client.startLogin()
  vi.advanceTimersByTime(300_001)
  expect(await client.pollLogin()).toEqual({ status: 'expired' })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  await expect(client.startLogin()).rejects.toThrow('QUARK_TV_INVALID_QR')
})

test('concurrent playback refreshes tokens once and resolves original downloads through the TV endpoint', async () => {
  const saveCredentials = vi.fn()
  const fetchImpl = vi.fn(async url =>
    String(url).includes('/token')
      ? json({
          code: 200,
          data: {
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 3600,
          },
        })
      : json({
          status: 200,
          data: { download_url: 'https://download.pds.quark.cn/movie' },
        })
  )
  const client = new QuarkTvClient({
    credentials: { deviceId: 'device', refreshToken: 'old', expiresAt: 0 },
    saveCredentials,
    fetchImpl,
  })
  expect(
    await Promise.all([
      client.downloadUrl('file1'),
      client.downloadUrl('file2'),
    ])
  ).toEqual([
    'https://download.pds.quark.cn/movie',
    'https://download.pds.quark.cn/movie',
  ])
  expect(saveCredentials).toHaveBeenCalledTimes(1)
  const fileUrl = fetchImpl.mock.calls[1][0]
  expect(fileUrl.searchParams.get('method')).toBe('download')
  expect(fileUrl.searchParams.get('access_token')).toBe('new-access')
  expect(fileUrl.pathname).toBe('/file')
  await client.logout()
  await expect(client.downloadUrl('file1')).rejects.toThrow(
    'QUARK_TV_AUTH_REQUIRED'
  )
})

test('invalid access token refreshes and retries once, upstream errors never reveal credentials', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      json({ status: -1, errno: 10001, error_info: 'secret-access' }, 401)
    )
    .mockResolvedValueOnce(
      json({
        code: 200,
        data: {
          access_token: 'new',
          refresh_token: 'refresh',
          expires_in: 3600,
        },
      })
    )
    .mockResolvedValueOnce(
      json({ status: -1, errno: 10001, error_info: 'new' }, 401)
    )
  const client = new QuarkTvClient({
    credentials: {
      refreshToken: 'secret-refresh',
      accessToken: 'secret-access',
      expiresAt: Date.now() + 3600_000,
    },
    fetchImpl,
  })
  await expect(client.downloadUrl('file1')).rejects.toThrow(
    'QUARK_TV_API_10001'
  )
  expect(fetchImpl).toHaveBeenCalledTimes(3)
})
