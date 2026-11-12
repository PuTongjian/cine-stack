import type { MovieSummary } from '@movie/contracts'
import {
  ArrowUpRight,
  CloudDownload,
  Eye,
  Film,
  Play,
  Star,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { image } from '@/domain/movies/image'

export function MovieCard({
  movie,
}: {
  movie: MovieSummary & {
    watchedAt?: string
    downloaded?: boolean
    strm?: boolean
  }
}) {
  const [failed, setFailed] = useState(false)
  return (
    <Link className="movie" to={`/movies/${movie.id}`}>
      <div className="poster">
        {movie.poster_path && !failed ? (
          <img
            src={image(movie.poster_path, 'w342')}
            width="342"
            height="513"
            loading="lazy"
            alt={`${movie.title} 海报`}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="missing" aria-label={`${movie.title} 暂无海报`}>
            <Film size={32} />
          </div>
        )}
        <span className="score">
          <Star size={11} fill="currentColor" />
          {movie.vote_average?.toFixed(1)}
        </span>
        {(movie.watchedAt || movie.downloaded || movie.strm) && (
          <span
            className="movie-state flex items-center gap-1"
            aria-label={[
              movie.downloaded ? '网盘已存' : '',
              movie.strm ? 'STRM 已映射' : '',
              movie.watchedAt ? '已看过' : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {movie.watchedAt && <Eye size={15} />}
            {movie.downloaded && <CloudDownload size={15} />}
            {movie.strm && <Play size={15} />}
          </span>
        )}
        <span className="poster-open" aria-hidden="true">
          <ArrowUpRight size={18} />
        </span>
      </div>
      <h3>{movie.title}</h3>
      <p>
        {movie.release_date?.slice(0, 4) || '待定'}
        <span>
          {movie.original_title !== movie.title ? movie.original_title : '电影'}
        </span>
      </p>
    </Link>
  )
}
