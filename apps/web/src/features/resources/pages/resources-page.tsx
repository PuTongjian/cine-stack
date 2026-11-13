import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowUpRight,
  Folder,
  LoaderCircle,
  Search,
} from 'lucide-react'
import React from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Status } from '@/components/feedback/query-status'
import { Button } from '@/components/ui/button'
import { api } from '@/infrastructure/http/api'
import { ShareFileBrowser } from '../components/share-file-browser'
export function ResourcesPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const searchId = params.get('searchId')
  const task = useQuery({
    queryKey: ['task', searchId],
    queryFn: () => api(`/tasks/${searchId}`),
    enabled: !!searchId,
    refetchInterval: query =>
      ['queued', 'running'].includes(query.state.data?.status) ? 2000 : false,
  })
  const results = useQuery({
    queryKey: ['resources', searchId],
    queryFn: () => api<any[]>(`/resources?searchId=${searchId}`),
    enabled: task.data?.status === 'completed' && !task.data?.result.posts,
  })
  const [post, setPost] = React.useState<any>(null)
  const [chosenResource, setResource] = React.useState<any>(null)
  const shares = useQuery({
    queryKey: ['post-resources', searchId, post?.id],
    queryFn: () => api<any[]>(`/tasks/${searchId}/posts/${post.id}/resources`),
    enabled: !!post,
    retry: false,
  })
  const resource =
    chosenResource ||
    (!shares.error && shares.data?.length === 1 ? shares.data[0] : null)
  return (
    <>
      <Link className="back" to={`/movies/${id}`}>
        <ArrowLeft size={16} />
        电影详情
      </Link>
      <div className="page-title">
        <div>
          <h1>选择电影资源</h1>
        </div>
      </div>
      <p className="muted">
        列出 Suenen
        的全部搜索结果，点击标题读取分享；需要回复的帖子会自动回复解锁。可选择整个文件夹，或同时勾选电影和字幕转存。
      </p>
      {(task.isPending || task.error) && <Status query={task} />}
      {task.data && ['queued', 'running'].includes(task.data.status) && (
        <div className="status">
          <LoaderCircle className="spin" />
          <p>正在 Suenen 搜索标题</p>
        </div>
      )}
      {task.data?.error && (
        <p className="error" role="alert">
          {task.data.error}
        </p>
      )}
      {(task.data?.result.posts?.length === 0 ||
        results.data?.length === 0) && (
        <div className="empty">
          <Search />
          <p>未找到相关资源标题</p>
          <Link to={`/movies/${id}`}>返回电影详情</Link>
        </div>
      )}
      {task.data?.status === 'completed' && !task.data.result.posts && (
        <Status query={results} />
      )}
      <div className="resources-layout">
        <div>
          {(task.data?.result.posts || results.data)?.map(
            (item: any, index: number) => (
              <div
                className={`resource-row ${item.id === (post?.id || resource?.id) ? 'selected' : ''}`}
                key={item.id}
              >
                <span className="provider">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3>
                  <Button
                    variant="outline"
                    className="resource-title h-auto min-h-9 justify-start whitespace-normal rounded-none border-0 bg-transparent p-0 text-left font-normal shadow-none hover:bg-transparent"
                    aria-pressed={item.id === (post?.id || resource?.id)}
                    onClick={() => {
                      setPost(item.shareId ? null : item)
                      setResource(item.shareId ? item : null)
                    }}
                  >
                    {item.title}
                  </Button>
                </h3>
                <a
                  href={item.url || item.postUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  来源帖子 <ArrowUpRight size={13} />
                </a>
              </div>
            )
          )}
        </div>
        {post && shares.isPending && <Status query={shares} />}
        {post && shares.error && (
          <div className="resource-notice" role="alert">
            <div>
              <h2>暂时无法查看分享</h2>
              <p>{shares.error.message}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={post.url} target="_blank" rel="noreferrer">
                  打开原帖
                  <ArrowUpRight size={14} />
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={shares.isFetching}
                onClick={() => shares.refetch()}
              >
                {shares.isFetching ? '读取中…' : '重新读取分享'}
              </Button>
            </div>
          </div>
        )}
        {shares.data && shares.data.length > 1 && (
          <section className="file-browser">
            <h2>选择夸克分享</h2>
            {shares.data.map((item, index) => (
              <div className="resource-row" key={item.id}>
                <Button
                  variant="outline"
                  aria-pressed={resource?.id === item.id}
                  onClick={() => {
                    setResource(item)
                  }}
                >
                  <Folder size={16} />
                  分享 {index + 1}
                </Button>
                <a
                  href={`https://pan.quark.cn/s/${item.shareId}${item.passcode ? `?pwd=${encodeURIComponent(item.passcode)}` : ''}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开网盘 <ArrowUpRight size={13} />
                </a>
              </div>
            ))}
          </section>
        )}
        {resource && (
          <ShareFileBrowser
            key={`${searchId}:${post?.id || ''}:${resource.id}`}
            resource={resource}
            title={post?.title || resource.title}
          />
        )}
      </div>
    </>
  )
}
