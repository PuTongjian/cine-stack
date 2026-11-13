import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import {
  parseQuarkLinks,
  parseSearchResults,
  SuenenClient,
} from '../../../packages/crawler-engine/src/suenen/client.mjs'

test('search results preserve thread identity and remove duplicate links', () => {
  const html =
    '<div class="style3_subject"><a href="thread-12.htm">Movie</a><a href="thread-12.htm#comments">Comments</a></div>'
  expect(parseSearchResults(html)).toEqual([
    { id: '12', title: 'Movie', url: 'https://www.suenen.com/thread-12.htm' },
  ])
})
test('search returns all titles in site order without fetching posts', async () => {
  const client = new SuenenClient({})
  const getHtml = vi
    .spyOn(client, 'getHtml')
    .mockResolvedValue(
      Array.from(
        { length: 12 },
        (_, index) =>
          `<div class="style3_subject"><a href="thread-${index + 1}.htm">标题 ${index + 1}</a></div>`
      ).join('')
    )
  const posts = await client.search('电影')
  expect(posts.map(post => post.title)).toEqual(
    Array.from({ length: 12 }, (_, index) => `标题 ${index + 1}`)
  )
  expect(getHtml).toHaveBeenCalledExactlyOnceWith(
    '/search-%E7%94%B5%E5%BD%B1-1.htm'
  )
})

test('search follows same-query pagination and deduplicates threads across pages', async () => {
  const client = new SuenenClient({})
  const getHtml = vi
    .spyOn(client, 'getHtml')
    .mockResolvedValueOnce(
      '<div class="style3_subject"><a href="thread-1.htm">一</a></div><ul class="pagination"><a href="search-Movie-1.htm">1</a><a href="search-Movie-2.htm">2</a><a href="https://evil.test/search-Movie-3.htm">3</a></ul>'
    )
    .mockResolvedValueOnce(
      '<div class="style3_subject"><a href="thread-1.htm">一</a><a href="thread-2.htm">二</a></div><ul class="pagination"><a href="search-Movie-1.htm">1</a></ul>'
    )
  expect((await client.search('Movie')).map(post => post.id)).toEqual([
    '1',
    '2',
  ])
  expect(getHtml.mock.calls.map(([path]) => path)).toEqual([
    '/search-Movie-1.htm',
    '/search-Movie-2.htm',
  ])
})

const gated =
  '<form id="quick_reply_form" action="post-create-12-1.htm"><input type="hidden" name="doctype" value="1"><textarea name="message"></textarea></form><div class="message">本帖含有隐藏内容，请回复后再查看</div>'

test('a rejected JSON reply reports the rejection and remains retryable', async () => {
  const client = new SuenenClient({})
  vi.spyOn(client, 'getHtml').mockResolvedValue(gated)
  const request = vi
    .spyOn(client, 'request')
    .mockImplementation(async () =>
      Response.json({ code: 'message', message: '两次发帖间隔不能少于 30 秒' })
    )
  await expect(
    client.postSharesWithOptions('12', { autoReply: true })
  ).rejects.toThrow('SUENEN_REPLY_RATE_LIMITED')
  await expect(
    client.postSharesWithOptions('12', { autoReply: true })
  ).rejects.toThrow('SUENEN_REPLY_RATE_LIMITED')
  expect(request).toHaveBeenCalledTimes(2)
})

test('a successful reply that leaves the post gated is not reported as missing Quark links', async () => {
  const client = new SuenenClient({})
  vi.spyOn(client, 'getHtml').mockResolvedValue(gated)
  const request = vi
    .spyOn(client, 'request')
    .mockImplementation(async () =>
      Response.json({ code: 0, message: '<li>回复</li>' })
    )
  await expect(
    client.postSharesWithOptions('12', { autoReply: true })
  ).rejects.toThrow('SUENEN_REPLY_NOT_UNLOCKED')
  await expect(
    client.postSharesWithOptions('12', { autoReply: true })
  ).rejects.toThrow('SUENEN_REPLY_NOT_UNLOCKED')
  expect(request).toHaveBeenCalledOnce()
})

test('concurrent reads of one gated post submit only one reply', async () => {
  const client = new SuenenClient({})
  let unlocked = false
  vi.spyOn(client, 'getHtml').mockImplementation(async () =>
    unlocked
      ? '<div class="message"><a href="https://pan.quark.cn/s/visible">资源</a></div>'
      : gated
  )
  const request = vi.spyOn(client, 'request').mockImplementation(async () => {
    unlocked = true
    return Response.json({ code: 0, message: '<li>回复</li>' })
  })
  const results = await Promise.all([
    client.postSharesWithOptions('12', { autoReply: true }),
    client.postSharesWithOptions('12', { autoReply: true }),
  ])
  expect(results.every(shares => shares[0]?.shareId === 'visible')).toBe(true)
  expect(request).toHaveBeenCalledOnce()
})

