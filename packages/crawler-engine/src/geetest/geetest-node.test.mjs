import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { encryptW, proofOfWork, parseJsonp } from './geetest-node.mjs';

test('w contains decryptable AES-CBC JSON followed by a 1024-bit RSA block', () => {
  const payload = { setLeft: 167, passtime: 1200, userresponse: 169 };
  const secret = '0123456789abcdef';
  const w = encryptW(payload, secret);
  assert.match(w, /^[0-9a-f]+$/);
  const encrypted = Buffer.from(w.slice(0, -256), 'hex');
  assert.equal(encrypted.length % 16, 0);
  assert.equal(Buffer.from(w.slice(-256), 'hex').length, 128);
  const decipher = createDecipheriv('aes-128-cbc', Buffer.from(secret), Buffer.from('0000000000000000'));
  const decoded = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString();
  assert.deepEqual(JSON.parse(decoded), payload);
});

test('PoW binds the challenge and satisfies a nonzero leading-bit requirement', () => {
  const detail = { version: '1', bits: 5, hashfunc: 'md5', datetime: '2026-10-20 16:00:00' };
  let counter = 0;
  const result = proofOfWork('fixture-lot', detail, () => String(counter++));
  assert.ok(result.pow_msg.includes('|fixture-lot||'));
  assert.equal(createHash('md5').update(result.pow_msg).digest('hex'), result.pow_sign);
  assert.equal(result.pow_sign[0], '0');
  assert.ok(parseInt(result.pow_sign[1], 16) < 8);
});

test('parses JSON and JSONP without evaluating response code', () => {
  assert.deepEqual(parseJsonp('geetest_123({"status":"success"});'), { status: 'success' });
  assert.deepEqual(parseJsonp('({"status":"success"})'), { status: 'success' });
  assert.deepEqual(parseJsonp('{"status":"error"}'), { status: 'error' });
  assert.throws(() => parseJsonp('alert(1)'), /Unexpected/);
  assert.throws(() => parseJsonp('geetest_123({}); process.exit()'), /Unexpected/);
});
