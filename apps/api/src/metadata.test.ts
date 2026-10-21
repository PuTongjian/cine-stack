import { test, expect } from 'vitest';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { buildNfo, movieBasename, movieFolder } from './metadata.js';
test('NFO escapes text and preserves explicit TMDB identifiers', () => {
  const xml = buildNfo({ id: 42, title: 'A & <B>', original_title: 'Example', release_date: '2025-02-01', vote_average: 7, vote_count: 30, credits: { cast: [], crew: [] } });
  expect(XMLValidator.validate(xml)).toBe(true);
  const parsed = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false }).parse(xml);
  expect(parsed.movie.title).toBe('A & <B>');
  expect(parsed.movie.uniqueid['@_default']).toBe('true');
  expect(parsed.movie.uniqueid['#text']).toBe(42);
});
test('movie names remove invalid path characters without losing identity', () => {
  const movie = { id: 42, title: 'Film:/\\?* <Name>', release_date: '2025-01-01' };
  expect(movieBasename(movie)).toBe('Film Name (2025)');
  expect(movieFolder(movie)).toBe('Film Name (2025) [tmdbid-42]');
});
