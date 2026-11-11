import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Film } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Status } from '@/components/feedback/query-status'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/infrastructure/http/api'

export function AuthGate({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const status = useQuery({
    queryKey: ['auth'],
    queryFn: () => api('/auth/status'),
    retry: false,
  })
  const [password, setPassword] = useState('')
  const login = useMutation({
    mutationFn: () =>
      api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => {
      setPassword('')
      client.invalidateQueries({ queryKey: ['auth'] })
    },
  })
  if (status.isPending || status.error) return <Status query={status} />
  if (status.data?.authenticated) return <>{children}</>
  return (
    <div className="login-screen">
      <Card className="login-card">
        <div className="login-heading">
          <Film size={28} />
          <ThemeToggle />
        </div>
        <form
          className="login-form"
          onSubmit={event => {
            event.preventDefault()
            login.mutate()
          }}
        >
          <div>
            <h1>欢迎回到影栈</h1>
            <p className="page-description">你的电影，你的放映室。</p>
          </div>
          <label htmlFor="admin-password">管理密码</label>
          <Input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
          />
          <Button type="submit" disabled={login.isPending}>
            {login.isPending ? '登录中' : '登录'}
          </Button>
          {login.error && (
            <p className="error" role="alert">
              {login.error.message}
            </p>
          )}
        </form>
      </Card>
    </div>
  )
}
