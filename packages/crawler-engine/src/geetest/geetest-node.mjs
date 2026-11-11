import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { findSlideOffset } from './geetest-slide.mjs'

const CAPTCHA_ID = 'ff86008696141c19d59d31d4241c7031'
const modulus =
  'C1E3934D1614465B33053E7F48EE4EC87B14B95EF88947713D25EECBFF7E74C7977D02DC1D9451F79DD5D1C10C29ACB6A9B4D6FB7D0A0279B6719E1772565F09AF627715919221AEF91899CAE08C0D686D748B20A3603BE2318CA6BC2B59706592A9219D0BF05C9F65023A21D2330807252AE0066D59CEEFA5F2748EA80BAB81'
const key = createPublicKey({
  key: {
    kty: 'RSA',
    n: Buffer.from(modulus, 'hex').toString('base64url'),
    e: 'AQAB',
  },
  format: 'jwk',
})

export function encryptW(payload, secret = randomBytes(8).toString('hex')) {
  const cipher = createCipheriv(
    'aes-128-cbc',
    Buffer.from(secret),
    Buffer.from('0000000000000000')
  )
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ])
  const encryptedKey = publicEncrypt(
    { key, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(secret)
  )
  return encrypted.toString('hex') + encryptedKey.toString('hex')
}

export function proofOfWork(
  lot,
  detail,
  nonce = () => randomBytes(8).toString('hex')
) {
  const prefix = `${detail.version}|${detail.bits}|${detail.hashfunc}|${detail.datetime}|${CAPTCHA_ID}|${lot}||`
  for (let attempt = 0; attempt < 1_000_000; attempt++) {
    const pow_msg = prefix + nonce()
    const pow_sign = createHash(detail.hashfunc).update(pow_msg).digest('hex')
    const full = Math.floor(detail.bits / 4)
    const remainder = detail.bits % 4
    if (
      pow_sign.startsWith('0'.repeat(full)) &&
      (!remainder || parseInt(pow_sign[full], 16) < 2 ** (4 - remainder))
    ) {
      return { pow_msg, pow_sign }
    }
  }
  throw new Error('PoW work limit exceeded.')
}

export function parseJsonp(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  const match = trimmed.match(/^(?:geetest_\d+)?\((.*)\);?$/s)
  if (!match) throw new Error('Unexpected Geetest JSONP response.')
  return JSON.parse(match[1])
}

async function jsonp(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Geetest HTTP ${response.status}`)
  const text = await response.text()
  return parseJsonp(text)
}

export async function nodeCaptcha() {
  const challenge = randomUUID()
  const load = new URL('https://gcaptcha4.geetest.com/load')
  load.search = new URLSearchParams({
    captcha_id: CAPTCHA_ID,
    challenge,
    client_type: 'web',
    lang: 'zh-cn',
    callback: `geetest_${Date.now()}`,
  })
  const result = await jsonp(load)
  const data = result.data
  if (
    result.status !== 'success' ||
    data?.captcha_type !== 'slide' ||
    data.pt !== '1'
  ) {
    throw new Error('SUENEN_极验返回了当前登录逻辑不支持的挑战类型或协议。')
  }
  const legacySdk = data.static_path === '/v4/static/v1.9.8-0d53fd'
  if (data.guard || data.lang_reverse) {
    throw new Error('SUENEN_极验返回了当前登录逻辑不支持的挑战模式。')
  }
  const images = await Promise.all(
    ['bg', 'slice'].map(async name => {
      const url = new URL(data[name], 'https://static.geetest.com')
      if (url.origin !== 'https://static.geetest.com')
        throw new Error('Unexpected image origin.')
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error('Image download failed.')
      return Buffer.from(await response.arrayBuffer())
    })
  )
  const match = findSlideOffset(images[0], images[1], data.ypos)
  const lot = data.lot_number
  const payload = {
    setLeft: match.offset,
    passtime: 1200,
    userresponse: match.offset + 2,
    device_id: '',
    lot_number: lot,
    ...proofOfWork(lot, data.pow_detail),
  }
  const gctContext = vm.createContext({})
  // Reuse the existing GCT and payload logic; the live verification result decides compatibility.
  const gctSource = await readFile(
    new URL('./vendor/gct.js', import.meta.url),
    'utf8'
  )
  if (
    createHash('sha256').update(gctSource).digest('hex') !==
    '7e72ac688b03131ba0cd4494a2311a9f425fb0bf97ced5ad86053b65f33a31d8'
  ) {
    throw new Error(
      'The retained GCT source digest does not match the reviewed version.'
    )
  }
  vm.runInContext(gctSource, gctContext, { timeout: 1000 })
  const gctData = { geetest: 'captcha', lang: 'zh', ep: '123' }
  gctContext.input = gctData
  vm.runInContext('_gct(input)', gctContext, { timeout: 1000 })
  // Keep the legacy payload for its known version; newer SDKs try the current payload.
  Object.assign(payload, gctData)
  if (legacySdk) {
    payload.oQ9h = 'VQzx'
    payload[lot.slice(16, 19) + lot.slice(13, 16)] = {
      [lot.slice(12, 19)]: lot.slice(22, 27),
    }
  } else {
    payload.bzj5 = 'MoPY'
    payload[lot.slice(28, 29) + lot.slice(17, 18)] = {
      [lot.slice(5, 10)]: { '': lot.slice(22, 27) },
    }
    payload.tc = { mtp: null, te: false, ts: false }
    payload.tz = {
      name: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offset: -new Date().getTimezoneOffset(),
    }
    payload.nd = [0, 0, 1, 1, 0, 0, 0]
  }
  payload.em = { ph: 0, cp: 0, ek: '11', wd: 1, nt: 0, si: 0, sc: 0 }
  const verify = new URL('https://gcaptcha4.geetest.com/verify')
  verify.search = new URLSearchParams({
    callback: `geetest_${Date.now()}`,
    captcha_id: CAPTCHA_ID,
    challenge,
    client_type: 'web',
    lot_number: lot,
    risk_type: 'slide',
    payload: data.payload,
    process_token: data.process_token,
    payload_protocol: String(data.payload_protocol),
    pt: data.pt,
    w: encryptW(payload),
  })
  const verified = await jsonp(verify)
  const sdk = /^\/v4\/static\/[\w.-]+$/.test(data.static_path)
    ? data.static_path
    : 'unknown'
  console.log(
    JSON.stringify({
      transport: 'Node.js fetch',
      sdk,
      offset: match.offset,
      status: verified.status,
      result: verified.data?.result,
    })
  )
  if (verified.status !== 'success' || verified.data?.result !== 'success')
    throw new Error(
      `SUENEN_验证码校验未通过（SDK ${sdk}），当前登录参数可能不兼容，也可能触发了风控，请重试。`
    )
  const seccode = verified.data.seccode
  for (const name of [
    'lot_number',
    'captcha_output',
    'pass_token',
    'gen_time',
  ]) {
    if (typeof seccode?.[name] !== 'string' || !seccode[name])
      throw new Error('SUENEN_极验校验结果缺少登录所需字段，请检查登录适配。')
  }
  return seccode
}

if (
  process.argv[1]?.endsWith('/geetest-node.mjs') ||
  process.argv[1] === 'geetest-node.mjs'
) {
  nodeCaptcha()
    .then(result =>
      console.log(JSON.stringify({ issuedFields: Object.keys(result || {}) }))
    )
    .catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
}
