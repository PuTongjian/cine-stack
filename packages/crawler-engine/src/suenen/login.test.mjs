import { test, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('../geetest/geetest-node.mjs', () => ({ nodeCaptcha: vi.fn(async () => ({ lot_number: 'fixture', captcha_output: 'fixture', pass_token: 'fixture', gen_time: 'fixture' })) }));
import { loginSuenen } from './login.mjs';
afterEach(() => vi.unstubAllGlobals());

test('login uses the canonical www origin for every step and saves scoped cookies', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'suenen-login-'));
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    requests.push({ url: url.href, options });
    if (url.hostname === 'suenen.com') return new Response(null, { status: 301, headers: { Location: 'https://www.suenen.com/user-login.htm' } });
    if (options.method === 'POST') return new Response('{"code":"0"}', { headers: { 'Set-Cookie': 'bbs_token=fixture; Path=/; Secure; HttpOnly' } });
    if (url.pathname === '/my.htm') {
      expect(options.headers.Cookie).toContain('bbs_token=fixture');
      return new Response('<script>var uid = 19209;</script>');
    }
    return new Response('<title>用户登录</title>');
  }));
  try {
    const output = join(folder, 'session.json');
    const result = await loginSuenen({ username: 'fixture-user', password: 'fixture-password', output });
    expect(result.uid).toBe(19209);
    expect(requests.map((request) => request.url)).toEqual([
      'https://www.suenen.com/user-login.htm', 'https://www.suenen.com/user-login.htm', 'https://www.suenen.com/my.htm',
    ]);
    expect(requests[1].options.headers.Origin).toBe('https://www.suenen.com');
    expect(requests[1].options.headers.Referer).toBe('https://www.suenen.com/user-login.htm');
    expect(requests[1].options.body.get('email')).toBe('fixture-user');
    expect(requests[1].options.body.get('password')).toMatch(/^[a-f0-9]{32}$/);
    const state = JSON.parse(await readFile(output, 'utf8'));
    expect(state.cookies[0].domain).toBe('www.suenen.com');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('actual captcha rejection preserves its actionable error for search tasks', async () => {
  const { nodeCaptcha } = await import('../geetest/geetest-node.mjs');
  nodeCaptcha.mockRejectedValueOnce(new Error('SUENEN_验证码校验未通过（SDK /v4/static/future），当前登录参数可能不兼容。'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<title>用户登录</title>')));
  await expect(loginSuenen({ username: 'fixture-user', password: 'fixture-password' })).rejects.toThrow('SUENEN_验证码校验未通过（SDK /v4/static/future），当前登录参数可能不兼容。');
});