test.each([
  [
    { code: 'message', message: '回复内容太短' },
    'SUENEN_REPLY_CONTENT_REJECTED',
  ],
  [{ code: -1, message: '请先登录' }, 'SUENEN_REPLY_LOGIN_REQUIRED'],
  [{ code: -1, message: '本主题禁止回复' }, 'SUENEN_REPLY_REJECTED'],
])(
  'reply business errors are checked even with HTTP 200: %j',
  async (result, code) => {
    const client = new SuenenClient({})
    client.ready = true
    vi.spyOn(client, 'getHtml').mockResolvedValue(gated)
    vi.spyOn(client, 'request').mockResolvedValue(Response.json(result))
    await expect(
      client.postSharesWithOptions('12', { autoReply: true })
    ).rejects.toThrow(code)
    expect(client.repliedPosts.has('12')).toBe(false)
    if (code === 'SUENEN_REPLY_LOGIN_REQUIRED') expect(client.ready).toBe(false)
  }
)

test('reply forms must belong to the selected thread', async () => {
  const client = new SuenenClient({})
  vi.spyOn(client, 'getHtml').mockResolvedValue(
    gated.replace('post-create-12-1.htm', 'post-create-99-1.htm')
  )
  const request = vi.spyOn(client, 'request')
  await expect(
    client.postSharesWithOptions('12', { autoReply: true })
  ).rejects.toThrow('SUENEN_INVALID_REPLY_FORM')
  expect(request).not.toHaveBeenCalled()
})

test('empty native hidden values receive the same reply defaults', async () => {
  const client = new SuenenClient({})
  const request = vi
    .spyOn(client, 'request')
    .mockResolvedValue(Response.json({ code: 0, message: '<li>回复</li>' }))
  await client.replyToPost(
    '12',
    '<form id="quick_reply_form" action="post-create-12.htm"><input type="hidden" name="doctype"><input type="hidden" name="quotepid"><input type="hidden" name="csrf" value="fixture"></form>'
  )
  const body = request.mock.calls[0][1].body
  expect(Object.fromEntries(body)).toEqual({
    doctype: '1',
    quotepid: '0',
    csrf: 'fixture',
    return_html: '1',
    message: '感谢分享！',
  })
})
test('post shares are parsed only for the selected thread and reject invalid IDs', async () => {
  const client = new SuenenClient({})
  const getHtml = vi
    .spyOn(client, 'getHtml')
    .mockResolvedValue(
      '<div class="message"><a href="https://pan.quark.cn/s/abc123?pwd=a123">资源</a></div>'
    )
  await expect(client.postShares('12')).resolves.toEqual([
    {
      shareId: 'abc123',
      passcode: 'a123',
      url: 'https://pan.quark.cn/s/abc123',
      postUrl: 'https://www.suenen.com/thread-12.htm',
    },
  ])
  expect(getHtml).toHaveBeenCalledExactlyOnceWith('/thread-12.htm')
  await expect(
    client.postShares('../../../packages/crawler-engine/src/my')
  ).rejects.toThrow('SUENEN_INVALID_POST')
  expect(getHtml).toHaveBeenCalledTimes(1)
})
test('restored www sessions are reused by the actual session-check path', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'suenen-client-'))
  await mkdir(join(folder, 'sessions'))
  await writeFile(
    join(folder, 'sessions/suenen.json'),
    JSON.stringify({
      cookies: [
        {
          name: 'bbs_token',
          value: 'fixture',
          domain: 'www.suenen.com',
          path: '/',
          expires: -1,
          secure: true,
          httpOnly: true,
        },
        {
          name: 'other_token',
          value: 'private',
          domain: 'other.test',
          path: '/',
          expires: -1,
        },
      ],
    })
  )
  const fetchImpl = vi.fn(async (url, options) => {
    expect(url.href).toBe('https://www.suenen.com/my.htm')
    expect(options.headers.Cookie).toBe('bbs_token=fixture')
    return new Response('<script>var uid = 19209;</script>')
  })
  vi.stubGlobal('fetch', fetchImpl)
  try {
    const client = new SuenenClient({ dataDir: folder })
    await client.ensureSession()
    await client.ensureSession()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await expect(client.request('https://other.test/')).rejects.toThrow(
      'SUENEN_INVALID_URL'
    )
  } finally {
    vi.unstubAllGlobals()
    await rm(folder, { recursive: true, force: true })
  }
})
test('resource parsing only accepts direct Quark HTTPS shares and extracts passcodes', () => {
  const html =
    '<div class="message"><p><a href="https://pan.quark.cn/s/abc123">资源</a> 提取码: a123</p><a href="https://evil.test/s/ab">bad</a><a href="http://pan.quark.cn/s/ab">bad</a></div>'
  expect(parseQuarkLinks(html, 'https://suenen.com/thread-12.htm')).toEqual([
    {
      shareId: 'abc123',
      passcode: 'a123',
      url: 'https://pan.quark.cn/s/abc123',
      postUrl: 'https://suenen.com/thread-12.htm',
    },
  ])
})

