import { once } from 'node:events'
import { createServer } from 'node:http'
import express from 'express'
import { afterEach, expect, test, vi } from 'vitest'
import {
  playbackRange,
  streamVideo,
} from '../../../apps/api/src/modules/strm/video-stream.js'

afterEach(() => vi.unstubAllGlobals())

async function serve(
  upstream: typeof fetch,
  work: (url: string, client: typeof fetch) => Promise<void>
) {
  const client = fetch
  const app = express()
  app.get('/video', (req, res, next) => {
    streamVideo(new URL('https://download.pds.quark.cn/video'), req, res).catch(
      next
    )
  })
  app.use((_error: unknown, _req: any, res: any, _next: any) => {
    if (res.headersSent) res.destroy()
    else res.sendStatus(502)
  })
  const server = createServer(app).listen(0, '127.0.0.1')
  await once(server, 'listening')
  vi.stubGlobal('fetch', upstream)
  try {
    await work(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/video`,
      client
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>(done => server.close(() => done()))
  }
}

test('range parsing preserves small and suffix redirects and relays open/large ranges', () => {
  for (const range of [undefined, 'bytes=0-', 'bytes=100-', 'bytes=0-8388608'])
    expect(playbackRange(range).relay).toBe(true)
  for (const range of ['bytes=1-2', 'bytes=0-8388607', 'bytes=-65536'])
    expect(playbackRange(range).relay).toBe(false)
  for (const range of [
    'bytes=-',
    'bytes=2-1',
    'bytes=1-2,3-4',
    'bytes=-0',
    'bytes=9007199254740992-',
  ])
    expect(() => playbackRange(range)).toThrow('STRM_INVALID_RANGE')
})

test('large bounded requests stop exactly at the client end, including the final partial chunk', async () => {
  const fetchImpl = vi.fn(async (_url: unknown, options: any) => {
    const [start, end] = options.headers.Range.slice(6).split('-').map(Number)
    return new Response(Buffer.alloc(end - start + 1, 7), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/10000000` },
    })
  })
  await serve(fetchImpl as any, async (url, client) => {
    const response = await client(url, {
      headers: { Range: 'bytes=10-8388630' },
    })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-length')).toBe('8388621')
    expect((await response.arrayBuffer()).byteLength).toBe(8388621)
    expect(
      fetchImpl.mock.calls.map(([, options]) => options.headers.Range)
    ).toEqual(['bytes=10-8388617', 'bytes=8388618-8388630'])
  })
})

test('rejects wrong upstream offsets and servers ignoring Range before sending any video', async () => {
  for (const fixture of [
    { status: 200, range: '' },
    { status: 206, range: 'bytes 1-9/10' },
  ]) {
    const fetchImpl = vi.fn(
      async () =>
        new Response('0123456789', {
          status: fixture.status,
          headers: { 'Content-Range': fixture.range },
        })
    )
    await serve(fetchImpl as any, async (url, client) => {
      expect(
        (await client(url, { headers: { Range: 'bytes=0-' } })).status
      ).toBe(502)
    })
    vi.unstubAllGlobals()
  }
})

test('aborts the active CDN request when the client disconnects and does not start another chunk', async () => {
  let aborted = false
  const fetchImpl = vi.fn(async (_url: unknown, options: any) => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(65536))
        options.signal.addEventListener(
          'abort',
          () => {
            aborted = true
            controller.error(new Error('cancelled'))
          },
          { once: true }
        )
      },
    })
    return new Response(body, {
      status: 206,
      headers: { 'Content-Range': 'bytes 0-8388607/20000000' },
    })
  })
  await serve(fetchImpl as any, async (url, client) => {
    const response = await client(url, { headers: { Range: 'bytes=0-' } })
    await response.body!.cancel()
    await vi.waitFor(() => expect(aborted).toBe(true))
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

test('validates redirected hosts before making a second request', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/admin' },
      })
  )
  await serve(fetchImpl as any, async (url, client) => {
    expect((await client(url)).status).toBe(502)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

test('a truncated CDN chunk cannot silently finish as a complete video response', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response('short', {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-9/10' },
      })
  )
  await serve(fetchImpl as any, async (url, client) => {
    await expect(
      client(url).then(response => response.arrayBuffer())
    ).rejects.toThrow()
  })
})
