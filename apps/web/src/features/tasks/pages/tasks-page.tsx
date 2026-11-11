import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CloudDownload,
  Download,
  ListChecks,
  RefreshCw,
  Search,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Status } from '@/components/feedback/query-status'
import { Button } from '@/components/ui/button'
import { stages } from '@/domain/tasks/stages'
import { api } from '@/infrastructure/http/api'
export function TasksPage() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api<any[]>('/tasks'),
    refetchInterval: 3000,
  })
  const retry = useMutation({
    mutationFn: (id: string) =>
      api(`/tasks/${id}/retry`, { method: 'POST', body: '{}' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
  return (
    <>
      <div className="page-title">
        <div>
          <h1>任务记录</h1>
          <p className="page-description">查看资源搜索与转存进度。</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="icon"
          title="刷新任务"
          onClick={() => query.refetch()}
        >
          <RefreshCw size={19} />
        </Button>
      </div>
      <Status query={query} />
      {!query.data?.length && !query.isPending && (
        <div className="empty">
          <ListChecks />
          <p>暂无搜索或转存任务</p>
          <Link to="/discover">浏览电影</Link>
        </div>
      )}
      {query.data?.map(task => (
        <article className="task-row" key={task.id}>
          <div className="task-icon">
            {task.kind === 'search' ? <Search /> : <CloudDownload />}
          </div>
          <div className="task-copy">
            <Link to={`/movies/${task.movieId}`}>
              {task.kind === 'search' ? '资源搜索' : '夸克转存'} · TMDB{' '}
              {task.movieId}
            </Link>
            <p>{stages[task.stage] || task.stage}</p>
            {task.error && <p className="error">{task.error}</p>}
            {task.result.strm && (
              <p>STRM 映射 · {task.result.strm.count} 个文件</p>
            )}
            {task.result.warnings?.map((warning: string) => (
              <p key={warning} className="warning">
                {warning}
              </p>
            ))}
            <time>{new Date(task.createdAt).toLocaleString('zh-CN')}</time>
          </div>
          <div className="task-actions">
            {task.kind === 'search' && task.stage === 'awaiting_selection' && (
              <Link
                className="button"
                to={`/movies/${task.movieId}/resources?searchId=${task.id}`}
              >
                选择资源
              </Link>
            )}
            {task.result.nfoUrl && (
              <a
                className="button icon"
                href={task.result.nfoUrl}
                title="下载 NFO"
              >
                <Download size={18} />
              </a>
            )}
            {['failed', 'partial'].includes(task.status) && (
              <Button
                variant="outline"
                size="icon"
                className="icon"
                title="重试任务"
                disabled={retry.isPending}
                onClick={() => retry.mutate(task.id)}
              >
                <RefreshCw size={18} />
              </Button>
            )}
            <span className={`task-status ${task.status}`}>
              {task.status === 'running'
                ? '处理中'
                : task.status === 'completed'
                  ? '完成'
                  : task.status === 'failed'
                    ? '失败'
                    : task.status === 'partial'
                      ? '待整理'
                      : '排队中'}
            </span>
          </div>
        </article>
      ))}
      {retry.error && <p className="error">{retry.error.message}</p>}
    </>
  )
}
