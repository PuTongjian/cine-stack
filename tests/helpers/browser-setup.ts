import { vi } from 'vitest'

// jsdom does not implement layout observers used by Radix form controls.
if (typeof window !== 'undefined') {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
}
