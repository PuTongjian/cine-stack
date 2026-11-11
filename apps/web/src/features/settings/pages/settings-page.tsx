import { useMutation, useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Status } from '@/components/feedback/query-status'
import { Button } from '@/components/ui/button'
import { StrmSettingsPanel } from '@/features/settings/components/strm-settings'
import { api } from '@/infrastructure/http/api'
export function SettingsPage() {
  const query = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api('/integrations'),
  })
  const check = useMutation({
    mutationFn: () =>
      api('/integrations/quark/check', { method: 'POST', body: '{}' }),
  })
  return (
    <>
      <div className="page-title">
        <div>
          <h1>连接设置</h1>
          <p className="page-description">连接电影数据、网盘与家庭影院。</p>
        </div>
      </div>
      <Status query={query} />
      {query.data && (
        <div className="settings-list">
          {[
            ['TMDB', query.data.tmdb, '电影数据与海报'],
            ['Suenen', query.data.suenen, '电影资源来源'],
            ['夸克网盘', query.data.quark, query.data.folderName],
          ].map(([name, configured, text]) => (
            <div className="setting-row" key={String(name)}>
              <div>
                <h2>{name}</h2>
                <p>{text}</p>
              </div>
              <span className={configured ? 'connected' : 'error'}>
                {configured ? '已配置' : '未配置'}
              </span>
            </div>
          ))}
          <div className="setting-row">
            <div>
              <h2>网盘连接</h2>
              <p>
                {check.data
                  ? `已连接 · 目录内 ${check.data.count} 项`
                  : query.data.folderId
                    ? '独立电影目录已创建'
                    : '尚未设置电影目录'}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              <RefreshCw size={16} />
              {check.isPending ? '校验中' : '校验连接'}
            </Button>
          </div>
          <div className="setting-row">
            <div>
              <h2>电影元数据</h2>
              <p>NFO、海报与背景图</p>
            </div>
            <span className="connected">已接通</span>
          </div>
          {check.error && <p className="error">{check.error.message}</p>}
          <StrmSettingsPanel />
          <p className="attribution">
            This product uses the TMDB API but is not endorsed or certified by
            TMDB.
          </p>
        </div>
      )}
    </>
  )
}
