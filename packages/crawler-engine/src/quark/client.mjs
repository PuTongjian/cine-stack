// Adapted from CloudSaver's MIT QuarkService; see docs/licenses/CloudSaver-MIT.txt.
import { createHash } from 'node:crypto'
export class QuarkClient {
  constructor({ cookie, fetchImpl = fetch }) {
    if (!cookie) throw new Error('QUARK_NOT_CONFIGURED')
    this.cookie = cookie
    this.fetch = fetchImpl
  }

  async request(path, { method = 'GET', query = {}, body } = {}) {
    const url = new URL(`/1/clouddrive/${path}`, 'https://drive-h.quark.cn')
    url.search = new URLSearchParams({
      pr: 'ucpro',
      fr: 'pc',
      uc_param_str: '',
      ...query,
    })
    const response = await this.fetch(url, {
      method,
      headers: {
        Cookie: this.cookie,
        Referer: 'https://pan.quark.cn/',
        Origin: 'https://pan.quark.cn',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`QUARK_HTTP_${response.status}`)
    const result = await response.json()
    if (
      result.status !== 200 ||
      (result.code !== undefined && result.code !== 0)
    ) {
      // Do not include upstream errors that may contain session or share tokens.
      throw new Error(`QUARK_API_${result.code ?? result.status}`)
    }
    for (const cookie of response.headers.getSetCookie?.() || []) {
      const pair = cookie.split(';', 1)[0]
      const name = pair.slice(0, pair.indexOf('='))
      const entries = this.cookie
        .split(';')
        .map(x => x.trim())
        .filter(x => !x.startsWith(`${name}=`))
      this.cookie = [...entries, pair].join('; ')
    }
    return result
  }

  async listFiles(folderId = '0') {
    const all = []
    for (let page = 1; page <= 100; page++) {
      const result = await this.request('file/sort', {
        query: {
          pdir_fid: folderId,
          _page: String(page),
          _size: '100',
          _fetch_total: '1',
          _sort: 'file_type:asc,file_name:asc',
        },
      })
      const list = result.data?.list
      if (!Array.isArray(list)) throw new Error('QUARK_INVALID_FILE_LIST')
      all.push(...list)
      if (
        list.length < 100 ||
        (result.metadata?._total !== undefined &&
          all.length >= result.metadata._total)
      )
        return all
    }
    throw new Error('QUARK_FILE_LIST_LIMIT')
  }

  async ensureFolder(parentId, name) {
    const existing = (await this.listFiles(parentId)).find(
      file => file.file_name === name
    )
    if (existing) {
      if (!existing.dir && existing.file_type !== 0)
        throw new Error('QUARK_FOLDER_NAME_CONFLICT')
      return { id: existing.fid, name, created: false }
    }
    const result = await this.request('file', {
      method: 'POST',
      body: {
        pdir_fid: parentId,
        file_name: name,
        dir_path: '',
        dir_init_lock: false,
      },
    })
    if (!result.data?.fid) throw new Error('QUARK_CREATE_FOLDER_FAILED')
    return { id: result.data.fid, name, created: true }
  }

  async inspectShare(shareId, passcode = '', folderId = '0') {
    const token = await this.request('share/sharepage/token', {
      method: 'POST',
      body: { pwd_id: shareId, passcode },
    })
    if (!token.data?.stoken) throw new Error('QUARK_SHARE_UNAVAILABLE')
    const files = []
    for (let page = 1; page <= 100; page++) {
      const result = await this.request('share/sharepage/detail', {
        query: {
          pwd_id: shareId,
          stoken: token.data.stoken,
          pdir_fid: folderId,
          force: '0',
          _page: String(page),
          _size: '100',
          _fetch_share: '1',
          _fetch_total: '1',
          _sort: 'file_type:asc,file_name:asc',
        },
      })
      if (!Array.isArray(result.data?.list))
        throw new Error('QUARK_INVALID_SHARE_LIST')
      files.push(...result.data.list)
      if (
        result.data.list.length < 100 ||
        (result.metadata?._total !== undefined &&
          files.length >= result.metadata._total)
      ) {
        return { shareId, folderId, stoken: token.data.stoken, files }
      }
    }
    throw new Error('QUARK_SHARE_LIST_LIMIT')
  }

  async transfer({ shareId, stoken, folderId = '0', files, targetFolderId }) {
    const result = await this.request('share/sharepage/save', {
      method: 'POST',
      body: {
        fid_list: files.map(file => file.fid),
        fid_token_list: files.map(file => file.share_fid_token),
        to_pdir_fid: targetFolderId,
        pwd_id: shareId,
        stoken,
        pdir_fid: folderId,
        scene: 'link',
      },
    })
    if (!result.data?.task_id) throw new Error('QUARK_TRANSFER_UNCONFIRMED')
    return result.data.task_id
  }

  async waitTask(taskId) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await this.request('task', {
        query: { task_id: taskId, retry_index: String(attempt) },
      })
      if (result.data?.status === 2) return result.data
      if (result.data?.status === 3) throw new Error('QUARK_TRANSFER_FAILED')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error('QUARK_TRANSFER_PENDING')
  }

  async rename(fileId, name) {
    await this.request('file/rename', {
      method: 'POST',
      body: { fid: fileId, file_name: name },
    })
  }

  async move(fileIds, targetFolderId) {
    if (!fileIds.length) return
    const result = await this.request('file/move', {
      method: 'POST',
      body: {
        action_type: 1,
        to_pdir_fid: targetFolderId,
        filelist: fileIds,
        exclude_fids: [],
      },
    })
    if (result.data?.task_id) await this.waitTask(result.data.task_id)
  }

  /** Quark keeps deleted files in its recycle bin. */
  async delete(fileIds) {
    if (!fileIds.length) return
    const result = await this.request('file/delete', {
      method: 'POST',
      body: { action_type: 2, filelist: fileIds, exclude_fids: [] },
    })
    if (result.data?.task_id) await this.waitTask(result.data.task_id)
  }

  async downloadUrl(fileId) {
    if (!/^[a-zA-Z0-9]+$/.test(fileId)) throw new Error('QUARK_INVALID_FILE_ID')
    const result = await this.request('file/download', {
      method: 'POST',
      body: { fids: [fileId] },
    })
    const url = result.data?.[0]?.download_url
    if (typeof url !== 'string') throw new Error('QUARK_DOWNLOAD_UNAVAILABLE')
    return url
  }

  async uploadSmallFile(
    folderId,
    name,
    content,
    contentType = 'application/xml'
  ) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
    if (!bytes.length || bytes.length > 4 * 1024 * 1024)
      throw new Error('QUARK_METADATA_SIZE_LIMIT')
    const existing = (await this.listFiles(folderId)).find(
      file => file.file_name === name
    )
    if (existing) return { id: existing.fid, existing: true }
    const pre = await this.request('file/upload/pre', {
      method: 'POST',
      body: {
        ccp_hash_update: true,
        dir_name: '',
        file_name: name,
        format_type: contentType,
        l_created_at: Date.now(),
        l_updated_at: Date.now(),
        pdir_fid: folderId,
        size: bytes.length,
      },
    })
    const data = pre.data
    if (!data?.task_id || !data.upload_id || !data.obj_key || !data.bucket)
      throw new Error('QUARK_UPLOAD_PRE_FAILED')
    const hashes = await this.request('file/update/hash', {
      method: 'POST',
      body: {
        md5: createHash('md5').update(bytes).digest('hex'),
        sha1: createHash('sha1').update(bytes).digest('hex'),
        task_id: data.task_id,
      },
    })
    if (!hashes.data?.finish) {
      const host = new URL(data.upload_url).hostname
      if (host !== 'pds.quark.cn' || !/^[a-zA-Z0-9-]+$/.test(data.bucket))
        throw new Error('QUARK_UPLOAD_HOST_INVALID')
      const objectUrl = new URL(
        `https://${data.bucket}.${host}/${data.obj_key}`
      )
      const agent =
        'aliyun-sdk-js/6.6.1 Chrome 98.0.4758.80 on Windows 10 64-bit'
      const sendObject = async (method, query, body, type, extra = {}) => {
        const date = new Date().toUTCString()
        const headers = {
          ...extra,
          'x-oss-date': date,
          'x-oss-user-agent': agent,
        }
        const canonicalHeaders = Object.keys(headers)
          .filter(key => key.startsWith('x-oss-'))
          .sort()
          .map(key => `${key}:${headers[key]}\n`)
          .join('')
        const resource = `/${data.bucket}/${data.obj_key}?${Object.keys(query)
          .sort()
          .map(key => `${key}=${query[key]}`)
          .join('&')}`
        const auth = await this.request('file/upload/auth', {
          method: 'POST',
          body: {
            task_id: data.task_id,
            auth_info: data.auth_info,
            auth_meta: `${method}\n${headers['Content-MD5'] || ''}\n${type}\n${date}\n${canonicalHeaders}${resource}`,
          },
        })
        if (!auth.data?.auth_key) throw new Error('QUARK_UPLOAD_AUTH_FAILED')
        const url = new URL(objectUrl)
        url.search = new URLSearchParams(query)
        const response = await this.fetch(url, {
          method,
          headers: {
            ...headers,
            Authorization: auth.data.auth_key,
            'Content-Type': type,
            Referer: 'https://pan.quark.cn/',
          },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(60_000),
        })
        if (!response.ok)
          throw new Error(`QUARK_OBJECT_HTTP_${response.status}`)
        return response
      }
      const part = await sendObject(
        'PUT',
        { partNumber: '1', uploadId: data.upload_id },
        bytes,
        contentType
      )
      const etag = part.headers.get('etag')
      await part.arrayBuffer()
      if (!etag || !/^"?[0-9a-fA-F]+"?$/.test(etag))
        throw new Error('QUARK_UPLOAD_ETAG_INVALID')
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>${etag.replaceAll('"', '&quot;')}</ETag></Part></CompleteMultipartUpload>`
      const callback = Buffer.from(JSON.stringify(data.callback)).toString(
        'base64'
      )
      const commit = await sendObject(
        'POST',
        { uploadId: data.upload_id },
        xml,
        'application/xml',
        {
          'Content-MD5': createHash('md5').update(xml).digest('base64'),
          'x-oss-callback': callback,
        }
      )
      await commit.arrayBuffer()
      await this.request('file/upload/finish', {
        method: 'POST',
        body: { obj_key: data.obj_key, task_id: data.task_id },
      })
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      const uploaded = (await this.listFiles(folderId)).find(
        file => file.file_name === name
      )
      if (uploaded) return { id: uploaded.fid, existing: false }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('QUARK_UPLOAD_UNCONFIRMED')
  }
}
