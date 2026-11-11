import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Check,
  Download,
  Eye,
  Film,
  Search,
  Star,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Status } from '@/components/feedback/query-status'
import { Button } from '@/components/ui/button'
import { image } from '@/domain/movies/image'
import { api } from '@/infrastructure/http/api'
export function MovieDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['movie', id],
    queryFn: () => api(`/movies/${id}`),
  })
  const library = useQuery({
    queryKey: ['library'],
    queryFn: () => api('/library'),
  })
  const entry = library.data?.results?.find(
    (movie: any) => movie.id === Number(id)
  )
  const watched = useMutation({
    mutationFn: () =>
      api(`/library/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ watched: !entry?.watchedAt }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  })
  const search = useMutation({
    mutationFn: () =>
      api(`/movies/${id}/resource-searches`, { method: 'POST', body: '{}' }),
    onSuccess: task => navigate(`/movies/${id}/resources?searchId=${task.id}`),
  })
  const movie = query.data
  if (!movie) return <Status query={query} />
  return (
    <>
      <Link className="back" to="/discover">
        <ArrowLeft size={16} />
        电影发现
      </Link>
      <div className="detail">
        <div className="detail-poster">
          {movie.poster_path ? (
            <img
              src={image(movie.poster_path)}
              width="500"
              height="750"
              alt={movie.title}
            />
          ) : (
            <Film size={50} />
          )}
        </div>
        <div className="detail-copy">
          <p className="eyebrow">
            {movie.release_date?.slice(0, 4)} ·{' '}
            {movie.genres?.map((g: any) => g.name).join(' / ')}
          </p>
          <h1>{movie.title}</h1>
          <p className="original-title">{movie.original_title}</p>
          <div className="facts">
            <span className="accent">
              <Star size={17} />
              {movie.vote_average?.toFixed(1)}
            </span>
            <span>{movie.runtime} 分钟</span>
            <span>{movie.release_date}</span>
          </div>
          <p className="synopsis">{movie.overview || '暂无简介'}</p>
          <div className="actions">
            <Button
              variant="default"
              className="primary"
              onClick={() => search.mutate()}
              disabled={search.isPending}
            >
              <Search size={17} />
              {search.isPending ? '正在查找' : '查找资源'}
            </Button>
            <Button
              variant="outline"
              onClick={() => watched.mutate()}
              disabled={watched.isPending}
              aria-pressed={!!entry?.watchedAt}
            >
              {entry?.watchedAt ? <Check size={17} /> : <Eye size={17} />}
              {entry?.watchedAt ? '已看过' : '标记看过'}
            </Button>
            <a
              className="button icon"
              title="下载 NFO"
              href={`/api/movies/${id}/nfo`}
            >
              <Download size={18} />
            </a>
          </div>
          {(search.error || watched.error) && (
            <p className="error" role="alert">
              {search.error?.message || watched.error?.message}
            </p>
          )}
          <dl>
            <dt>导演</dt>
            <dd>
              {movie.credits?.crew
                ?.filter((p: any) => p.job === 'Director')
                .map((p: any) => p.name)
                .join(' / ') || '—'}
            </dd>
            <dt>主演</dt>
            <dd>
              {movie.credits?.cast
                ?.slice(0, 6)
                .map((p: any) => p.name)
                .join(' / ') || '—'}
            </dd>
            <dt>状态</dt>
            <dd>
              {entry?.downloaded ? '已转存' : '未下载'}
              {entry?.watchedAt ? ' · 已看过' : ''}
            </dd>
          </dl>
        </div>
      </div>
      {movie.backdrop_path && (
        <img
          className="backdrop"
          src={image(movie.backdrop_path, 'w1280')}
          alt={`${movie.title} 剧照`}
          width="1280"
          height="720"
          loading="lazy"
        />
      )}
    </>
  )
}
