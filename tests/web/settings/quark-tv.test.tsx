// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { QuarkTvPanel } from '../../../apps/web/src/features/settings/components/quark-tv'
import { api } from '../../../apps/web/src/infrastructure/http/api'

vi.mock('../../../apps/web/src/infrastructure/http/api', () => ({
  api: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('displays the QR, recognizes confirmation and clears authorization without displaying tokens', async () => {
  let authorized = false
  vi.mocked(api).mockImplementation(async path => {
    if (path === '/integrations/quark-tv') return { authorized }
    if (path.endsWith('/login'))
      return {
        image: 'data:image/png;base64,aW1hZ2U=',
        expiresAt: Date.now() + 300_000,
      }
    if (path.endsWith('/poll')) {
      authorized = true
      return { status: 'authorized' }
    }
    if (path.endsWith('/logout')) {
      authorized = false
      return { authorized: false }
    }
    throw new Error('Unexpected path')
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <QuarkTvPanel />
    </QueryClientProvider>
  )
  await screen.findByText('未授权')
  fireEvent.click(screen.getByRole('button', { name: '扫码授权 Quark TV' }))
  await screen.findByText('已授权')
  await waitFor(() =>
    expect(
      screen.queryByAltText('使用夸克手机 App 扫码授权 Quark TV')
    ).toBeNull()
  )
  fireEvent.click(screen.getByRole('button', { name: '解除授权' }))
  await screen.findByText('未授权')
  expect(
    vi.mocked(api).mock.calls.some(([path]) => path.endsWith('/poll'))
  ).toBe(true)
})
