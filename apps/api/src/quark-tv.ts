import { BadGatewayException, ConflictException } from '@nestjs/common';
import { QuarkTvClient } from '@movie/crawler-engine';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dataDir } from './config.js';

export class QuarkTvService {
  private client!: QuarkTvClient;
  private busy = false;
  private downloads = 0;
  constructor(private storageDir = dataDir) {}
  async initialize() {
    const path = resolve(this.storageDir, 'quark-tv.json');
    let credentials = {};
    try { credentials = JSON.parse(await readFile(path, 'utf8')); }
    catch (error: any) { if (error.code !== 'ENOENT') throw new Error('QUARK_TV_CONFIG_INVALID'); }
    this.client = new QuarkTvClient({ credentials, saveCredentials: async (value: unknown) => {
      await mkdir(this.storageDir, { recursive: true });
      await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    } });
  }
  status() { return this.client.status(); }
  private async action<T>(work: () => Promise<T>) {
    if (this.busy || this.downloads) throw new ConflictException('Quark TV 正在请求，请稍后重试。');
    this.busy = true;
    try { return await work(); }
    catch { throw new BadGatewayException('Quark TV 服务暂时不可用，请重试或重新获取二维码。'); }
    finally { this.busy = false; }
  }
  startLogin() { return this.action(() => this.client.startLogin()); }
  pollLogin() { return this.action(() => this.client.pollLogin()); }
  async logout() { return this.action(async () => { await this.client.logout(); return this.status(); }); }
  async downloadUrl(id: string) {
    if (this.busy) throw new ConflictException('Quark TV 正在授权，请稍后重试。');
    this.downloads++;
    try { return await this.client.downloadUrl(id); }
    finally { this.downloads--; }
  }
}
