import type { ShareFile } from '@movie/contracts'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  CloudDownload,
  File,
  FileImage,
  FileText,
  Film,
  Folder,
  Home,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Status } from '@/components/feedback/query-status'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatFileSize } from '@/domain/resources/file-size'
import { api } from '@/infrastructure/http/api'

type Resource = {
  id: string
  title: string
  shareId: string
  passcode?: string
}
type FolderEntry = { id: string; name: string }
function fileIcon(file: ShareFile) {
  if (file.directory) return Folder
  if (/\.(mkv|mp4|avi|mov|m4v|ts|webm)$/i.test(file.name)) return Film
  if (/\.(jpg|jpeg|png|webp)$/i.test(file.name)) return FileImage
  if (/\.(srt|ass|ssa|sub|vtt|nfo|txt)$/i.test(file.name)) return FileText
  return File
}
export function ShareFileBrowser({
  resource,
  title,
}: {
  resource: Resource
  title: string
}) {
  const navigate = useNavigate()
  const [trail, setTrail] = useState<FolderEntry[]>([
    { id: '0', name: '分享根目录' },
  ])
  const [selected, setSelected] = useState<string[]>([])
  const [sort, setSort] = useState<{
    key: 'name' | 'size'
    direction: 'asc' | 'desc'
  }>({ key: 'name', direction: 'asc' })
  const region = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<string | null>(null)
  const navigating = useRef(false)
  const current = trail[trail.length - 1]
  const files = useQuery({
    queryKey: ['files', resource.id, current.id],
    queryFn: () =>
      api<ShareFile[]>(
        `/resources/${resource.id}/files?folderId=${current.id}`
      ),
  })
  const transfer = useMutation({
    mutationFn: () =>
      api('/transfers', {
        method: 'POST',
        body: JSON.stringify({
          resourceId: resource.id,
          folderId: current.id,
          fileIds: selected,
        }),
      }),
    onSuccess: () => navigate('/tasks'),
  })
  useEffect(() => {
    if (!navigating.current || files.isPending) return
    const folder = Array.from(
      region.current?.querySelectorAll<HTMLButtonElement>('[data-folder-id]') ||
        []
    ).find(button => button.dataset.folderId === returnFocus.current)
    ;(folder || region.current)?.focus()
    navigating.current = false
  }, [current.id, files.isPending])
  function openFolder(file: ShareFile) {
    navigating.current = true
    returnFocus.current = null
    setTrail([...trail, { id: file.id, name: file.name }])
    setSelected([])
    transfer.reset()
  }
  function goTo(index: number) {
    if (index === trail.length - 1) return
    navigating.current = true
    returnFocus.current = trail[index + 1].id
    setTrail(trail.slice(0, index + 1))
    setSelected([])
    transfer.reset()
  }
  function changeSort(key: 'name' | 'size') {
    setSort({
      key,
      direction:
        sort.key === key
          ? sort.direction === 'asc'
            ? 'desc'
            : 'asc'
          : key === 'size'
            ? 'desc'
            : 'asc',
    })
  }
  const rows = [...(files.data || [])].sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1
    if (sort.key === 'size') {
      if (a.size == null || b.size == null)
        return a.size == null ? (b.size == null ? 0 : 1) : -1
      return (a.size - b.size) * (sort.direction === 'asc' ? 1 : -1)
    }
    return (
      a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) *
      (sort.direction === 'asc' ? 1 : -1)
    )
  })
  const selectedFiles = (files.data || []).filter(file =>
    selected.includes(file.id)
  )
  const knownSize = selectedFiles.reduce(
    (total, file) => total + (file.size || 0),
    0
  )
  const unknownSize = selectedFiles.some(file => file.size == null)
  const allSelected = rows.length > 0 && selected.length === rows.length
  const shareUrl = `https://pan.quark.cn/s/${resource.shareId}${resource.passcode ? `?pwd=${encodeURIComponent(resource.passcode)}` : ''}`
  return (
    <section className="share-explorer" aria-labelledby="share-files-title">
      <div className="explorer-heading">
        <div className="flex min-w-0 items-start gap-3">
          <div className="explorer-drive">
            <CloudDownload size={20} />
          </div>
          <div className="min-w-0">
            <h2 id="share-files-title">分享文件</h2>
            <p
              className="mt-1 truncate text-xs text-muted-foreground"
              title={title}
            >
              {title}
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={shareUrl} target="_blank" rel="noreferrer">
            打开网盘
            <ArrowUpRight size={14} />
          </a>
        </Button>
      </div>
      <div className="explorer-path">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="上级目录"
          disabled={trail.length === 1 || transfer.isPending}
          onClick={() => goTo(trail.length - 2)}
        >
          <ArrowLeft size={16} />
        </Button>
        <nav aria-label="网盘目录路径">
          <ol>
            {trail.map((folder, index) => (
              <li key={folder.id}>
                {index > 0 && <ChevronRight size={13} aria-hidden="true" />}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 max-w-48 gap-2 px-2 text-xs"
                  aria-current={index === trail.length - 1 ? 'page' : undefined}
                  disabled={transfer.isPending}
                  onClick={() => goTo(index)}
                >
                  {index === 0 && <Home size={14} />}
                  <span className="truncate">{folder.name}</span>
                </Button>
              </li>
            ))}
          </ol>
        </nav>
      </div>
      <div
        className="explorer-table-region"
        ref={region}
        tabIndex={-1}
        role="region"
        aria-label={`${current.name}中的文件`}
      >
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">
                <Checkbox
                  aria-label="全选当前目录"
                  checked={
                    allSelected
                      ? true
                      : selected.length
                        ? 'indeterminate'
                        : false
                  }
                  disabled={!rows.length || transfer.isPending}
                  onCheckedChange={checked =>
                    setSelected(
                      checked === true ? rows.map(file => file.id) : []
                    )
                  }
                />
              </TableHead>
              <TableHead
                aria-sort={
                  sort.key === 'name'
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-8 gap-1 px-2"
                  onClick={() => changeSort('name')}
                >
                  名称
                  {sort.key === 'name' &&
                    (sort.direction === 'asc' ? (
                      <ArrowUp size={13} />
                    ) : (
                      <ArrowDown size={13} />
                    ))}
                </Button>
              </TableHead>
              <TableHead
                className="w-24 text-right sm:w-32"
                aria-sort={
                  sort.key === 'size'
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="-mr-2 h-8 gap-1 px-2"
                  onClick={() => changeSort('size')}
                >
                  大小
                  {sort.key === 'size' &&
                    (sort.direction === 'asc' ? (
                      <ArrowUp size={13} />
                    ) : (
                      <ArrowDown size={13} />
                    ))}
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(file => {
              const Icon = fileIcon(file)
              return (
                <TableRow
                  key={file.id}
                  data-state={
                    selected.includes(file.id) ? 'selected' : undefined
                  }
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`选择 ${file.name}`}
                      checked={selected.includes(file.id)}
                      disabled={transfer.isPending}
                      onCheckedChange={checked =>
                        setSelected(
                          checked === true
                            ? [...selected, file.id]
                            : selected.filter(id => id !== file.id)
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="pl-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon
                        size={18}
                        className="shrink-0 text-muted-foreground"
                      />
                      {file.directory ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-auto min-h-9 min-w-0 flex-1 justify-start gap-2 whitespace-normal px-1 py-1 text-left font-normal"
                          aria-label={`打开 ${file.name}`}
                          data-folder-id={file.id}
                          disabled={transfer.isPending}
                          onClick={() => openFolder(file)}
                        >
                          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                            {file.name}
                          </span>
                          <ChevronRight size={14} />
                        </Button>
                      ) : (
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                          {file.name}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell
                    className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground"
                    title={
                      file.size != null
                        ? `${file.size.toLocaleString('zh-CN')} 字节`
                        : '大小未知'
                    }
                  >
                    {formatFileSize(file.size)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {(files.isPending || files.error) && <Status query={files} />}
        {!files.isPending && !files.error && !rows.length && (
          <div className="empty min-h-48">
            <Folder size={28} />
            <p>此目录为空</p>
          </div>
        )}
      </div>
      <div className="explorer-footer">
        <div
          className="min-w-0 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <p>
            {current.name} ·{' '}
            {files.isPending
              ? '正在读取…'
              : files.error
                ? '读取失败'
                : `${rows.length} 项`}
          </p>
          <p className="mt-1">
            {selected.length
              ? `已选 ${selected.length} 项 · ${formatFileSize(knownSize)}${unknownSize ? '，另有大小未知的项目' : ''}`
              : '勾选文件或整个文件夹，再转存到你的网盘'}
          </p>
        </div>
        <Button
          className="shrink-0 gap-2"
          disabled={!selected.length || transfer.isPending || !!files.error}
          onClick={() => transfer.mutate()}
        >
          {transfer.isPending ? (
            <Check size={16} />
          ) : (
            <CloudDownload size={16} />
          )}
          {transfer.isPending ? '提交中' : `转存选中项 (${selected.length})`}
        </Button>
      </div>
      {transfer.error && (
        <p className="error px-4 pb-4" role="alert">
          {transfer.error.message}
        </p>
      )}
    </section>
  )
}
