import { test, expect } from 'vitest';
import { parseSearchResults, parseQuarkLinks } from './client.mjs';
test('search results preserve thread identity and remove duplicate links', () => {
  const html = '<div class="style3_subject"><a href="thread-12.htm">Movie</a><a href="thread-12.htm#comments">Comments</a></div>';
  expect(parseSearchResults(html)).toEqual([{ id: '12', title: 'Movie', url: 'https://suenen.com/thread-12.htm' }]);
});
test('resource parsing only accepts direct Quark HTTPS shares and extracts passcodes', () => {
  const html = '<div class="message"><p><a href="https://pan.quark.cn/s/abc123">资源</a> 提取码: a123</p><a href="https://evil.test/s/ab">bad</a><a href="http://pan.quark.cn/s/ab">bad</a></div>';
  expect(parseQuarkLinks(html, 'https://suenen.com/thread-12.htm')).toEqual([{ shareId: 'abc123', passcode: 'a123', url: 'https://pan.quark.cn/s/abc123', postUrl: 'https://suenen.com/thread-12.htm' }]);
});
