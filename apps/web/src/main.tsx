import React from 'react';
import { BrowserRouter, NavLink, Routes, Route, Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Film, Compass, Library, ListChecks, Settings, Search, ChevronLeft, ChevronRight, ArrowLeft, Download, Check, Eye, Star, RefreshCw, Folder, CloudDownload, AlertCircle, ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { MovieSummary } from '@movie/contracts';
import { api } from './api';
import { StrmSettingsPanel } from './strm-settings';
import './style.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000 } } });
const image = (path: string | null | undefined, size = 'w500') => path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
const stages: Record<string, string> = { queued: '等待处理', searching: '搜索资源', awaiting_selection: '等待选择', empty: '未找到资源', validating: '校验资源', transferring: '转存中', organizing: '整理命名', generating_strm: '生成 STRM 映射', generating_metadata: '生成元数据', uploading_metadata: '上传 NFO 与海报', organizing_pending: '已转存，命名需核对', metadata_pending: '已转存，元数据待处理', completed: '已完成' };

function Status({ query }: { query: { isPending: boolean; error: Error | null; refetch: () => unknown } }) {
  if (query.isPending) return <div className="status"><LoaderCircle className="spin" aria-label="加载中" /></div>;
  if (query.error) return <div className="status error" role="alert"><AlertCircle /><p>{query.error.message}</p><button onClick={() => query.refetch()}><RefreshCw size={16} />重试</button></div>;
  return null;
}
export function MovieCard({ movie }: { movie: MovieSummary & { watchedAt?: string; downloaded?: boolean } }) {
  return <Link className="movie" to={`/movies/${movie.id}`}>
    <div className="poster">{movie.poster_path ? <img src={image(movie.poster_path, 'w342')} width="342" height="513" loading="lazy" alt={`${movie.title} 海报`} /> : <div className="missing"><Film size={32} /></div>}
      <span className="score"><Star size={11} fill="currentColor" />{movie.vote_average?.toFixed(1)}</span>
      {(movie.watchedAt || movie.downloaded) && <span className="movie-state">{movie.watchedAt ? <Eye size={15} /> : <CloudDownload size={15} />}</span>}
      <span className="poster-open"><ArrowUpRight size={22} /></span>
    </div><h3>{movie.title}</h3><p>{movie.release_date?.slice(0, 4) || '待定'}<span>{movie.original_title !== movie.title ? movie.original_title : '电影'}</span></p>
  </Link>;
}
function Grid({ movies }: { movies: MovieSummary[] }) { return movies.length ? <div className="poster-grid">{movies.map((movie) => <MovieCard key={movie.id} movie={movie} />)}</div> : <div className="empty"><Film /><p>还没有电影</p><Link to="/discover">浏览电影</Link></div>; }
function Discover() {
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') || 'trending';
  const page = Number(params.get('page') || 1);
  const [input, setInput] = React.useState(params.get('q') || '');
  const genres = useQuery({ queryKey: ['genres'], queryFn: () => api('/movies/genres') });
  const queryString = new URLSearchParams(params);
  queryString.delete('mode'); queryString.set('page', String(page));
  const endpoint = mode === 'search' ? 'search' : mode === 'discover' ? 'discover' : 'trending';
  const query = useQuery({ queryKey: ['discover', endpoint, queryString.toString()], queryFn: () => api(`/movies/${endpoint}?${queryString}`), enabled: mode !== 'search' || !!params.get('q') });
  const change = (updates: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); next.delete('page'); setParams(next); };
  return <>
    <div className="page-title"><div><p className="eyebrow">THE SCREENING ROOM</p><h1>发现电影<span className="title-dot">.</span></h1></div><form className="search" onSubmit={(event) => { event.preventDefault(); if (input.trim()) setParams({ mode: 'search', q: input.trim() }); }}><Search size={18} /><input aria-label="搜索电影" value={input} onChange={(e) => setInput(e.target.value)} placeholder="搜索片名 / 原名" /><button className="icon" type="submit" title="搜索"><ArrowUpRight size={18} /></button></form></div>
    <div className="catalog-toolbar"><div className="tabs" role="tablist" aria-label="电影来源">{[['trending', '近期热门'], ['discover', '分类筛选'], ['search', '搜索结果']].map(([value, label]) => <button key={value} role="tab" aria-selected={mode === value} onClick={() => setParams(value === 'search' && input ? { mode: value, q: input } : { mode: value })}>{label}</button>)}</div><span className="muted">{query.data?.total_results?.toLocaleString() || '—'} 部电影</span></div>
    <div className="filters">{mode === 'trending' ? <><label>榜单<select aria-label="榜单周期" value={params.get('window') || 'week'} onChange={(e) => change({ window: e.target.value })}><option value="week">本周热门</option><option value="day">今日热门</option></select></label><span className="subtle">TMDB Trending</span></> : mode === 'discover' ? <>
      <label>类型<select value={params.get('with_genres') || ''} onChange={(e) => change({ with_genres: e.target.value })}><option value="">全部类型</option>{genres.data?.genres?.map((genre: any) => <option key={genre.id} value={genre.id}>{genre.name}</option>)}</select></label>
      <label>排序<select value={params.get('sort_by') || 'popularity.desc'} onChange={(e) => change({ sort_by: e.target.value })}><option value="popularity.desc">热度优先</option><option value="vote_average.desc">评分优先</option><option value="primary_release_date.desc">上映时间</option></select></label>
      <label>最低评分<select value={params.get('vote_average.gte') || ''} onChange={(e) => change({ 'vote_average.gte': e.target.value, 'vote_count.gte': e.target.value ? '100' : '' })}><option value="">不限</option><option value="6">6 分</option><option value="7">7 分</option><option value="8">8 分</option></select></label>
      <label>起始年份<input type="number" aria-label="起始年份" min="1900" max="2100" placeholder="不限" value={params.get('primary_release_date.gte')?.slice(0, 4) || ''} onChange={(e) => change({ 'primary_release_date.gte': e.target.value.length === 4 ? `${e.target.value}-01-01` : '' })} /></label>
    </> : <span className="muted">{params.get('q') ? `“${params.get('q')}”` : '输入片名开始搜索'}</span>}</div>
    {mode === 'search' && !params.get('q') ? <div className="empty"><Search /><p>搜索你想看的电影</p></div> : <><Status query={query} />{query.data && <Grid movies={query.data.results} />}</>}
    {query.data && <div className="pagination"><button className="icon" title="上一页" disabled={page <= 1} onClick={() => { const p = new URLSearchParams(params); p.set('page', String(page - 1)); setParams(p); window.scrollTo(0, 0); }}><ChevronLeft /></button><span>{page} / {Math.max(1, Math.min(query.data.total_pages, 500))}</span><button className="icon" title="下一页" disabled={page >= Math.min(query.data.total_pages, 500)} onClick={() => { const p = new URLSearchParams(params); p.set('page', String(page + 1)); setParams(p); window.scrollTo(0, 0); }}><ChevronRight /></button></div>}
  </>;
}
function MovieDetail() {
  const { id } = useParams(); const navigate = useNavigate(); const qc = useQueryClient();
  const query = useQuery({ queryKey: ['movie', id], queryFn: () => api(`/movies/${id}`) });
  const library = useQuery({ queryKey: ['library'], queryFn: () => api('/library') });
  const entry = library.data?.results?.find((movie: any) => movie.id === Number(id));
  const watched = useMutation({ mutationFn: () => api(`/library/${id}`, { method: 'PATCH', body: JSON.stringify({ watched: !entry?.watchedAt }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }) });
  const search = useMutation({ mutationFn: () => api(`/movies/${id}/resource-searches`, { method: 'POST', body: '{}' }), onSuccess: (task) => navigate(`/movies/${id}/resources?searchId=${task.id}`) });
  const movie = query.data;
  if (!movie) return <Status query={query} />;
  return <><Link className="back" to="/discover"><ArrowLeft size={16} />电影发现</Link><div className="detail">
    <div className="detail-poster">{movie.poster_path ? <img src={image(movie.poster_path)} width="500" height="750" alt={movie.title} /> : <Film size={50} />}</div>
    <div className="detail-copy"><p className="eyebrow">{movie.release_date?.slice(0, 4)} · {movie.genres?.map((g: any) => g.name).join(' / ')}</p><h1>{movie.title}</h1><p className="original-title">{movie.original_title}</p><div className="facts"><span className="accent"><Star size={17} />{movie.vote_average?.toFixed(1)}</span><span>{movie.runtime} 分钟</span><span>{movie.release_date}</span></div><p className="synopsis">{movie.overview || '暂无简介'}</p>
      <div className="actions"><button className="primary" onClick={() => search.mutate()} disabled={search.isPending}><Search size={17} />{search.isPending ? '正在查找' : '查找资源'}</button><button onClick={() => watched.mutate()} disabled={watched.isPending} aria-pressed={!!entry?.watchedAt}>{entry?.watchedAt ? <Check size={17} /> : <Eye size={17} />}{entry?.watchedAt ? '已看过' : '标记看过'}</button><a className="button icon" title="下载 NFO" href={`/api/movies/${id}/nfo`}><Download size={18} /></a></div>
      {(search.error || watched.error) && <p className="error" role="alert">{search.error?.message || watched.error?.message}</p>}
      <dl><dt>导演</dt><dd>{movie.credits?.crew?.filter((p: any) => p.job === 'Director').map((p: any) => p.name).join(' / ') || '—'}</dd><dt>主演</dt><dd>{movie.credits?.cast?.slice(0, 6).map((p: any) => p.name).join(' / ') || '—'}</dd><dt>状态</dt><dd>{entry?.downloaded ? '已转存' : '未下载'}{entry?.watchedAt ? ' · 已看过' : ''}</dd></dl>
    </div></div>{movie.backdrop_path && <img className="backdrop" src={image(movie.backdrop_path, 'w1280')} alt={`${movie.title} 剧照`} width="1280" height="720" loading="lazy" />}</>;
}
function LibraryPage() {
  const [filter, setFilter] = React.useState('all');
  const query = useQuery({ queryKey: ['library', filter], queryFn: () => api(`/library?${filter === 'watched' ? 'watched=true' : filter === 'downloaded' ? 'downloaded=true' : ''}`) });
  return <><div className="page-title"><div><p className="eyebrow">YOUR COLLECTION</p><h1>我的片库<span className="title-dot">.</span></h1></div></div><div className="catalog-toolbar"><div className="tabs">{[['all', '全部电影'], ['watched', '看过的'], ['downloaded', '已下载']].map(([value, text]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{text}</button>)}</div></div><Status query={query} />{query.data && <Grid movies={query.data.results} />}</>;
}
function ResourcesPage() {
  const { id } = useParams(); const [params] = useSearchParams(); const searchId = params.get('searchId'); const navigate = useNavigate();
  const task = useQuery({ queryKey: ['task', searchId], queryFn: () => api(`/tasks/${searchId}`), enabled: !!searchId, refetchInterval: (query) => ['queued', 'running'].includes(query.state.data?.status) ? 2000 : false });
  const results = useQuery({ queryKey: ['resources', searchId], queryFn: () => api<any[]>(`/resources?searchId=${searchId}`), enabled: task.data?.status === 'completed' });
  const [resource, setResource] = React.useState<any>(null); const [folders, setFolders] = React.useState<string[]>(['0']); const [selected, setSelected] = React.useState<string[]>([]);
  const files = useQuery({ queryKey: ['files', resource?.id, folders.at(-1)], queryFn: () => api<any[]>(`/resources/${resource.id}/files?folderId=${folders.at(-1)}`), enabled: !!resource });
  const transfer = useMutation({ mutationFn: () => api('/transfers', { method: 'POST', body: JSON.stringify({ resourceId: resource.id, folderId: folders.at(-1), fileIds: selected }) }), onSuccess: () => navigate('/tasks') });
  return <><Link className="back" to={`/movies/${id}`}><ArrowLeft size={16} />电影详情</Link><div className="page-title"><div><p className="eyebrow">RESOURCE FINDER</p><h1>选择电影资源</h1></div></div>
    {task.isPending && <Status query={task} />}{task.data && ['queued', 'running'].includes(task.data.status) && <div className="status"><LoaderCircle className="spin" /><p>正在站内搜索并解析夸克链接</p></div>}
    {task.data?.error && <p className="error" role="alert">{task.data.error}</p>}
    {results.data?.length === 0 && <div className="empty"><Search /><p>未找到可直接获取的夸克资源</p><Link to={`/movies/${id}`}>返回电影详情</Link></div>}
    <div className="resources-layout"><div>{results.data?.map((item) => <div className={`resource-row ${item.id === resource?.id ? 'selected' : ''}`} key={item.id}><span className="provider">夸克</span><h3>{item.title}</h3><a href={item.postUrl} target="_blank" rel="noreferrer">来源帖子 <ArrowUpRight size={13} /></a><button onClick={() => { setResource(item); setFolders(['0']); setSelected([]); }}><Folder size={16} />浏览文件</button></div>)}</div>
    {resource && <section className="file-browser"><div className="file-header"><h2>分享文件</h2>{folders.length > 1 && <button className="icon" title="上级目录" onClick={() => { setFolders(folders.slice(0, -1)); setSelected([]); }}><ArrowLeft size={18} /></button>}</div><Status query={files} />{files.data?.map((file) => <div className="file-row" key={file.id}><input type="checkbox" aria-label={`选择 ${file.name}`} checked={selected.includes(file.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, file.id] : selected.filter((s) => s !== file.id))} /><span className="file-name">{file.directory ? <Folder size={17} /> : <Film size={17} />}{file.name}</span>{file.directory && <button className="icon" title={`打开 ${file.name}`} onClick={() => { setFolders([...folders, file.id]); setSelected([]); }}><ChevronRight size={18} /></button>}</div>)}<button className="primary transfer-button" disabled={!selected.length || transfer.isPending} onClick={() => transfer.mutate()}><CloudDownload size={17} />{transfer.isPending ? '提交中' : `转存选中项 (${selected.length})`}</button>{transfer.error && <p className="error">{transfer.error.message}</p>}</section>}</div>
  </>;
}
function TasksPage() {
  const qc = useQueryClient(); const query = useQuery({ queryKey: ['tasks'], queryFn: () => api<any[]>('/tasks'), refetchInterval: 3000 });
  const retry = useMutation({ mutationFn: (id: string) => api(`/tasks/${id}/retry`, { method: 'POST', body: '{}' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }) });
  return <><div className="page-title"><div><p className="eyebrow">ACTIVITY</p><h1>任务记录<span className="title-dot">.</span></h1></div><button className="icon" title="刷新任务" onClick={() => query.refetch()}><RefreshCw size={19} /></button></div><Status query={query} />{!query.data?.length && !query.isPending && <div className="empty"><ListChecks /><p>暂无搜索或转存任务</p><Link to="/discover">浏览电影</Link></div>}{query.data?.map((task) => <article className="task-row" key={task.id}><div className="task-icon">{task.kind === 'search' ? <Search /> : <CloudDownload />}</div><div className="task-copy"><Link to={`/movies/${task.movieId}`}>{task.kind === 'search' ? '资源搜索' : '夸克转存'} · TMDB {task.movieId}</Link><p>{stages[task.stage] || task.stage}</p>{task.error && <p className="error">{task.error}</p>}{task.result.strm && <p>STRM 映射 · {task.result.strm.count} 个文件</p>}{task.result.warnings?.map((warning: string) => <p key={warning} className="warning">{warning}</p>)}<time>{new Date(task.createdAt).toLocaleString('zh-CN')}</time></div><div className="task-actions">{task.kind === 'search' && task.stage === 'awaiting_selection' && <Link className="button" to={`/movies/${task.movieId}/resources?searchId=${task.id}`}>选择资源</Link>}{task.result.nfoUrl && <a className="button icon" href={task.result.nfoUrl} title="下载 NFO"><Download size={18} /></a>}{['failed', 'partial'].includes(task.status) && <button className="icon" title="重试任务" disabled={retry.isPending} onClick={() => retry.mutate(task.id)}><RefreshCw size={18} /></button>}<span className={`task-status ${task.status}`}>{task.status === 'running' ? '处理中' : task.status === 'completed' ? '完成' : task.status === 'failed' ? '失败' : task.status === 'partial' ? '待整理' : '排队中'}</span></div></article>)}{retry.error && <p className="error">{retry.error.message}</p>}</>;
}
function SettingsPage() {
  const query = useQuery({ queryKey: ['integrations'], queryFn: () => api('/integrations') });
  const check = useMutation({ mutationFn: () => api('/integrations/quark/check', { method: 'POST', body: '{}' }) });
  return <><div className="page-title"><div><p className="eyebrow">CONNECTIONS</p><h1>连接设置<span className="title-dot">.</span></h1></div></div><Status query={query} />{query.data && <div className="settings-list">{[['TMDB', query.data.tmdb, '电影数据与海报'], ['Suenen', query.data.suenen, '电影资源来源'], ['夸克网盘', query.data.quark, query.data.folderName]].map(([name, configured, text]) => <div className="setting-row" key={String(name)}><div><h2>{name}</h2><p>{text}</p></div><span className={configured ? 'connected' : 'error'}>{configured ? '已配置' : '未配置'}</span></div>)}<div className="setting-row"><div><h2>网盘连接</h2><p>{check.data ? `已连接 · 目录内 ${check.data.count} 项` : query.data.folderId ? '独立电影目录已创建' : '尚未设置电影目录'}</p></div><button disabled={check.isPending} onClick={() => check.mutate()}><RefreshCw size={16} />{check.isPending ? '校验中' : '校验连接'}</button></div><div className="setting-row"><div><h2>电影元数据</h2><p>NFO、海报与背景图</p></div><span className="connected">已接通</span></div>{check.error && <p className="error">{check.error.message}</p>}<StrmSettingsPanel /><p className="attribution">This product uses the TMDB API but is not endorsed or certified by TMDB.</p></div>}</>;
}
function App() { return <div className="app"><aside className="sidebar"><Link className="brand" to="/discover"><Film size={26} /><span>放映室<small>SCREENING ROOM</small></span></Link><div className="nav-label">电影管理</div><nav>{[[Compass, '/discover', '发现电影'], [Library, '/library', '我的片库'], [ListChecks, '/tasks', '任务记录'], [Settings, '/settings', '连接设置']].map(([Icon, path, text]) => { const I = Icon as typeof Film; return <NavLink key={String(path)} to={String(path)}><I size={19} /><span>{String(text)}</span></NavLink>; })}</nav><div className="sidebar-bottom"><span className="connection-dot" />个人电影片库<p>TMDB · Suenen · Quark</p></div></aside><main><Routes><Route path="/discover" element={<Discover />} /><Route path="/movies/:id" element={<MovieDetail />} /><Route path="/movies/:id/resources" element={<ResourcesPage />} /><Route path="/library" element={<LibraryPage />} /><Route path="/tasks" element={<TasksPage />} /><Route path="/settings" element={<SettingsPage />} /><Route path="*" element={<Discover />} /></Routes><footer>放映室 <span>电影数据来自 TMDB</span></footer></main></div>; }
export function Root() { return <React.StrictMode><QueryClientProvider client={client}><AuthGate><BrowserRouter><App /></BrowserRouter></AuthGate></QueryClientProvider></React.StrictMode>; }

function AuthGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['auth'], queryFn: () => api('/auth/status'), retry: false });
  const [password, setPassword] = React.useState('');
  const login = useMutation({ mutationFn: () => api('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }), onSuccess: () => { setPassword(''); qc.invalidateQueries({ queryKey: ['auth'] }); } });
  if (status.isPending || status.error) return <Status query={status} />;
  if (status.data?.authenticated) return <>{children}</>;
  return <div className="login-screen"><form className="login-form" onSubmit={(event) => { event.preventDefault(); login.mutate(); }}><Film size={30} /><h1>放映室</h1><label htmlFor="admin-password">管理密码</label><input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /><button className="primary" disabled={login.isPending}>{login.isPending ? '登录中' : '登录'}</button>{login.error && <p className="error" role="alert">{login.error.message}</p>}</form></div>;
}
