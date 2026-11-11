// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ThemeToggle } from '@/components/layout/theme-toggle'

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  vi.restoreAllMocks()
})
test('theme toggling persists the preference and works in both directions', () => {
  document.documentElement.classList.add('dark')
  render(<ThemeToggle />)
  fireEvent.click(screen.getByRole('button', { name: '切换浅色主题' }))
  expect(document.documentElement.classList.contains('dark')).toBe(false)
  expect(localStorage.getItem('cine-stack-theme')).toBe('light')
  fireEvent.click(screen.getByRole('button', { name: '切换深色主题' }))
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(localStorage.getItem('cine-stack-theme')).toBe('dark')
})
test('theme remains usable when the browser blocks local storage', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked')
  })
  render(<ThemeToggle />)
  fireEvent.click(screen.getByRole('button', { name: '切换深色主题' }))
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(screen.getByRole('button', { name: '切换浅色主题' })).toBeTruthy()
})
