import { AlertCircle, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
export function Status({
  query,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown }
}) {
  if (query.isPending)
    return (
      <div className="status">
        <LoaderCircle className="spin" aria-label="加载中" />
      </div>
    )
  if (query.error)
    return (
      <div className="status error" role="alert">
        <AlertCircle />
        <p>{query.error.message}</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          <RefreshCw size={16} />
          重试
        </Button>
      </div>
    )
  return null
}