test('a reply-gated post reports its actual access requirement without posting a reply', async () => {
  const client = new SuenenClient({})
  const getHtml = vi
    .spyOn(client, 'getHtml')
    .mockResolvedValue(
      '<div class="message"><p>下载地址</p><div class="alert alert-warning" role="alert">您好，本帖含有隐藏内容，请<a href="#quick_reply_form"> 回复 </a>后再查看。</div></div>'
    )
  const request = vi.spyOn(client, 'request')
  await expect(client.postShares('100011512')).rejects.toThrow(
    'SUENEN_REPLY_REQUIRED'
  )
  expect(getHtml).toHaveBeenCalledExactlyOnceWith('/thread-100011512.htm')
  expect(request).not.toHaveBeenCalled()
})
test('visible shares still work when a later comment contains a reply-gated notice', async () => {
  const client = new SuenenClient({})
  vi.spyOn(client, 'getHtml').mockResolvedValue(
    '<div class="message"><a href="https://pan.quark.cn/s/visible">资源</a></div><div class="message">本帖含有隐藏内容，请回复后再查看</div>'
  )
  await expect(client.postShares('12')).resolves.toMatchObject([
    { shareId: 'visible' },
  ])
})

test('auto reply submits the native hidden fields once, then rereads shares', async () => {
  const client = new SuenenClient({})
  const first =
    '<form id="quick_reply_form" action="post-create-12-1.htm" method="post"><input type="hidden" name="doctype" value="1"><input type="hidden" name="return_html" value="thread-12.htm"><textarea name="message"></textarea></form><div class="message">本帖含有隐藏内容，请回复后再查看</div>'
  const second =
    '<div class="message"><a href="https://pan.quark.cn/s/visible">资源</a></div>'
  vi.spyOn(client, 'getHtml')
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  const request = vi
    .spyOn(client, 'request')
    .mockResolvedValue(new Response(null, { status: 302 }))
  await expect(
    client.postSharesWithOptions('12', { autoReply: true })
  ).resolves.toMatchObject([{ shareId: 'visible' }])
  expect(request).toHaveBeenCalledExactlyOnceWith(
    '/post-create-12-1.htm',
    expect.objectContaining({
      method: 'POST',
      body: expect.any(URLSearchParams),
    })
  )
  const body = request.mock.calls[0][1].body
  expect(body.get('doctype')).toBe('1')
  expect(body.get('return_html')).toBe('1')
  expect(body.get('quotepid')).toBe('0')
  expect(body.get('message')).toBe('感谢分享！')
  expect(request.mock.calls[0][1].headers['X-Requested-With']).toBe(
    'XMLHttpRequest'
  )
})

test('auto reply rejects external form actions before sending anything', async () => {
  const client = new SuenenClient({})
  vi.spyOn(client, 'getHtml').mockResolvedValue(
    '<form id="quick_reply_form" action="https://evil.test/post-create-12-1.htm"><textarea name="message"></textarea></form><div class="message">本帖含有隐藏内容，请回复后再查看</div>'
  )
  const request = vi.spyOn(client, 'request')
  await expect(
    client.postSharesWithOptions('12', { autoReply: true })
  ).rejects.toThrow('SUENEN_INVALID_REPLY_FORM')
  expect(request).not.toHaveBeenCalled()
})

test('auto reply distinguishes a revealed post without a Quark share', async () => {
  const client = new SuenenClient({})
  const first =
    '<form id="quick_reply_form" action="post-create-12-1.htm"><input type="hidden" name="doctype" value="1"><textarea name="message"></textarea></form><div class="message">本帖含有隐藏内容，请回复后再查看</div>'
  const second =
    '<div class="message"><a href="https://pan.baidu.com/s/abc?pwd=9527">百度网盘</a></div>'
  vi.spyOn(client, 'getHtml')
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  vi.spyOn(client, 'request').mockResolvedValue(
    new Response(null, { status: 302 })
  )
  await expect(
    client.postSharesWithOptions('12', { autoReply: true })
  ).rejects.toThrow('SUENEN_NO_QUARK_SHARE')
})
