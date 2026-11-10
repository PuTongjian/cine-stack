import { createHash, randomBytes } from 'node:crypto';

// Protocol reference: OpenList drivers/quark_uc_tv (see docs/quark-tv.md).
const clientId = 'd3194e61504e493eb6222857bccfed94';
const signKey = 'kw2dvtd7p4t3pjl2d9ed9yc8yej8kw2d';
const userAgent = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2004J7AC Build/UKQ1.231108.001) AppleWebKit/533.1 (KHTML, like Gecko) Mobile Safari/533.1';

export class QuarkTvClient {
  constructor({ credentials = {}, saveCredentials = async () => {}, fetchImpl = fetch } = {}) {
    this.credentials = { deviceId: randomBytes(16).toString('hex'), ...credentials };
    this.saveCredentials = saveCredentials;
    this.fetch = fetchImpl;
    this.pending = null;
    this.refreshing = null;
  }
  status() { return { authorized: !!this.credentials.refreshToken, pending: !!this.pending && this.pending.expiresAt > Date.now() }; }
  parameters() {
    return { app_ver: '1.8.2.2', device_id: this.credentials.deviceId, device_brand: 'Xiaomi', platform: 'tv', device_name: 'M2004J7AC', device_model: 'M2004J7AC', build_device: 'M2004J7AC', build_product: 'M2004J7AC', device_gpu: 'Adreno (TM) 550', activity_rect: '{}', channel: 'GENERAL' };
  }
  async request(path, query = {}, retry = true) {
    const timestamp = String(Date.now());
    const url = new URL(path, 'https://open-api-drive.quark.cn');
    url.search = new URLSearchParams({ ...this.parameters(), req_id: createHash('md5').update(this.credentials.deviceId + timestamp).digest('hex'), access_token: this.credentials.accessToken || '', ...query });
    let response;
    try {
      response = await this.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent, 'x-pan-tm': timestamp, 'x-pan-token': createHash('sha256').update(`GET&${path}&${timestamp}&${signKey}`).digest('hex'), 'x-pan-client-id': clientId }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
    } catch { throw new Error('QUARK_TV_UNAVAILABLE'); }
    const result = await response.json().catch(() => ({}));
    if (retry && this.credentials.refreshToken && (response.status === 401 || [10001, 11001].includes(result.errno))) {
      await this.refresh();
      return this.request(path, query, false);
    }
    if (!response.ok || result.errno || result.status === -1 || result.status >= 400) throw new Error(`QUARK_TV_API_${Number(result.errno || result.status || response.status)}`);
    return result;
  }
  async startLogin() {
    const result = await this.request('/oauth/authorize', { auth_type: 'code', client_id: clientId, scope: 'netdisk', qrcode: '1', qr_width: '460', qr_height: '460' }, false);
    if (typeof result.query_token !== 'string' || typeof result.qr_data !== 'string' || result.qr_data.length > 2_000_000) throw new Error('QUARK_TV_INVALID_QR');
    const image = result.qr_data.replace(/^data:image\/(png|jpeg);base64,/, '');
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(image)) throw new Error('QUARK_TV_INVALID_QR');
    this.pending = { token: result.query_token, expiresAt: Date.now() + 5 * 60_000 };
    return { image: `data:image/png;base64,${image}`, expiresAt: this.pending.expiresAt };
  }
  async pollLogin() {
    const pending = this.pending;
    if (!pending || pending.expiresAt <= Date.now()) { this.pending = null; return { status: 'expired' }; }
    let result;
    try { result = await this.request('/oauth/code', { client_id: clientId, scope: 'netdisk', query_token: pending.token }, false); }
    catch (error) {
      if (error.message === 'QUARK_TV_API_11003') return { status: 'waiting' };
      throw error;
    }
    if (!result.code) return { status: 'waiting' };
    if (typeof result.code !== 'string') throw new Error('QUARK_TV_INVALID_CODE');
    await this.exchange({ code: result.code });
    if (this.pending === pending) this.pending = null;
    return { status: 'authorized' };
  }
  async exchange(input) {
    let response;
    try {
      response = await this.fetch('https://api.extscreen.com/quarkdrive/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...this.parameters(), req_id: randomBytes(16).toString('hex'), ...input }), signal: AbortSignal.timeout(20_000), redirect: 'error' });
    } catch { throw new Error('QUARK_TV_TOKEN_UNAVAILABLE'); }
    const result = await response.json().catch(() => ({}));
    const data = result.data;
    if (!response.ok || result.code !== 200 || !data?.access_token || !data?.refresh_token) throw new Error('QUARK_TV_TOKEN_FAILED');
    const credentials = { deviceId: this.credentials.deviceId, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    await this.saveCredentials(credentials);
    this.credentials = credentials;
  }
  async refresh() {
    if (!this.credentials.refreshToken) throw new Error('QUARK_TV_AUTH_REQUIRED');
    if (!this.refreshing) this.refreshing = this.exchange({ refresh_token: this.credentials.refreshToken }).finally(() => { this.refreshing = null; });
    await this.refreshing;
  }
  async downloadUrl(fileId) {
    if (!/^[a-zA-Z0-9]+$/.test(fileId)) throw new Error('QUARK_TV_INVALID_FILE_ID');
    if (!this.credentials.accessToken || this.credentials.expiresAt <= Date.now() + 60_000) await this.refresh();
    const result = await this.request('/file', { method: 'download', group_by: 'source', fid: fileId, resolution: 'low,normal,high,super,2k,4k', support: 'dolby_vision' });
    if (typeof result.data?.download_url !== 'string') throw new Error('QUARK_TV_DOWNLOAD_UNAVAILABLE');
    return result.data.download_url;
  }
  async logout() {
    await this.saveCredentials({ deviceId: this.credentials.deviceId });
    this.credentials = { deviceId: this.credentials.deviceId };
    this.pending = null;
  }
}
