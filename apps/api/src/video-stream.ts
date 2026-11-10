import { BadRequestException } from '@nestjs/common';
import { once } from 'node:events';
import type { Request, Response } from 'express';

const chunkSize = 8 * 1024 * 1024;

export function downloadHost(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') ||
    !['quark.cn', 'quarkcdn.com'].some((host) => parsed.hostname.endsWith(`.${host}`))) throw new Error('STRM_DOWNLOAD_HOST_INVALID');
  return parsed;
}

export function playbackRange(range?: string) {
  if (!range) return { start: 0, end: undefined, relay: true };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) throw new BadRequestException('STRM_INVALID_RANGE');
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if ([start, end].some((value) => value !== undefined && !Number.isSafeInteger(value)) || (start !== undefined && end !== undefined && end < start) || (start === undefined && end === 0)) throw new BadRequestException('STRM_INVALID_RANGE');
  return { start, end, relay: start !== undefined && (end === undefined || end - start >= chunkSize) };
}

export async function streamVideo(url: URL, req: Request, res: Response) {
  const range = playbackRange(req.headers.range);
  let position = range.start || 0;
  let finalEnd = range.end;
  let total: number | undefined;
  let etag: string | null = null;
  const disconnected = new AbortController();
  const cancel = () => disconnected.abort();
  res.on('close', cancel);
  try {
    while (!disconnected.signal.aborted) {
      const requestedEnd = Math.min(position + chunkSize - 1, finalEnd ?? Number.MAX_SAFE_INTEGER);
      const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(30_000)]);
      let upstream: globalThis.Response | undefined;
      for (let redirects = 0; redirects < 4; redirects++) {
        upstream = await fetch(url, { headers: { Range: `bytes=${position}-${requestedEnd}`, 'Accept-Encoding': 'identity' }, redirect: 'manual', signal });
        if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
        await upstream.body?.cancel();
        const location = upstream.headers.get('location');
        if (!location) throw new Error('STRM_INVALID_REDIRECT');
        url = downloadHost(new URL(location, url).href);
      }
      if (!upstream) throw new Error('STRM_NO_RESPONSE');
      if (upstream.status === 416 && total === undefined) {
        await upstream.body?.cancel();
        const contentRange = upstream.headers.get('content-range');
        if (!contentRange || !/^bytes \*\/\d+$/.test(contentRange)) throw new Error('STRM_INVALID_CONTENT_RANGE');
        res.status(416).set({ 'Content-Range': contentRange, 'Content-Length': '0', 'Accept-Ranges': 'bytes' }).end();
        return;
      }
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(upstream.headers.get('content-range') || '');
      const start = Number(match?.[1]);
      const end = Number(match?.[2]);
      const size = Number(match?.[3]);
      const first = total === undefined;
      if (upstream.status !== 206 || !upstream.body || !match || ![start, end, size].every(Number.isSafeInteger) || size <= 0 || start !== position || end !== Math.min(requestedEnd, size - 1) || end < start ||
        (total !== undefined && (size !== total || (etag && upstream.headers.get('etag') !== etag)))) {
        await upstream.body?.cancel();
        throw new Error('STRM_INVALID_CONTENT_RANGE');
      }
      if (first) {
        total = size;
        etag = upstream.headers.get('etag');
        finalEnd = Math.min(finalEnd ?? size - 1, size - 1);
        res.status(req.headers.range ? 206 : 200).set({ 'Accept-Ranges': 'bytes', 'Content-Length': String(finalEnd - position + 1), 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream' });
        if (req.headers.range) res.setHeader('Content-Range', `bytes ${position}-${finalEnd}/${size}`);
      }
      try {
        // Only one upstream range is active; res.write applies downstream backpressure.
        for await (const bytes of upstream.body) {
          if (position + bytes.length > end + 1) throw new Error('STRM_RANGE_OVERFLOW');
          position += bytes.length;
          if (!res.write(bytes)) await once(res, 'drain', { signal });
        }
      } catch (error) {
        disconnected.abort();
        throw error;
      }
      if (position !== end + 1) throw new Error('STRM_RANGE_TRUNCATED');
      if (position > finalEnd!) { res.end(); return; }
    }
  } finally {
    disconnected.abort();
    res.off('close', cancel);
  }
}
