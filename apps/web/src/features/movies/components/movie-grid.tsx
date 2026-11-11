import type { MovieSummary } from '@movie/contracts'
import { Film } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { MovieCard } from './movie-card'

const placeholders = Array.from({ length: 20 }, (_, index) => index)
export function MovieGridSkeleton() {
  return (
    <div className="poster-grid" role="status" aria-label="加载电影中">
      {placeholders.map(index => (
        <Skeleton className="aspect-poster w-full rounded-lg" key={index} />
      ))}
    </div>
  )
}
export function Grid({ movies }: { movies: MovieSummary[] }) {
  return movies.length ? (
    <div className="poster-grid">
      {movies.map(movie => (
        <MovieCard key={movie.id} movie={movie} />
      ))}
    </div>
  ) : (
    <div className="empty">
      <Film />
      <p>还没有电影</p>
      <Link to="/discover">浏览电影</Link>
    </div>
  )
}
