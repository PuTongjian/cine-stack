const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: index === 0 ? 0 : 2 }).format(bytes / 1024 ** index)} ${units[index]}`
}
