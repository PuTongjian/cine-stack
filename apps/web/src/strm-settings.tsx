import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Folder, ChevronLeft } from 'lucide-react';
import type { StrmSettings } from '@movie/contracts';
import { api } from './api';

export function StrmSettingsPanel() {
  const query = useQuery({ queryKey: ['strm-settings'], queryFn: () => api<StrmSettings>('/strm/settings') });
  if (query.isPending) return <p className="muted">正在加载 STRM 配置…</p>;
  if (query.error) return <p className="error" role="alert">{query.error.message}<button onClick={() => query.refetch()}>重试</button></p>;
  return <StrmForm initial={query.data} />;
}

function StrmForm({ initial }: { initial: StrmSettings }) {
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [browsing, setBrowsing] = useState(false);
  const [trail, setTrail] = useState([{ id: '0', name: '网盘根目录' }]);
  const current = trail[trail.length - 1];
  const folders = useQuery({ queryKey: ['strm-folders', current.id], queryFn: () => api<{ id: string; name: string }[]>(`/strm/folders?folderId=${current.id}`), enabled: browsing });
  const save = useMutation({ mutationFn: () => api<StrmSettings>('/strm/settings', { method: 'PUT', body: JSON.stringify(settings) }), onSuccess: (value) => { setSettings(value); setSaved(value); sync.reset(); } });
  const sync = useMutation({ mutationFn: () => api<{ count: number; metadataCount: number; warnings: string[] }>('/strm/sync', { method: 'POST', body: '{}' }) });
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const busy = save.isPending || sync.isPending;
  return <section className="strm-settings" aria-labelledby="strm-title">
    <div className="setting-row"><div><h2 id="strm-title">Jellyfin · STRM 映射</h2><p>保留云盘目录结构，将视频映射为可播放的 STRM 文件。开启后，转存完成会自动同步。</p></div></div>
    <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <fieldset disabled={busy}>
        <label className="strm-toggle"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />启用 STRM 映射</label>
        <label htmlFor="strm-source">云盘源目录</label>
        <div className="strm-directory"><input id="strm-source" value={settings.sourceFolderId} readOnly /><button type="button" onClick={() => setBrowsing(!browsing)}><Folder size={16} />{browsing ? '收起目录' : '选择目录'}</button></div>
        {browsing && <div className="strm-browser">
          <div className="file-header"><span>{trail.map((folder) => folder.name).join(' / ')}</span><button type="button" disabled={trail.length === 1} onClick={() => setTrail(trail.slice(0, -1))}><ChevronLeft size={16} />上一级</button></div>
          {folders.isPending && <p className="muted">正在读取目录…</p>}
          {folders.error && <p className="error" role="alert">{folders.error.message}<button type="button" onClick={() => folders.refetch()}>重试</button></p>}
          {folders.data?.map((folder) => <button className="strm-folder" type="button" key={folder.id} onClick={() => setTrail([...trail, folder])}><Folder size={16} />{folder.name}</button>)}
          {!folders.isPending && !folders.error && !folders.data?.length && <p className="muted">此目录没有子目录</p>}
          <button type="button" disabled={!folders.data} onClick={() => { setSettings({ ...settings, sourceFolderId: current.id }); setBrowsing(false); }}>映射此目录</button>
        </div>}
        <label htmlFor="strm-output">本地输出目录</label>
        <input id="strm-output" value={settings.outputDir} placeholder="/app/strm" required onChange={(event) => setSettings({ ...settings, outputDir: event.target.value })} />
        <p className="muted">填写服务器的绝对路径。Docker 部署选择 /app/strm，并将对应宿主机目录挂载给 Jellyfin。</p>
        <label htmlFor="strm-url">Jellyfin 可访问的影栈地址</label>
        <input id="strm-url" type="url" value={settings.baseUrl} placeholder="http://192.168.1.10:8080" required={settings.enabled} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} />
        <p className="muted">Jellyfin 在容器中运行时，请使用服务器 IP 或容器可访问的域名。</p>
        <div className="actions"><button type="submit" className="primary">{save.isPending ? '保存中…' : '保存映射配置'}</button><button type="button" disabled={dirty || !saved.enabled} onClick={() => sync.mutate()}>{sync.isPending ? '同步中…' : '立即同步已有资源'}</button></div>
      </fieldset>
    </form>
    {dirty && <p className="muted">保存配置后即可同步；修改播放地址后请重新同步已有 STRM。</p>}
    {save.isSuccess && !dirty && <p className="connected" role="status">映射配置已保存</p>}
    {(save.error || sync.error) && <p className="error" role="alert">{(save.error || sync.error)?.message}</p>}
    {sync.data && <div role="status"><p className="connected">同步完成 · {sync.data.count} 个 STRM · {sync.data.metadataCount} 个元数据或字幕文件</p>{sync.data.warnings.map((warning, index) => <p className="warning" key={index}>{warning}</p>)}</div>}
  </section>;
}
