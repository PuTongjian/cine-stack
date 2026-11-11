import assert from 'node:assert/strict'
import { createDecipheriv, createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import { test, vi } from 'vitest'
import {
  encryptW,
  nodeCaptcha,
  parseJsonp,
  proofOfWork,
} from '../../../packages/crawler-engine/src/geetest/geetest-node.mjs'

test('w contains decryptable AES-CBC JSON followed by a 1024-bit RSA block', () => {
  const payload = { setLeft: 167, passtime: 1200, userresponse: 169 }
  const secret = '0123456789abcdef'
  const w = encryptW(payload, secret)
  assert.match(w, /^[0-9a-f]+$/)
  const encrypted = Buffer.from(w.slice(0, -256), 'hex')
  assert.equal(encrypted.length % 16, 0)
  assert.equal(Buffer.from(w.slice(-256), 'hex').length, 128)
  const decipher = createDecipheriv(
    'aes-128-cbc',
    Buffer.from(secret),
    Buffer.from('0000000000000000')
  )
  const decoded = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString()
  assert.deepEqual(JSON.parse(decoded), payload)
})

test('PoW binds the challenge and satisfies a nonzero leading-bit requirement', () => {
  const detail = {
    version: '1',
    bits: 5,
    hashfunc: 'md5',
    datetime: '2026-10-20 16:00:00',
  }
  let counter = 0
  const result = proofOfWork('fixture-lot', detail, () => String(counter++))
  assert.ok(result.pow_msg.includes('|fixture-lot||'))
  assert.equal(
    createHash('md5').update(result.pow_msg).digest('hex'),
    result.pow_sign
  )
  assert.equal(result.pow_sign[0], '0')
  assert.ok(parseInt(result.pow_sign[1], 16) < 8)
})

test('parses JSON and JSONP without evaluating response code', () => {
  assert.deepEqual(parseJsonp('geetest_123({"status":"success"});'), {
    status: 'success',
  })
  assert.deepEqual(parseJsonp('({"status":"success"})'), { status: 'success' })
  assert.deepEqual(parseJsonp('{"status":"error"}'), { status: 'error' })
  assert.throws(() => parseJsonp('alert(1)'), /Unexpected/)
  assert.throws(
    () => parseJsonp('geetest_123({}); process.exit()'),
    /Unexpected/
  )
})

test.each([
  ['/v4/static/v1.9.9-53b07e', 'success'],
  ['/v4/static/v1.9.9-11a9a5', 'success'],
  ['/v4/static/future', 'success'],
  ['/v4/static/future', 'fail'],
])(
  'SDK %s with verification result %s uses the actual server verdict',
  async (sdk, verdict) => {
    const bg = new PNG({ width: 180, height: 60 })
    bg.data.fill(240)
    const piece = new PNG({ width: 20, height: 20 })
    piece.data.fill(0)
    for (let y = 4; y <= 15; y++)
      for (let x = 4; x <= 15; x++) {
        piece.data[(y * 20 + x) * 4 + 3] = 255
        const index = ((5 + y) * 180 + 100 + x) * 4
        bg.data[index] = bg.data[index + 1] = bg.data[index + 2] = 20
      }
    const lot = '0123456789abcdef0123456789abcdef'
    let verification
    const originalStringify = JSON.stringify
    vi.spyOn(JSON, 'stringify').mockImplementation((...args) => {
      // Capture the plaintext at the encryption boundary, before it becomes w.
      if (args[0]?.pow_msg) verification = args[0]
      return originalStringify(...args)
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async url => {
        if (url.pathname === '/load')
          return new Response(
            originalStringify({
              status: 'success',
              data: {
                captcha_type: 'slide',
                pt: '1',
                static_path: sdk,
                guard: false,
                lang_reverse: false,
                gct_path: '/v4/gct/gct4.5a2e755576738ba0499d714db4f1c9e0.js',
                bg: '/fixture-bg.png',
                slice: '/fixture-piece.png',
                ypos: 5,
                lot_number: lot,
                pow_detail: {
                  version: '1',
                  bits: 0,
                  hashfunc: 'md5',
                  datetime: 'fixture',
                },
                payload: 'fixture',
                process_token: 'fixture',
                payload_protocol: 1,
              },
            })
          )
        if (url.pathname === '/verify')
          return new Response(
            originalStringify({
              status: 'success',
              data: {
                result: verdict,
                seccode: {
                  lot_number: lot,
                  captcha_output: 'fixture',
                  pass_token: 'fixture',
                  gen_time: 'fixture',
                },
              },
            })
          )
        return new Response(
          PNG.sync.write(url.pathname === '/fixture-bg.png' ? bg : piece)
        )
      })
    )
    try {
      if (verdict === 'success') await nodeCaptcha()
      else await assert.rejects(nodeCaptcha(), /SUENEN_.*校验未通过.*future/)
      assert.equal(verification.bzj5, 'MoPY')
      assert.equal(
        verification[lot.slice(28, 29) + lot.slice(17, 18)][lot.slice(5, 10)][
          ''
        ],
        lot.slice(22, 27)
      )
      assert.deepEqual(verification.tz, {
        name: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: -new Date().getTimezoneOffset(),
      })
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  }
)

test('unsupported challenge modes stop before image download or verification', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          data: {
            captcha_type: 'slide',
            pt: '1',
            static_path: '/v4/static/future',
            guard: true,
            lang_reverse: false,
          },
        })
      )
  )
  vi.stubGlobal('fetch', fetchImpl)
  try {
    await assert.rejects(nodeCaptcha(), /SUENEN_.*挑战模式/)
    assert.equal(fetchImpl.mock.calls.length, 1)
  } finally {
    vi.unstubAllGlobals()
  }
})
