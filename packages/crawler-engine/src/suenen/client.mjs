import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { load } from 'cheerio'
import { CookieJar } from 'tough-cookie'
import { loginSuenen } from './login.mjs'
import { SUENEN_ORIGIN } from './origin.mjs'

export function parseQuarkLinks(html, postUrl) {
  const $ = load(html)
  const body = $('.message').first()
  const content = body.length ? body : $('body')
  const links = []
  content.find('a[href]').each((_, element) => {
    let url
    try {
      url = new URL($(element).attr('href'), postUrl)
    } catch {
      return
    }
    if (url.protocol !== 'https:' || url.hostname !== 'pan.quark.cn') return
    const shareId = url.pathname.match(/^\/s\/([a-zA-Z0-9]+)\/?$/)?.[1]
    if (!shareId) return
    const context = $(element).parent().text()
    const passcode =
      url.searchParams.get('pwd') ||
      context.match(/(?:提取码|密码)\s*[：:]?\s*([A-Za-z0-9]{4})/)?.[1] ||
      ''
    if (!links.some(link => link.shareId === shareId))
      links.push({
        shareId,
        passcode,
        url: `https://pan.quark.cn/s/${shareId}`,
        postUrl,
      })
  })
  return links
}

export function parseSearchResults(html) {
  const $ = load(html)
  const posts = []
  $('.thread .subject a[href], .style3_subject a[href]').each((_, element) => {
    const href = $(element).attr('href')
    const id = href?.match(/thread-(\d+)\.htm/)?.[1]
    if (id && !posts.some(post => post.id === id))
      posts.push({
        id,
        title: $(element).text().trim(),
        url: `${SUENEN_ORIGIN}/thread-${id}.htm`,
      })
  })
  return posts
}

function replyRequired(html) {
  const $ = load(html)
  const content = $('.message').first().clone()
  content.find('script, style').remove()
  return /(?:隐藏内容|隐藏链接|下载地址).*回复.*(?:查看|可见)|回复.*(?:可见|查看隐藏)/.test(
    content.text().replace(/\s+/g, '')
  )
}

function replyError(message) {
  if (/登录|登陆/.test(message)) return 'SUENEN_REPLY_LOGIN_REQUIRED'
  if (/间隔|频繁|灌水|稍后|等待|太快|冷却/.test(message))
    return 'SUENEN_REPLY_RATE_LIMITED'
  if (/内容|字数|字符|重复|敏感/.test(message))
    return 'SUENEN_REPLY_CONTENT_REJECTED'
  return 'SUENEN_REPLY_REJECTED'
}

