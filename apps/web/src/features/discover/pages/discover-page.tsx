import type { MovieSummary } from '@movie/contracts'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Status } from '@/components/feedback/query-status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Grid,
  MovieGridSkeleton,
} from '@/features/movies/components/movie-grid'
import { api } from '@/infrastructure/http/api'
import { CatalogFilter } from '../components/catalog-filter'

type MovieResults = {
  results: MovieSummary[]
  total_results: number
  total_pages: number
}
export function Discover() {
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') || 'trending'
  const page = Number(params.get('page') || 1)
  const [input, setInput] = useState(params.get('q') || '')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const genres = useQuery({
    queryKey: ['genres'],
    queryFn: () =>
      api<{ genres: { id: number; name: string }[] }>('/movies/genres'),
  })
  const queryString = new URLSearchParams(params)
  queryString.delete('mode')
  queryString.set('page', String(page))
  const endpoint =
    mode === 'search' ? 'search' : mode === 'discover' ? 'discover' : 'trending'
  const query = useQuery({
    queryKey: ['discover', endpoint, queryString.toString()],
    queryFn: () => api<MovieResults>(`/movies/${endpoint}?${queryString}`),
    enabled: mode !== 'search' || !!params.get('q'),
  })
  const change = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    next.delete('page')
    setParams(next)
  }
  function changePage(nextPage: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(nextPage))
    setParams(next)
    window.scrollTo(0, 0)
  }
  const showFilters = mode === 'discover' || filtersOpen
  return (
    <>
      <div className="page-title">
        <div>
          <h1>发现电影</h1>
          <p className="page-description">
            探索热门佳片，找到下一部想看的电影。
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="切换电影筛选"
          aria-expanded={showFilters}
          aria-controls="movie-filters"
          onClick={() =>
            mode === 'discover'
              ? setParams({ mode: 'trending' })
              : setFiltersOpen(!filtersOpen)
          }
        >
          <SlidersHorizontal size={16} />
        </Button>
      </div>
      <Tabs
        value={mode}
        onValueChange={value =>
          setParams(
            value === 'search' && input.trim()
              ? { mode: value, q: input.trim() }
              : { mode: value }
          )
        }
      >
        <div className="catalog-toolbar">
          <TabsList aria-label="电影来源">
            <TabsTrigger value="trending">近期热门</TabsTrigger>
            <TabsTrigger value="discover">分类筛选</TabsTrigger>
            <TabsTrigger value="search">搜索结果</TabsTrigger>
          </TabsList>
          <span className="subtle">
            {query.data?.total_results?.toLocaleString() || '—'} 部电影
          </span>
        </div>
        <TabsContent value={mode}>
          {mode === 'search' && (
            <form
              className="search mb-5"
              onSubmit={event => {
                event.preventDefault()
                if (input.trim()) setParams({ mode: 'search', q: input.trim() })
              }}
            >
              <div className="search-field">
                <Search size={16} />
                <Input
                  aria-label="搜索电影"
                  autoFocus
                  value={input}
                  onChange={event => setInput(event.target.value)}
                  placeholder="搜索片名 / 原名"
                />
              </div>
              <Button type="submit">搜索</Button>
            </form>
          )}
          {showFilters && mode !== 'search' && (
            <div className="filters" id="movie-filters">
              {mode === 'trending' ? (
                <CatalogFilter
                  id="trending-window"
                  label="榜单周期"
                  value={params.get('window') || 'week'}
                  onChange={value => change({ window: value })}
                  options={[
                    { value: 'week', label: '本周热门' },
                    { value: 'day', label: '今日热门' },
                  ]}
                />
              ) : (
                <>
                  <CatalogFilter
                    id="movie-genre"
                    label="类型"
                    value={params.get('with_genres') || ''}
                    onChange={value => change({ with_genres: value })}
                    options={[
                      { value: '', label: '全部类型' },
                      ...(genres.data?.genres || []).map(genre => ({
                        value: String(genre.id),
                        label: genre.name,
                      })),
                    ]}
                  />
                  <CatalogFilter
                    id="movie-sort"
                    label="排序"
                    value={params.get('sort_by') || 'popularity.desc'}
                    onChange={value => change({ sort_by: value })}
                    options={[
                      { value: 'popularity.desc', label: '热度优先' },
                      { value: 'vote_average.desc', label: '评分优先' },
                      { value: 'primary_release_date.desc', label: '上映时间' },
                    ]}
                  />
                  <CatalogFilter
                    id="movie-rating"
                    label="最低评分"
                    value={params.get('vote_average.gte') || ''}
                    onChange={value =>
                      change({
                        'vote_average.gte': value,
                        'vote_count.gte': value ? '100' : '',
                      })
                    }
                    options={[
                      { value: '', label: '不限' },
                      { value: '6', label: '6 分' },
                      { value: '7', label: '7 分' },
                      { value: '8', label: '8 分' },
                    ]}
                  />
                  <div className="filter-field">
                    <label htmlFor="movie-year">起始年份</label>
                    <Input
                      key={params.get('primary_release_date.gte') || 'year'}
                      id="movie-year"
                      type="number"
                      min="1900"
                      max="2100"
                      placeholder="不限"
                      defaultValue={
                        params.get('primary_release_date.gte')?.slice(0, 4) ||
                        ''
                      }
                      onChange={event => {
                        const year = event.target.value
                        if (!year || year.length === 4) {
                          change({
                            'primary_release_date.gte': year
                              ? `${year}-01-01`
                              : '',
                          })
                        }
                      }}
                    />
                  </div>
                  {genres.error && (
                    <p className="error" role="alert">
                      {genres.error.message}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {mode === 'search' && !params.get('q') ? (
            <div className="empty">
              <Search />
              <p>搜索你想看的电影</p>
            </div>
          ) : (
            <>
              {query.isPending ? (
                <MovieGridSkeleton />
              ) : (
                <Status query={query} />
              )}
              {query.data && <Grid movies={query.data.results} />}
            </>
          )}
          {query.data && (
            <div className="pagination">
              <Button
                variant="outline"
                size="icon"
                aria-label="上一页"
                disabled={page <= 1}
                onClick={() => changePage(page - 1)}
              >
                <ChevronLeft size={16} />
              </Button>
              <span>
                {page} / {Math.max(1, Math.min(query.data.total_pages, 500))}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="下一页"
                disabled={page >= Math.min(query.data.total_pages, 500)}
                onClick={() => changePage(page + 1)}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}
