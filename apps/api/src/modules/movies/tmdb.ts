import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common'
export class TmdbService {
  private cache = new Map<string, { expires: number; value: any }>()
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async get(path: string, query: Record<string, string> = {}) {
    const apiKey = process.env.TMDB_API_KEY
    const token = process.env.TMDB_READ_ACCESS_TOKEN
    if (!apiKey && !token)
      throw new ServiceUnavailableException('TMDB_NOT_CONFIGURED')
    const url = new URL(`https://api.themoviedb.org/3/${path}`)
    url.search = new URLSearchParams({ language: 'zh-CN', ...query }).toString()
    if (apiKey && !token) url.searchParams.set('api_key', apiKey)
    const cacheKey = `${path}:${JSON.stringify(query)}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expires > Date.now()) return cached.value
    let response
    try {
      response = await this.fetchImpl(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      })
    } catch {
      throw new BadGatewayException('TMDB_UNAVAILABLE')
    }
    if (response.status === 429)
      throw new ServiceUnavailableException('TMDB_RATE_LIMITED')
    if (!response.ok)
      throw new BadGatewayException(`TMDB_HTTP_${response.status}`)
    const value = await response.json()
    if (this.cache.size >= 500)
      this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(cacheKey, {
      value,
      expires: Date.now() + (path.startsWith('movie/') ? 3600_000 : 600_000),
    })
    return value
  }
  trending(window = 'week', page = '1') {
    if (!['day', 'week'].includes(window))
      throw new BadRequestException('INVALID_WINDOW')
    return this.get(`trending/movie/${window}`, { page: validPage(page) })
  }
  search(q: string, page = '1', year?: string) {
    if (!q?.trim() || q.length > 100)
      throw new BadRequestException('INVALID_QUERY')
    if (year && !/^\d{4}$/.test(year))
      throw new BadRequestException('INVALID_YEAR')
    return this.get('search/movie', {
      query: q,
      page: validPage(page),
      include_adult: 'false',
      ...(year ? { year } : {}),
    })
  }
  discover(query: Record<string, string>) {
    const allowed = [
      'with_genres',
      'primary_release_date.gte',
      'primary_release_date.lte',
      'with_original_language',
      'vote_average.gte',
      'vote_count.gte',
      'sort_by',
    ]
    const params: Record<string, string> = {
      page: validPage(query.page || '1'),
      include_adult: 'false',
    }
    for (const key of allowed) if (query[key]) params[key] = query[key]
    if (
      params.sort_by &&
      ![
        'popularity.desc',
        'vote_average.desc',
        'primary_release_date.desc',
      ].includes(params.sort_by)
    )
      throw new BadRequestException('INVALID_SORT')
    if (params.with_genres && !/^\d+(,\d+)*$/.test(params.with_genres))
      throw new BadRequestException('INVALID_GENRE')
    for (const field of ['vote_average.gte', 'vote_count.gte'])
      if (params[field] && !/^\d+(\.\d+)?$/.test(params[field]))
        throw new BadRequestException('INVALID_FILTER')
    for (const field of [
      'primary_release_date.gte',
      'primary_release_date.lte',
    ])
      if (params[field] && !/^\d{4}-\d{2}-\d{2}$/.test(params[field]))
        throw new BadRequestException('INVALID_DATE')
    return this.get('discover/movie', params)
  }
  detail(id: number) {
    return this.get(`movie/${id}`, {
      append_to_response:
        'credits,external_ids,release_dates,alternative_titles',
    })
  }
}
function validPage(page: string) {
  if (!/^\d+$/.test(page) || Number(page) < 1 || Number(page) > 500)
    throw new BadRequestException('INVALID_PAGE')
  return page
}
