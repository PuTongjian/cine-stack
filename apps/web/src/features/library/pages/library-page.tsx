import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Status } from '@/components/feedback/query-status'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Grid,
  MovieGridSkeleton,
} from '@/features/movies/components/movie-grid'
import { api } from '@/infrastructure/http/api'

export function LibraryPage() {
  const [filter, setFilter] = useState('all')
  const query = useQuery({
    queryKey: ['library', filter],
    staleTime: 0,
    refetchInterval: 15_000,
    queryFn: () =>
      api(
        `/library?${filter === 'watched' ? 'watched=true' : filter === 'downloaded' ? 'downloaded=true' : ''}`
      ),
  })
  return (
    <>
      <div className="page-title">
        <div>
          <h1>我的片库</h1>
          <p className="page-description">
            收藏每一部好电影，记录你的观影旅程。
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          title="刷新片库状态"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          <RefreshCw size={19} />
        </Button>
      </div>
      <Tabs value={filter} onValueChange={setFilter}>
        <div className="catalog-toolbar">
          <TabsList aria-label="片库分类">
            <TabsTrigger value="all">全部电影</TabsTrigger>
            <TabsTrigger value="watched">看过的</TabsTrigger>
            <TabsTrigger value="downloaded">已下载</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value={filter}>
          {query.isPending ? <MovieGridSkeleton /> : <Status query={query} />}
          {query.data && <Grid movies={query.data.results} />}
        </TabsContent>
      </Tabs>
    </>
  )
}