export class SuenenClient {
  constructor({ username, password, dataDir = resolve('data') }) {
    this.username = username
    this.password = password
    this.output = resolve(dataDir, 'sessions/suenen.json')
    this.jar = new CookieJar()
    this.ready = false
    this.pendingLogin = null
    this.repliedPosts = new Set()
    this.pendingPosts = new Map()
  }
  async restore() {
    try {
      const state = JSON.parse(await readFile(this.output, 'utf8'))
      for (const cookie of state.cookies) {
        const host = cookie.domain.replace(/^\./, '')
        if (!['suenen.com', 'www.suenen.com'].includes(host)) continue
        if (cookie.expires !== -1 && cookie.expires <= Date.now() / 1000)
          continue
        const attributes = [
          `${cookie.name}=${cookie.value}`,
          `Path=${cookie.path}`,
          ...(cookie.domain.startsWith('.') ? [`Domain=${host}`] : []),
          ...(cookie.secure ? ['Secure'] : []),
          ...(cookie.httpOnly ? ['HttpOnly'] : []),
          ...(cookie.expires !== -1
            ? [`Expires=${new Date(cookie.expires * 1000).toUTCString()}`]
            : []),
        ]
        await this.jar.setCookie(attributes.join('; '), `https://${host}`)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('SUENEN_SESSION_INVALID')
    }
  }
  async request(path, options = {}) {
    const url = new URL(path, SUENEN_ORIGIN)
    if (url.origin !== SUENEN_ORIGIN) throw new Error('SUENEN_INVALID_URL')
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Cookie: await this.jar.getCookieString(url.href),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
    for (const cookie of response.headers.getSetCookie?.() || [])
      await this.jar.setCookie(cookie, url.href)
    return response
  }
  async ensureSession() {
    if (this.ready) return
    if (this.pendingLogin) return this.pendingLogin
    this.pendingLogin = (async () => {
      await this.restore()
      const response = await this.request('/my.htm')
      const html = await response.text()
      if (!response.ok || !/\bvar\s+uid\s*=\s*[1-9]\d*\s*;/.test(html)) {
        await loginSuenen({
          username: this.username,
          password: this.password,
          output: this.output,
        })
        await this.restore()
      }
      this.ready = true
    })().finally(() => {
      this.pendingLogin = null
    })
    return this.pendingLogin
  }
  async getHtml(path) {
    await this.ensureSession()
    let response = await this.request(path)
    if (
      response.status === 302 &&
      response.headers.get('location')?.includes('user-login')
    ) {
      this.ready = false
      this.jar = new CookieJar()
      await this.ensureSession()
      response = await this.request(path)
    }
    if (!response.ok) throw new Error(`SUENEN_HTTP_${response.status}`)
    return response.text()
  }
  async search(title) {
    const pages = new Set([`/search-${encodeURIComponent(title)}-1.htm`])
    const posts = new Map()
    for (const path of pages) {
      const html = await this.getHtml(path)
      for (const post of parseSearchResults(html))
        if (!posts.has(post.id)) posts.set(post.id, post)
      const $ = load(html)
      $('.pagination a[href], a[rel="next"]').each((_, element) => {
        try {
          const url = new URL($(element).attr('href'), SUENEN_ORIGIN)
          const match = url.pathname.match(/^\/search-(.+?)(?:-(\d+))?\.htm$/)
          if (
            url.origin === SUENEN_ORIGIN &&
            match &&
            decodeURIComponent(match[1].replace(/_([a-f\d]{2})/gi, '%$1')) ===
              title
          )
            pages.add(`${url.pathname}${url.search}`)
        } catch {
          // Ignore malformed pagination links.
        }
      })
    }
    return [...posts.values()]
  }
  async postShares(id) {
    return this.postSharesWithOptions(id)
  }
  postSharesWithOptions(id, options = {}) {
    const key = `${id}:${!!options.autoReply}`
    if (this.pendingPosts.has(key)) return this.pendingPosts.get(key)
    const pending = this.readPostShares(id, options).finally(() => {
      this.pendingPosts.delete(key)
    })
    this.pendingPosts.set(key, pending)
    return pending
  }
  async readPostShares(id, { autoReply = false, reply = '感谢分享！' } = {}) {
    if (!/^\d+$/.test(id)) throw new Error('SUENEN_INVALID_POST')
    const path = `/thread-${id}.htm`
    let html = await this.getHtml(path)
    let shares = parseQuarkLinks(html, `${SUENEN_ORIGIN}${path}`)
    if (!shares.length) {
      if (replyRequired(html)) {
        if (!autoReply) throw new Error('SUENEN_REPLY_REQUIRED')
        if (!this.repliedPosts.has(id)) {
          await this.replyToPost(id, html, reply)
          this.repliedPosts.add(id)
        }
        html = await this.getHtml(path)
        shares = parseQuarkLinks(html, `${SUENEN_ORIGIN}${path}`)
        if (!shares.length && replyRequired(html))
          throw new Error('SUENEN_REPLY_NOT_UNLOCKED')
        if (!shares.length) throw new Error('SUENEN_NO_QUARK_SHARE')
      }
    }
    return shares
  }
  async replyToPost(id, html, reply = '感谢分享！') {
    if (!/^\d+$/.test(id) || typeof reply !== 'string' || !reply.trim())
      throw new Error('SUENEN_INVALID_REPLY')
    const $ = load(html)
    const form = $('#quick_reply_form').first()
    const action = form.attr('action')
    if (!form.length || !action) throw new Error('SUENEN_REPLY_FORM_MISSING')
    const target = new URL(action, `${SUENEN_ORIGIN}/thread-${id}.htm`)
    if (
      target.origin !== SUENEN_ORIGIN ||
      !new RegExp(`^/post-create-${id}(?:-1)?\\.htm$`).test(target.pathname) ||
      target.search ||
      target.hash
    )
      throw new Error('SUENEN_INVALID_REPLY_FORM')
    const body = new URLSearchParams()
    form.find('input[type="hidden"]').each((_, element) => {
      const name = $(element).attr('name')
      if (name) body.set(name, $(element).attr('value') || '')
    })
    body.set('return_html', '1')
    if (!body.get('doctype')) body.set('doctype', '1')
    if (!body.get('quotepid')) body.set('quotepid', '0')
    body.set('message', reply.trim())
    const response = await this.request(target.pathname, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: SUENEN_ORIGIN,
        Referer: `${SUENEN_ORIGIN}/thread-${id}.htm`,
      },
      body,
    })
    if (![200, 302, 303].includes(response.status))
      throw new Error(`SUENEN_REPLY_HTTP_${response.status}`)
    if (response.status !== 200) {
      const location = response.headers.get('location')
      if (location) {
        const redirect = new URL(location, target)
        if (/user-login/.test(redirect.pathname)) {
          this.ready = false
          throw new Error('SUENEN_REPLY_LOGIN_REQUIRED')
        }
        if (
          redirect.origin !== SUENEN_ORIGIN ||
          !new RegExp(`^/thread-${id}(?:-\\d+)?\\.htm$`).test(redirect.pathname)
        )
          throw new Error('SUENEN_REPLY_REJECTED')
      }
      return
    }
    const text = await response.text()
    let result
    try {
      result = JSON.parse(text)
    } catch {
      throw new Error(replyError(load(text)('body').text()))
    }
    if (result?.code !== 0 && result?.code !== '0') {
      const error = replyError(String(result?.message || ''))
      if (error === 'SUENEN_REPLY_LOGIN_REQUIRED') this.ready = false
      throw new Error(error)
    }
  }
}
