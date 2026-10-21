// @vitest-environment jsdom
import React from 'react';
import { test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MovieCard } from './main';
afterEach(cleanup);
test('movie card links to details with a real poster and stable movie identity', () => {
  render(<MemoryRouter><MovieCard movie={{ id: 42, title: '电影', release_date: '2025-01-01', poster_path: '/fixture.jpg', vote_average: 7.2, overview: '' }} /></MemoryRouter>);
  expect(screen.getByRole('link').getAttribute('href')).toBe('/movies/42');
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://image.tmdb.org/t/p/w342/fixture.jpg');
  expect(screen.getByText('7.2')).toBeTruthy();
});
