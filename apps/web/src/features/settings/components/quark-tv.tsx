import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '../../../infrastructure/http/api'

export function QuarkTvPanel() {
  const client = useQueryClient()
  const [qr, setQr] = useState<{ image: string; expiresAt: number } | null>(
    null
  )
  const status = useQuery({
    queryKey: ['quark-tv'],
    queryFn: () => api<{ authorized: boolean }>('/integrations/quark-tv'),
  })
  const login = useMutation({
    mutationFn: () =>
      api<{ image: string; expiresAt: number }>(
        '/integrations/quark-tv/login',
        { method: 'POST', body: '{}' }
      ),
    onSuccess: setQr,
  })
  const logout = useMutation({
    mutationFn: () =>
      api('/integrations/quark-tv/logout', { method: 'POST', body: '{}' }),
    onSuccess: () => {
      setQr(null)
      client.invalidateQueries({ queryKey: ['quark-tv'] })
    },
  })
  const poll = useQuery({
    queryKey: ['quark-tv-poll', qr?.expiresAt],
    queryFn: () =>
      api<{ status: string }>('/integrations/quark-tv/poll', {
        method: 'POST',
        body: '{}',
      }),
    enabled: !!qr,
    retry: false,
    refetchInterval: query =>
      query.state.error ||
      ['authorized', 'expired'].includes(query.state.data?.status || '')
        ? false
        : 3000,
  })
  useEffect(() => {
    if (poll.data?.status === 'authorized') {
      setQr(null)
      client.invalidateQueries({ queryKey: ['quark-tv'] })
    }
  }, [poll.data, client])
  const error = status.error || login.error || logout.error || poll.error
  return (
    <section className="strm-settings" aria-labelledby="quark-tv-title">
      <div className="setting-row">
        <div>
          <h2 id="quark-tv-title">Quark TV · 播放授权</h2>
          <p>
            转存使用夸克 Cookie；播放使用 Quark TV，自动优化网页起播和进度跳转。
          </p>
        </div>
        <span className={status.data?.authorized ? 'connected' : 'muted'}>
          {status.isPending
            ? '加载中'
            : status.data?.authorized
              ? '已授权'
              : '未授权'}
        </span>
      </div>
      <p className="muted">
        使用与转存相同的夸克账号扫码确认。授权令牌通过与 OpenList 相同的
        ExtScreen 服务交换，仅保存在服务器。
      </p>
      <div className="actions">
        <Button
          variant="outline"
          type="button"
          disabled={login.isPending || logout.isPending}
          onClick={() => login.mutate()}
        >
          {login.isPending
            ? '正在获取二维码…'
            : qr
              ? '刷新二维码'
              : status.data?.authorized
                ? '重新扫码授权'
                : '扫码授权 Quark TV'}
        </Button>
        {status.data?.authorized && (
          <Button
            variant="outline"
            type="button"
            disabled={logout.isPending || login.isPending}
            onClick={() => logout.mutate()}
          >
            解除授权
          </Button>
        )}
      </div>
      {qr && (
        <div className="quark-tv-qr">
          <img
            src={qr.image}
            width="230"
            height="230"
            alt="使用夸克手机 App 扫码授权 Quark TV"
          />
          <p role="status">
            {poll.data?.status === 'expired'
              ? '二维码已过期，请刷新。'
              : poll.error
                ? '授权检查失败，请刷新二维码重试。'
                : '请使用夸克手机 App 扫码，并在手机上确认授权。'}
          </p>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}
    </section>
  )
}
