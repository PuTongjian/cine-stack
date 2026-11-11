import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AuthGate } from '@/features/auth/components/auth-gate'
import { AppShell } from './app-shell'

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
})
export function Root() {
  return (
    <React.StrictMode>
      <QueryClientProvider client={client}>
        <AuthGate>
          <BrowserRouter>
            <AppShell />
          </BrowserRouter>
        </AuthGate>
      </QueryClientProvider>
    </React.StrictMode>
  )
}
