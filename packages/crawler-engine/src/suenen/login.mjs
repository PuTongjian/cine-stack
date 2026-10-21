import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { CookieJar } from 'tough-cookie';
import { nodeCaptcha } from '../geetest/geetest-node.mjs';
import { resolve, dirname } from 'node:path';

const origin = 'https://suenen.com';
export async function loginSuenen({ username, password, output = resolve(process.env.DATA_DIR || 'data', 'sessions/suenen.json') }) {
  if (!username || !password) throw new Error('Set SUENEN_USERNAME and SUENEN_PASSWORD first.');
  const jar = new CookieJar();
  async function request(path, options = {}) {
    const url = new URL(path, origin);
    const response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Cookie: await jar.getCookieString(url.href) },
      redirect: 'manual', signal: AbortSignal.timeout(30_000),
    });
    for (const value of response.headers.getSetCookie()) await jar.setCookie(value, url.href);
    return response;
  }
  const bootstrap = await request('/user-login.htm');
  if (!bootstrap.ok) throw new Error(`Login page HTTP status: ${bootstrap.status}`);
  await bootstrap.arrayBuffer();
  const captcha = await nodeCaptcha();
  const fields = Object.fromEntries(['lot_number', 'captcha_output', 'pass_token', 'gen_time']
    .map((name) => [name, captcha[name]]));
  const response = await request('/user-login.htm', {
    method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest', Origin: origin, Referer: `${origin}/user-login.htm`,
    },
    body: new URLSearchParams({ email: username, password: createHash('md5').update(password).digest('hex'), ...fields }),
  });
  if (!response.ok) throw new Error(`Login HTTP status: ${response.status}`);
  const result = await response.json();
  if (result.code !== 0 && result.code !== '0') throw new Error(`Login rejected (code: ${String(result.code)}).`);
  const center = await request('/my.htm');
  const html = await center.text();
  const uid = Number(html.match(/\bvar\s+uid\s*=\s*(\d+)\s*;/)?.[1]);
  if (!center.ok || !Number.isSafeInteger(uid) || uid <= 0) throw new Error('HTTP personal center did not confirm login.');
  const cookies = (await jar.getCookies(`${origin}/`)).map((cookie) => ({
    name: cookie.key, value: cookie.value,
    domain: cookie.hostOnly ? cookie.domain : `.${cookie.domain}`,
    path: cookie.path, expires: cookie.expiryTime() === Infinity ? -1 : cookie.expiryTime() / 1000,
    httpOnly: cookie.httpOnly, secure: cookie.secure,
    sameSite: { strict: 'Strict', lax: 'Lax', none: 'None' }[cookie.sameSite] || 'Lax',
  }));
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}-${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ cookies, origins: [] }, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temporary, output);
  const report = {
    checkedAt: new Date().toISOString(), runtime: 'Node.js; no browser, DOM, Playwright, or saved login cookies',
    geetest: 'success', loginCode: result.code, personalCenterStatus: center.status, uid,
    sessionFile: output,
  };
  return report;
}
