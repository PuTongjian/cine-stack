import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { load } from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { loginSuenen } from './login.mjs';
import { SUENEN_ORIGIN } from './origin.mjs';

export function parseQuarkLinks(html, postUrl) {
  const $ = load(html);
  const body = $('.message').first();
  const content = body.length ? body : $('body');
  const links = [];
  content.find('a[href]').each((_, element) => {
    let url;
    try { url = new URL($(element).attr('href'), postUrl); } catch { return; }
    if (url.protocol !== 'https:' || url.hostname !== 'pan.quark.cn') return;
    const shareId = url.pathname.match(/^\/s\/([a-zA-Z0-9]+)\/?$/)?.[1];
    if (!shareId) return;
    const context = $(element).parent().text();
    const passcode = url.searchParams.get('pwd') || context.match(/(?:提取码|密码)\s*[：:]?\s*([A-Za-z0-9]{4})/)?.[1] || '';
    if (!links.some((link) => link.shareId === shareId)) links.push({ shareId, passcode, url: `https://pan.quark.cn/s/${shareId}`, postUrl });
  });
  return links;
}

export function parseSearchResults(html) {
  const $ = load(html);
  const posts = [];
  $('.thread .subject a[href], .style3_subject a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const id = href?.match(/thread-(\d+)\.htm/)?.[1];
    if (id && !posts.some((post) => post.id === id)) posts.push({ id, title: $(element).text().trim(), url: `${SUENEN_ORIGIN}/thread-${id}.htm` });
  });
  return posts;
}

export class SuenenClient {
  constructor({ username, password, dataDir = resolve('data') }) {
    this.username = username; this.password = password;
    this.output = resolve(dataDir, 'sessions/suenen.json');
    this.jar = new CookieJar(); this.ready = false; this.pendingLogin = null;
  }
  async restore() {
    try {
      const state = JSON.parse(await readFile(this.output, 'utf8'));
      for (const cookie of state.cookies) {
        const host = cookie.domain.replace(/^\./, '');
        if (!['suenen.com', 'www.suenen.com'].includes(host)) continue;
        if (cookie.expires !== -1 && cookie.expires <= Date.now() / 1000) continue;
        const attributes = [
          `${cookie.name}=${cookie.value}`, `Path=${cookie.path}`,
          ...(cookie.domain.startsWith('.') ? [`Domain=${host}`] : []),
          ...(cookie.secure ? ['Secure'] : []),
          ...(cookie.httpOnly ? ['HttpOnly'] : []),
          ...(cookie.expires !== -1 ? [`Expires=${new Date(cookie.expires * 1000).toUTCString()}`] : []),
        ];
        await this.jar.setCookie(attributes.join('; '), `https://${host}`);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('SUENEN_SESSION_INVALID'); }
  }
  async request(path) {
    const url = new URL(path, SUENEN_ORIGIN);
    if (url.origin !== SUENEN_ORIGIN) throw new Error('SUENEN_INVALID_URL');
    return fetch(url, { headers: { Cookie: await this.jar.getCookieString(url.href) }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  }
  async ensureSession() {
    if (this.ready) return;
    if (this.pendingLogin) return this.pendingLogin;
    this.pendingLogin = (async () => {
      await this.restore();
      const response = await this.request('/my.htm');
      const html = await response.text();
      if (!response.ok || !/\bvar\s+uid\s*=\s*[1-9]\d*\s*;/.test(html)) {
        await loginSuenen({ username: this.username, password: this.password, output: this.output });
        await this.restore();
      }
      this.ready = true;
    })().finally(() => { this.pendingLogin = null; });
    return this.pendingLogin;
  }
  async getHtml(path) {
    await this.ensureSession();
    let response = await this.request(path);
    if (response.status === 302 && response.headers.get('location')?.includes('user-login')) {
      this.ready = false; this.jar = new CookieJar();
      await this.ensureSession(); response = await this.request(path);
    }
    if (!response.ok) throw new Error(`SUENEN_HTTP_${response.status}`);
    return response.text();
  }
  async search(title) {
    const html = await this.getHtml(`/search-${encodeURIComponent(title)}-1.htm`);
    return parseSearchResults(html).slice(0, 10);
  }
  async postShares(id) {
    if (!/^\d+$/.test(id)) throw new Error('SUENEN_INVALID_POST');
    const path = `/thread-${id}.htm`;
    return parseQuarkLinks(await this.getHtml(path), `${SUENEN_ORIGIN}${path}`);
  }
}
