import { Context, Schema, h } from 'koishi'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { createHash } from 'crypto'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

declare module 'koishi' {
  interface Context {
    chatluna: {
      platform: {
        registerTool(name: string, options: {
          description: string
          selector: () => boolean
          createTool: () => any
          meta: {
            source: string
            group: string
            tags: string[]
            defaultAvailability: {
              enabled: boolean
              main: boolean
              chatluna: boolean
              characterScope: string
            }
          }
        }): () => void
      }
      createChatModel(target: string): Promise<any>
    }
  }
}

export const inject = {
  required: ['http'],
  optional: ['chatluna'],
}

export const usage = `
<h2>多图源漫画搜索与下载插件</h2>
<p>使用前请先部署 <a href="https://github.com/lumia1998/comic-api">comic-api</a> 后端服务（v2.x）</p>
<p>图源由后端插件化提供（内置禁漫天堂/哔咔漫画/拷贝漫画），本插件自动发现全部可用图源。</p>
<h3>命令列表</h3>
<ul>
  <li><code>comic [关键词]</code> - 聚合搜索/直接下载漫画</li>
  <li><code>comic search &lt;关键词/ID&gt;</code> - 聚合搜索漫画，各图源最多8条，合并转发并标注来源</li>
  <li><code>comic download &lt;ID|图源:ID&gt; [章节ID]</code> - 下载漫画PDF（后台任务，带进度提示）</li>
  <li><code>comic detail &lt;关键词/ID&gt;</code> - 查看漫画详情，关键词模式下各图源各展示最相似结果</li>
  <li><code>comic leaderboard [类型] [页码]</code> - 排行榜(类型: day/week/month/total，默认day)，按图源分条发送</li>
  <li><code>comic latest [-n 数量]</code> - 最近更新，每图源默认10条(最多50)，按图源分条发送</li>
  <li><code>comic random [-n 数量]</code> - 随机推荐，每图源默认5个(最多20)，按图源分条发送</li>
  <li><code>comic category [分类名] [页码]</code> - 按分类浏览；不带参数列出各图源可用分类</li>
  <li><code>comic sources</code> - 查看后端当前图源列表、能力与登录状态</li>
</ul>
<p>指定图源的写法：<code>图源名:ID</code> 或 <code>图源名|ID</code>（如 <code>jm:12345</code>、<code>哔咔|xxx</code>）。纯数字 ID 默认按禁漫处理，24位十六进制 ID 默认按哔咔处理。</p>
`

export interface ToolConfig {
  enabled: boolean
  name: string
  description: string
}

export interface Config {
  apiBase: string
  logInfo: boolean
  downloadTimeout: number
  pdfSendMethod: 'buffer' | 'file'
  fileSendPath: string
  comicSourcesTool: ToolConfig
  comicSearchTool: ToolConfig
  comicDetailTool: ToolConfig
  comicLeaderboardTool: ToolConfig
  comicLatestTool: ToolConfig
  comicRandomTool: ToolConfig
  comicDownloadTool: ToolConfig
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    apiBase: Schema.string()
      .description('comic-api 后端地址')
      .default('http://127.0.0.1:8699'),
    logInfo: Schema.boolean()
      .description('打印 API 调用日志')
      .default(false),
    downloadTimeout: Schema.number()
      .min(60).max(3600)
      .description('单个下载任务的最长等待时间（秒）。comic-api v2 使用后台任务队列，超时后可到 WebUI 任务列表继续等待或重试。')
      .default(600),
    pdfSendMethod: Schema.union(['buffer', 'file'] as const)
      .description('PDF 发送方式。如果 Koishi 与 Bot 客户端不在同一设备/容器，请选择 buffer；若选择 file 模式，文件将保存到指定目录中转。')
      .default('buffer'),
    fileSendPath: Schema.string()
      .description('PDF 发送方式为 file 时的本地中转保存目录')
      .default('/koishi/temp'),
  }),
  Schema.object({
    comicSourcesTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_sources 工具'),
      name: Schema.string().default('comic_sources').description('工具名称'),
      description: Schema.string()
        .default('查看 comic-api 后端当前可用的漫画图源列表（id、名称、能力、分类、榜单类型、登录状态）。当需要确认图源 ID、判断某个功能是否可用、或排查搜索无结果时先调用此工具。')
        .description('工具描述'),
    }).description('comic_sources 工具'),
  }),
  Schema.object({
    comicSearchTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_search 工具'),
      name: Schema.string().default('comic_search').description('工具名称'),
      description: Schema.string()
        .default('搜索漫画。聚合 comic-api 后端全部图源（如禁漫天堂/哔咔漫画/拷贝漫画，可用 comic_sources 查看）。返回匹配的漫画列表(含 source、ID、标题、作者)。搜索到结果后，立即调用 comic_download 下载第一个匹配项；下载完成后最终回复必须包含工具返回的解密密码。一条消息列出所有结果名+已下载标题+密码。如果搜索无结果，尝试用更简短的关键词重试，或告知用户未找到。')
        .description('工具描述'),
    }).description('comic_search 工具'),
  }),
  Schema.object({
    comicDetailTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_detail 工具'),
      name: Schema.string().default('comic_detail').description('工具名称'),
      description: Schema.string()
        .default('查看漫画详情(标题、作者、简介、章节列表)。仅在用户明确要求查看详情时使用。source 为图源 ID（可用 comic_sources 查询，不填则自动识别）。')
        .description('工具描述'),
    }).description('comic_detail 工具'),
  }),
  Schema.object({
    comicLeaderboardTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_leaderboard 工具'),
      name: Schema.string().default('comic_leaderboard').description('工具名称'),
      description: Schema.string()
        .default('查看漫画排行榜(日榜/周榜/月榜/总榜)。source 为图源 ID（可用 comic_sources 查询），不填则聚合全部支持排行榜的图源。')
        .description('工具描述'),
    }).description('comic_leaderboard 工具'),
  }),
  Schema.object({
    comicLatestTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_latest 工具'),
      name: Schema.string().default('comic_latest').description('工具名称'),
      description: Schema.string()
        .default('查看最近更新的漫画。source 为图源 ID（可用 comic_sources 查询），不填则聚合全部支持该功能的图源。')
        .description('工具描述'),
    }).description('comic_latest 工具'),
  }),
  Schema.object({
    comicRandomTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_random 工具'),
      name: Schema.string().default('comic_random').description('工具名称'),
      description: Schema.string()
        .default('随机推荐漫画。source 为图源 ID（可用 comic_sources 查询），不填则聚合全部支持随机推荐的图源。')
        .description('工具描述'),
    }).description('comic_random 工具'),
  }),
  Schema.object({
    comicDownloadTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_download 工具'),
      name: Schema.string().default('comic_download').description('工具名称'),
      description: Schema.string()
        .default('下载漫画/本子为加密PDF并发送给用户。调用后会自动发送PDF文件，并额外发送一条「解密密码」消息（系统已发出，无需你再编造密码）。工具返回的 JSON 含 success/title/password，你必须原样引用 password 字段。最终回复必须包含密码，格式示例：「搜索到 N 个结果：《title1》《title2》...，已下载《title1》，解密密码：123456。如需其他本子请发送本子名」。禁止省略密码；禁止说「文件已发送」却不报密码。用户说"想看xx""来个本子""下载xx"时，先 comic_search，再用第一个匹配项的 source 和 ID 调用本工具。不要分多条消息叙述中间步骤。')
        .description('工具描述'),
    }).description('comic_download 工具'),
  }),
])

// ============ Zod Schemas ============

const comicSourcesSchema = z.object({})

const comicSearchSchema = z.object({
  keyword: z.string().describe('搜索关键词，可以是漫画名、角色名、画师/作者名等'),
  source: z.string().optional()
    .describe('限定图源 ID（如 jm/bika/copy，可用 comic_sources 查询）。不填则聚合全部图源'),
})

const comicDetailSchema = z.object({
  comic_id: z.string().describe('漫画ID'),
  source: z.string().optional()
    .describe('图源 ID（如 jm/bika/copy）。不填则自动识别：纯数字按 jm、24位hex按 bika'),
})

const comicLeaderboardSchema = z.object({
  mode: z.enum(['day', 'week', 'month', 'total']).optional()
    .describe('排行榜类型：day=日榜(默认), week=周榜, month=月榜, total=总榜。部分图源不支持 total，会自动回退日榜'),
  source: z.string().optional()
    .describe('图源 ID。不填则聚合全部支持排行榜的图源'),
  page: z.number().int().min(1).optional()
    .describe('页码，默认1'),
})

const comicLatestSchema = z.object({
  source: z.string().optional()
    .describe('图源 ID。不填则聚合全部支持最近更新的图源'),
})

const comicRandomSchema = z.object({
  source: z.string().optional()
    .describe('图源 ID。不填则聚合全部支持随机推荐的图源'),
})

const comicDownloadSchema = z.object({
  comic_id: z.string().describe('漫画ID（从comic_search返回结果中获取）'),
  chapter_id: z.string().optional()
    .describe('章节ID，不填默认下载第一话'),
  source: z.string().optional()
    .describe('图源 ID（如 jm/bika/copy）。不填则自动识别，建议从 comic_search 结果的 source 字段直接传入'),
})

// ============ 辅助函数 ============

// 与后端 pdf_password_for 保持一致，仅在任务信息缺失密码时兜底使用
function getPdfPassword(source: string, comicId: string, chapterId: string): string {
  const src = source.trim().toLowerCase()
  const seed = `${src}:${comicId}:${chapterId}`
  const hash = createHash('sha256').update(seed).digest('hex')
  const value = parseInt(hash.slice(0, 12), 16) % 1000000
  return value.toString().padStart(6, '0')
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'comic'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 源别名：id / 名称 / 常见别名，大小写不敏感
const EXTRA_ALIASES: Record<string, string[]> = {
  jm: ['jm', 'jmcomic', '禁漫', '禁漫天堂', '18comic'],
  bika: ['bika', 'picacg', 'pica', '哔咔', '哔咔漫画', 'picacomic'],
  copy: ['copy', 'copymanga', '拷贝', '拷贝漫画'],
}

const STAGE_LABELS: Record<string, string> = {
  queued: '排队中',
  fetching: '获取章节信息',
  downloading: '下载图片',
  packaging: '打包PDF',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
}

interface SourceManifest {
  id: string
  name: string
  capabilities: string[]
  login_fields?: { name: string; label: string; type: string }[]
  categories?: { value: string; label: string }[]
  sorts?: { value: string; label: string }[]
  leaderboard_modes?: { value: string; label: string }[]
  account?: { authenticated: boolean; configured: boolean }
}

interface ComicItem {
  id: string
  title: string
  author?: string
  source?: string
  cover?: string
}

interface SearchResult {
  keyword?: string
  best_match?: ComicItem | null
  items?: ComicItem[]
  all_results?: Record<string, ComicItem[]>
  errors?: Record<string, { code?: string; message?: string; source?: string }>
}

interface ComicDetail {
  title: string
  author?: string
  description?: string
  cover?: string
  source?: string
  chapters: { id: string; name: string }[]
}

interface BrowseResponse {
  success?: boolean
  source?: string
  data?: ComicItem[]
  error?: { code?: string; message?: string } | string
}

interface DownloadTask {
  id: string
  source: string
  comic_id: string
  chapter_id: string
  title: string
  chapter: string
  status: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'failed' | 'completed'
  stage: string
  completed: number
  total: number
  error?: string
  password?: string
}

interface DownloadResult {
  success: boolean
  title: string
  password: string
  chapterName: string
  totalChapters: number
  chapters: { id: string; name: string }[]
  source?: string
  comicId?: string
  error?: string
}

function failResult(error: string): DownloadResult {
  return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error }
}

// ============ 主逻辑 ============

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('comic')
  const base = () => config.apiBase.replace(/\/+$/, '')

  // ---------- 图源清单缓存 ----------
  let manifestCache: { at: number; list: SourceManifest[] } = { at: 0, list: [] }

  function normalizeErrorBody(body: any, fallback: string): string {
    if (!body) return fallback
    if (typeof body === 'string') return body
    const err = body.error
    // 新格式 {error:{code,message,source}}；兼容旧格式 {success:false,error:'...'}
    if (err && typeof err === 'object') return err.message || fallback
    if (typeof err === 'string') return err
    return body.detail || body.message || fallback
  }

  async function apiGet<T = any>(path: string, params?: Record<string, string>): Promise<T> {
    const url = base() + path
    if (config.logInfo) logger.info(`GET ${url} ${params ? JSON.stringify(params) : ''}`)
    try {
      const res = await ctx.http.get<T>(url, { params })
      if (res && typeof res === 'object') {
        const r = res as any
        if (r.success === false || (r.error && typeof r.error === 'object' && r.error.code)) {
          throw new Error(normalizeErrorBody(r, '后端返回未知错误'))
        }
      }
      return res
    } catch (err: any) {
      const errMsg = normalizeErrorBody(err.response?.data ?? err.data, err.message)
      logger.error(`API 请求失败 [${url}]: ${errMsg}`)
      throw new Error(errMsg)
    }
  }

  async function apiPost<T = any>(path: string, data?: any): Promise<T> {
    const url = base() + path
    if (config.logInfo) logger.info(`POST ${url} ${data ? JSON.stringify(data) : ''}`)
    try {
      return await ctx.http.post<T>(url, data)
    } catch (err: any) {
      const errMsg = normalizeErrorBody(err.response?.data ?? err.data, err.message)
      logger.error(`API 请求失败 [${url}]: ${errMsg}`)
      throw new Error(errMsg)
    }
  }

  async function getSources(force = false): Promise<SourceManifest[]> {
    if (!force && manifestCache.list.length && Date.now() - manifestCache.at < 60_000) {
      return manifestCache.list
    }
    try {
      const res = await apiGet<{ sources: SourceManifest[] }>('/api/sources')
      manifestCache = { at: Date.now(), list: res?.sources || [] }
    } catch {
      // 后端不可达时保留旧缓存，不阻塞命令
    }
    return manifestCache.list
  }

  function sourceNameSync(source: string): string {
    return manifestCache.list.find(m => m.id === source)?.name || source
  }

  // 解析 "源:ID"、"源|ID"、"源ID"、纯数字ID(jm)、24位hex(bika)
  // 返回 null 表示无法判断来源（按关键词处理）
  function resolveSourceId(raw: string, manifests: SourceManifest[]): { source: string; id: string } | null {
    const clean = raw.trim()
    if (!clean) return null

    const alias = new Map<string, string>()
    for (const m of manifests) {
      alias.set(m.id.toLowerCase(), m.id)
      alias.set(m.name.toLowerCase(), m.id)
      for (const a of EXTRA_ALIASES[m.id] || []) alias.set(a.toLowerCase(), m.id)
    }
    // 后端不可达时的兜底别名
    if (!alias.size) {
      for (const [id, names] of Object.entries(EXTRA_ALIASES)) {
        for (const a of names) alias.set(a, id)
      }
    }

    // 显式分隔符：源:ID / 源|ID（全角也支持）
    const sep = clean.match(/^([^\s:：|｜]+)[:：|｜]\s*(\S+)\s*$/)
    if (sep) {
      const src = alias.get(sep[1].toLowerCase())
      if (src) return { source: src, id: sep[2] }
    }

    // 前缀形式：jm12345 / 哔咔xxx / 拷贝abc（别名按长度降序优先匹配长名）
    const lower = clean.toLowerCase()
    for (const name of [...alias.keys()].sort((a, b) => b.length - a.length)) {
      if (lower.startsWith(name) && clean.length > name.length) {
        const rest = clean.slice(name.length).trim()
        if (/^[\w-]{2,}$/.test(rest)) {
          return { source: alias.get(name)!, id: rest }
        }
      }
    }

    // 裸 ID 启发式
    if (/^[0-9a-fA-F]{24}$/.test(clean)) {
      return { source: alias.get('bika') || 'bika', id: clean }
    }
    if (/^\d+$/.test(clean)) {
      return { source: alias.get('jm') || 'jm', id: clean }
    }
    return null
  }

  // ========== 核心下载函数（命令和工具共用） ==========
  async function doDownload(
    session: any,
    id: string,
    chapterId: string | undefined,
    opts?: { silent?: boolean }
  ): Promise<DownloadResult> {
    const silent = opts?.silent ?? false
    const manifests = await getSources()

    // 1. 解析来源与 ID
    let source = ''
    let comicId = ''
    const resolved = resolveSourceId(id, manifests)
    if (resolved) {
      source = resolved.source
      comicId = resolved.id
    } else {
      if (!silent) await session.send(`正在搜索并解析本子名「${id}」...`)
      try {
        const searchResult = await apiGet<SearchResult>('/api/search', { keyword: id })
        const best = searchResult.best_match || searchResult.items?.[0]
        if (best?.id && best?.source) {
          source = best.source
          comicId = best.id
        } else {
          for (const [src, list] of Object.entries(searchResult.all_results || {})) {
            if (list?.length) {
              source = src
              comicId = list[0].id
              break
            }
          }
        }
        if (!source || !comicId) {
          return failResult('未找到相关漫画')
        }
      } catch (err: any) {
        return failResult(`搜索本子名失败: ${err.message}`)
      }
    }

    // 2. 获取详情
    if (!silent) await session.send('正在获取漫画详情...')
    let detail: ComicDetail
    try {
      detail = await apiGet<ComicDetail>(`/api/comic/${source}/${encodeURIComponent(comicId)}`)
    } catch (e: any) {
      return failResult(`获取详情失败: ${e.message}`)
    }
    const srcLabel = sourceNameSync(source)
    if (!detail?.title) {
      return failResult(`未找到该漫画 [${srcLabel} ID: ${comicId}]`)
    }
    if (!detail.chapters?.length) {
      return failResult('该漫画没有可下载的章节')
    }

    // 3. 确定章节
    const chapter = chapterId
      ? detail.chapters.find(c => c.id === chapterId)
      : detail.chapters[0]
    if (!chapter) {
      return failResult(`未找到章节 ${chapterId}`)
    }

    const chapterName = chapter.name
    const totalChapters = detail.chapters.length

    // 4. 创建下载任务（comic-api v2 任务式接口）
    if (!silent) {
      if (!chapterId && totalChapters > 1) {
        await session.send(`该漫画共 ${totalChapters} 话，正在下载第一话: ${chapterName}`)
      } else {
        await session.send(`正在下载「${detail.title} - ${chapterName}」(${srcLabel})...`)
      }
    }

    let task: DownloadTask
    try {
      task = await apiPost<DownloadTask>('/api/downloads', {
        source,
        comic_id: comicId,
        chapter_id: chapter.id,
        title: detail.title,
        chapter: chapterName,
      })
    } catch (e: any) {
      return failResult(`创建下载任务失败: ${e.message}`)
    }

    // 5. 轮询任务状态，按阶段/进度节流提示
    const deadline = Date.now() + config.downloadTimeout * 1000
    let lastStage = ''
    let lastNotify = 0
    let current: DownloadTask = task
    while (true) {
      try {
        current = await apiGet<DownloadTask>(`/api/downloads/${task.id}`)
      } catch {
        // 轮询失败不致命，继续等
      }
      if (current.status === 'completed') break
      if (current.status === 'failed' || current.status === 'cancelled') {
        return failResult(`下载${current.status === 'failed' ? '失败' : '已取消'}: ${current.error || '未知原因'}`)
      }
      const now = Date.now()
      if (now > deadline) {
        return failResult(`等待超时（${config.downloadTimeout}s）。任务仍在后台执行，可稍后在 comic-api WebUI 下载列表取回，重新执行下载命令会自动复用同一任务。`)
      }
      const stageLabel = STAGE_LABELS[current.stage] || current.stage
      const progress = current.total > 0 ? ` ${current.completed}/${current.total}` : ''
      if (!silent && (current.stage !== lastStage || now - lastNotify > 15000)) {
        lastStage = current.stage
        lastNotify = now
        try {
          await session.send(`📥 ${stageLabel}${progress}...`)
        } catch { /* 发送失败不影响下载 */ }
      }
      await sleep(2000)
    }

    // 6. 取回 PDF 文件
    const pdfPassword = current.password || getPdfPassword(source, comicId, chapter.id)
    const fileUrl = `${base()}/api/downloads/${task.id}/file`
    if (config.logInfo) logger.info(`Fetching PDF: ${fileUrl}`)

    let buffer: Buffer
    try {
      const data = await ctx.http.get<ArrayBuffer>(fileUrl, { responseType: 'arraybuffer', timeout: 120_000 })
      buffer = Buffer.from(data)
    } catch (e: any) {
      return failResult(`下载完成但取回文件失败: ${e.message}。可在 comic-api WebUI 下载列表手动取回。`)
    }
    if (buffer.length < 100) {
      return failResult('下载失败：返回数据异常')
    }

    // 7. 发送文件
    const cleanTitle = source === 'jm' ? `jm${comicId}` : `${source}-${sanitizeFilename(detail.title)}`
    const filename = `${cleanTitle}.pdf`

    try {
      if (config.pdfSendMethod === 'file') {
        const tempDir = config.fileSendPath || '/koishi/temp'
        await fs.promises.mkdir(tempDir, { recursive: true })
        const tempFilePath = path.join(tempDir, filename)
        await fs.promises.writeFile(tempFilePath, buffer)
        const fileUri = pathToFileURL(tempFilePath).href
        await session.send(h.file(fileUri))
      } else {
        await session.send(h.file(buffer, 'application/pdf', { filename, title: filename }))
      }
    } catch (sendErr: any) {
      logger.warn('发送 PDF 文件失败，尝试提供直接下载链接:', sendErr.message)
      return {
        success: false, title: detail.title, password: pdfPassword, chapterName, totalChapters,
        chapters: detail.chapters, source, comicId,
        error: `发送文件失败，请手动下载: ${fileUrl}`,
      }
    }

    return {
      success: true,
      title: detail.title,
      password: pdfPassword,
      chapterName,
      totalChapters,
      chapters: detail.chapters,
      source,
      comicId,
    }
  }

  const SUBCOMMANDS = ['search', 'download', 'detail', 'leaderboard', 'latest', 'random', 'category', 'sources']

  // Parent command 'comic' routing logic
  ctx.command('comic [keyword:text]', '多图源漫画搜索与直接下载')
    .action(async ({ session }, keyword) => {
      if (!session) return
      if (!keyword) {
        return session.execute('help comic')
      }
      const clean = keyword.trim()

      // 当 keyword 以子命令名开头时，强制用点号形式转发到子命令。
      // Koishi 的 `comic [keyword:text]` 贪婪参数会吞掉 `comic random` / `comic latest`
      // 这类无参子命令，导致它们被当作搜索词处理。
      const parts = clean.split(/\s+/)
      const firstWord = parts[0].toLowerCase()
      if (SUBCOMMANDS.includes(firstWord)) {
        const rest = parts.slice(1).join(' ')
        return session.execute(`comic.${firstWord}${rest ? ' ' + rest : ''}`)
      }

      const resolved = resolveSourceId(parts[0], await getSources())
      if (resolved) {
        // 兼容旧习惯：禁漫小号数字 ID 多半是误输入的关键词，走搜索
        if (resolved.source === 'jm' && /^\d+$/.test(resolved.id) && parseInt(resolved.id, 10) <= 100) {
          return session.execute(`comic.search ${keyword}`)
        }
        const chapterId = parts.slice(1).join(' ')
        const downloadCmd = chapterId
          ? `comic.download ${resolved.source}:${resolved.id} ${chapterId}`
          : `comic.download ${resolved.source}:${resolved.id}`
        return session.execute(downloadCmd)
      }

      return session.execute(`comic.search ${keyword}`)
    })

  async function buildDetailText(source: string, id: string): Promise<string | null> {
    try {
      const detail = await apiGet<ComicDetail>(`/api/comic/${source}/${encodeURIComponent(id)}`)
      if (!detail?.title) return null

      const srcLabel = sourceNameSync(source)
      const parts = [
        `📖 ${detail.title}`,
        `来源: ${srcLabel}(${source}) | ID: ${id}`,
        `作者: ${detail.author || '佚名'}`,
        `简介: ${(detail.description || '无描述').slice(0, 200)}`,
        `章节数: ${detail.chapters?.length || 0}`,
      ]

      if (detail.chapters?.length > 0) {
        const first = detail.chapters[0]
        parts.push(`第一话: [${first.id}] ${first.name}`)
        if (detail.chapters.length > 1) {
          parts.push(`共 ${detail.chapters.length} 话，如需下载请使用 comic download ${source}:${id} [章节ID]`)
        }
      }
      return parts.join('\n')
    } catch (err: any) {
      logger.error(`获取详情失败 [${source}/${id}]:`, err.message)
      return null
    }
  }

  async function fetchAndShowDetail(session: any, source: string, id: string): Promise<string | void> {
    await session.send('正在获取详情...')
    const text = await buildDetailText(source, id)
    return text || '未找到该漫画'
  }

  // comic sources：查看图源清单
  ctx.command('comic.sources', '查看可用图源列表')
    .action(async () => {
      const manifests = await getSources(true)
      if (!manifests.length) return '未能获取图源列表，请确认 comic-api 后端已启动。'
      const lines = manifests.map(m => {
        const caps = m.capabilities?.join('/') || ''
        let account = ''
        if (m.capabilities?.includes('login')) {
          account = m.account?.authenticated ? '｜已登录' : '｜未登录'
        }
        return `• ${m.name}(${m.id})${account}\n  能力: ${caps}`
      })
      return `📚 当前图源（共 ${manifests.length} 个）\n${lines.join('\n')}`
    })

  // comic search <keyword>
  ctx.command('comic.search <keyword:text>', '聚合搜索漫画')
    .action(async ({ session }, keyword) => {
      if (!keyword) return '请输入搜索关键词'

      try {
        const manifests = await getSources()
        let result: SearchResult
        const resolved = resolveSourceId(keyword, manifests)
        if (resolved) {
          // 明确的 源:ID，先按详情直查，失败回退到该源内搜索
          try {
            const detail = await apiGet<ComicDetail>(`/api/comic/${resolved.source}/${encodeURIComponent(resolved.id)}`)
            if (detail?.title) {
              const mockItem: ComicItem = {
                id: resolved.id,
                title: detail.title,
                author: detail.author,
                source: resolved.source,
                cover: detail.cover
              }
              result = {
                keyword,
                best_match: mockItem,
                all_results: { [resolved.source]: [mockItem] },
              }
            } else {
              result = await apiGet<SearchResult>('/api/search', { keyword: resolved.id, source: resolved.source })
            }
          } catch {
            result = await apiGet<SearchResult>('/api/search', { keyword: resolved.id, source: resolved.source })
          }
        } else {
          result = await apiGet<SearchResult>('/api/search', { keyword })
        }
        // 单源搜索响应没有 best_match，用排序结果首条兜底
        if (!result.best_match && result.items?.length) {
          result.best_match = result.items[0]
        }

        const groups = result.all_results || {}
        const nameOf = (id: string) => manifests.find(m => m.id === id)?.name || id

        // 每图源最多取 8 条，全局统一编号
        const all: (ComicItem & { source: string })[] = []
        const perSourceLines: Record<string, string[]> = {}
        let idx = 1
        for (const [src, list] of Object.entries(groups)) {
          const items = (list || []).slice(0, 8).map(c => ({ ...c, source: src }))
          perSourceLines[src] = items.map(item => {
            all.push(item)
            const line = `${idx}. ${item.title}  作者:${item.author || '佚名'} (ID: ${item.id})`
            idx++
            return line
          })
        }

        const totalResults = all.length
        if (totalResults === 0) {
          const errs = Object.entries(result.errors || {})
            .map(([src, e]) => `${nameOf(src)}: ${e?.message || '失败'}`)
            .join('；')
          return errs
            ? `没有找到关于「${keyword}」的漫画。（部分图源异常：${errs}）`
            : `没有找到关于「${keyword}」的漫画。`
        }

        if (!session) {
          const lines: string[] = []
          for (const [src, srcLines] of Object.entries(perSourceLines)) {
            if (srcLines.length) lines.push(`【 ${nameOf(src)} (${src}) 】`, ...srcLines)
          }
          return lines.join('\n')
        }

        // 合并转发：头部 + 每个图源一条 + 提示
        const msgElements = []
        let header = `🔍 关键词「${keyword}」共找到 ${totalResults} 个结果`
        if (result.best_match?.title) {
          const bm = result.best_match
          header += `\n🏆 最佳匹配 [${bm.source ? nameOf(bm.source) : '?'}]: ${bm.title}`
        }
        const errNotes = Object.entries(result.errors || {})
          .map(([src, e]) => `${nameOf(src)}(${e?.message || '异常'})`)
          .join('、')
        if (errNotes) header += `\n⚠️ 部分图源未返回结果: ${errNotes}`
        msgElements.push(h('message', header))
        for (const [src, srcLines] of Object.entries(perSourceLines)) {
          if (srcLines.length) {
            msgElements.push(h('message', `【 ${nameOf(src)} (${src}) 】\n${srcLines.join('\n')}`))
          }
        }
        msgElements.push(h('message', '💡 回复序号下载（如 1），或回复「源|ID」（如 jm|12345），回复其他内容退出。'))

        await session.send(h('message', { forward: true }, msgElements))

        const answer = await session.prompt(30000)
        if (!answer) return
        const cleanAnswer = answer.trim()

        // 序号
        const index = parseInt(cleanAnswer, 10)
        if (!isNaN(index) && /^\d+$/.test(cleanAnswer) && index > 0 && index <= all.length) {
          const pick = all[index - 1]
          return session.execute(`comic.download ${pick.source}:${pick.id}`)
        }

        // 源|ID / 源:ID / 源ID / 裸ID
        const resolved2 = resolveSourceId(cleanAnswer, manifests)
        if (resolved2) {
          return session.execute(`comic.download ${resolved2.source}:${resolved2.id}`)
        }
        return // 非有效输入，退出
      } catch (err: any) {
        logger.error('搜索失败:', err.message)
        return `搜索失败: ${err.message}`
      }
    })

  // comic download <id> [chapterId]
  ctx.command('comic.download <id:string> [chapterId:string]', '下载漫画PDF')
    .action(async ({ session }, id, chapterId) => {
      if (!id) return '用法: comic download <ID|图源:ID> [章节ID]'
      if (!session) return '此命令仅支持在会话中使用'

      const result = await doDownload(session, id, chapterId)
      if (!result.success) {
        return result.error || '下载失败'
      }

      // 发送密码（文件已在 doDownload 中发送）
      await session.send(`🔑 该 PDF 已加密，解密密码为：${result.password}`)

      if (result.totalChapters > 1 && !chapterId) {
        const chapterList = result.chapters.slice(0, 20).map((ch, i) => `${i + 1}. [${ch.id}] ${ch.name}`).join('\n')
        const more = result.totalChapters > 20 ? `\n... 共 ${result.totalChapters} 话` : ''
        return `这是第一话，共 ${result.totalChapters} 话。如需其他话请指定章节ID。\n章节列表:\n${chapterList}${more}`
      }

      return '下载完成！'
    })

  // comic detail <id>
  ctx.command('comic.detail <id:text>', '查看漫画详情')
    .action(async ({ session }, query) => {
      if (!query) return '用法: comic detail <关键词> 或 comic detail <ID|图源:ID>'
      if (!session) return '此命令仅支持在会话中使用'

      const manifests = await getSources()

      // 直接给定 ID/源：只查该来源
      const resolved = resolveSourceId(query, manifests)
      if (resolved) {
        return fetchAndShowDetail(session, resolved.source, resolved.id)
      }

      // 关键词模式：聚合搜索后各图源各取最佳匹配展示详情
      try {
        await session.send('正在搜索并获取详情...')
        const result = await apiGet<SearchResult>('/api/search', { keyword: query })
        const groups = result.all_results || {}
        const bests: { source: string; item: ComicItem }[] = []
        for (const [src, list] of Object.entries(groups)) {
          if (list?.length) bests.push({ source: src, item: list[0] })
        }
        // 兜底：若没有分组但有排序结果，取前若干去重源
        if (!bests.length && result.items?.length) {
          const seen = new Set<string>()
          for (const item of result.items) {
            const src = item.source || ''
            if (src && !seen.has(src)) {
              seen.add(src)
              bests.push({ source: src, item })
            }
          }
        }

        if (!bests.length) {
          return `没有找到关于「${query}」的漫画。`
        }

        const nameOf = (id: string) => manifests.find(m => m.id === id)?.name || id
        const texts = await Promise.all(bests.slice(0, 5).map(b => buildDetailText(b.source, b.item.id)))

        const msgElements = [
          h('message', `🔍 关键词「${query}」各图源最相似结果详情：`),
        ]
        bests.slice(0, 5).forEach((b, i) => {
          const needLogin = manifests.find(m => m.id === b.source)?.capabilities?.includes('login')
          msgElements.push(h('message', texts[i] || `【 ${nameOf(b.source)} 】详情获取失败${needLogin ? '(该图源可能需先在 comic-api 登录)' : ''}`))
        })

        await session.send(h('message', { forward: true }, msgElements))
        return
      } catch (err: any) {
        logger.error('详情搜索失败:', err.message)
        return `查询失败: ${err.message}`
      }
    })

  // 通用浏览：latest / leaderboard / random / category
  async function fetchBrowse(source: string, action: string, params: Record<string, string>): Promise<{ ok: boolean; items: ComicItem[]; error?: string }> {
    try {
      const res = await apiGet<BrowseResponse>(`/api/${source}/${action}`, params)
      return { ok: true, items: res?.data || [] }
    } catch (e: any) {
      return { ok: false, items: [], error: e.message }
    }
  }

  // comic leaderboard [mode] [page]
  ctx.command('comic.leaderboard [mode:string] [page:number]', '查看排行榜')
    .action(async ({ session }, mode, page) => {
      if (!session) return '此命令仅支持在会话中使用'
      const targetMode = (mode || 'day').toLowerCase()
      const targetPage = Math.max(1, Math.floor(page || 1))

      const manifests = await getSources()
      const candidates = manifests.filter(m => m.capabilities?.includes('leaderboard'))
      if (!candidates.length) return '当前没有图源支持排行榜。'

      // 校验 mode：取所有源支持的 mode 合集
      const allModes = new Set<string>()
      const modeLabel = new Map<string, string>()
      for (const m of candidates) {
        for (const lm of m.leaderboard_modes || []) {
          allModes.add(lm.value)
          modeLabel.set(lm.value, lm.label)
        }
      }
      if (allModes.size && !allModes.has(targetMode)) {
        return `mode 必须是 ${[...allModes].join('/')}（默认 day）`
      }

      try {
        const results = await Promise.all(candidates.map(async m => {
          // 该源不支持此 mode 时回退 day（如哔咔无总榜）
          const supported = (m.leaderboard_modes || []).map(x => x.value)
          const effective = supported.length && !supported.includes(targetMode) ? 'day' : targetMode
          const r = await fetchBrowse(m.id, 'leaderboard', { mode: effective, page: String(targetPage) })
          return { m, effective, ...r }
        }))

        const formatList = (comics: ComicItem[]): string => {
          if (!comics.length) return '暂无数据或获取失败'
          return comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`).join('\n')
        }

        for (const r of results) {
          const label = modeLabel.get(r.effective) || r.effective
          const suffix = r.effective !== targetMode ? `(该源无${modeLabel.get(targetMode) || targetMode}，已回退${label})` : ''
          const body = r.ok
            ? (r.items.length ? formatList(r.items) : '暂无数据')
            : `获取失败: ${r.error}`
          await session.send(`【 ${r.m.name} (${r.m.id}) ${label}${suffix} · 第${targetPage}页 】\n${body}`)
        }
        return
      } catch (err: any) {
        logger.error('获取排行榜失败:', err.message)
        return `获取排行榜失败: ${err.message}`
      }
    })

  // 翻页累积拉取，直到达到 limit 条或没有更多（最多翻 maxPages 页防止狂刷后端）
  async function fetchUpTo(source: string, action: string, limit: number, params: Record<string, string> = {}, maxPages = 5): Promise<ComicItem[]> {
    const acc: ComicItem[] = []
    for (let page = 1; page <= maxPages && acc.length < limit; page++) {
      const r = await fetchBrowse(source, action, { ...params, page: String(page) })
      if (!r.ok || !r.items.length) break
      acc.push(...r.items)
    }
    return acc.slice(0, limit)
  }

  // comic latest
  ctx.command('comic.latest', '查看最近更新')
    .alias('最新漫画')
    .alias('漫画更新')
    .option('number', '-n <count:number> 每个图源显示数量(默认10，最多50)')
    .action(async ({ session, options }) => {
      if (!session) return '此命令仅支持在会话中使用'
      const limit = Math.min(50, Math.max(1, Math.floor(options?.number || 10)))

      const manifests = (await getSources()).filter(m => m.capabilities?.includes('latest'))
      if (!manifests.length) return '当前没有图源支持最近更新。'

      try {
        const formatList = (comics: ComicItem[]): string => {
          if (!comics.length) return '暂无数据或获取失败'
          return comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`).join('\n')
        }

        const results = await Promise.all(manifests.map(async m => ({
          m,
          items: await fetchUpTo(m.id, 'latest', limit).catch(() => [] as ComicItem[]),
        })))

        for (const r of results) {
          const needLogin = r.m.capabilities?.includes('login') && r.m.account && !r.m.account.authenticated && !r.items.length
          const body = r.items.length
            ? formatList(r.items)
            : (needLogin ? '暂无数据或获取失败(该图源需先在 comic-api 登录)' : '暂无数据或获取失败')
          await session.send(`【 ${r.m.name} (${r.m.id}) 最近更新 · ${r.items.length}条 】\n${body}`)
        }
        return
      } catch (err: any) {
        logger.error('获取最近更新失败:', err.message)
        return `获取最近更新失败: ${err.message}`
      }
    })

  // 随机推荐：多次调用累积去重，直到达到 limit 条或尝试上限
  async function fetchRandomUpTo(source: string, limit: number, maxTries = 4): Promise<ComicItem[]> {
    const map = new Map<string, ComicItem>()
    for (let i = 0; i < maxTries && map.size < limit; i++) {
      const r = await fetchBrowse(source, 'random', {})
      if (!r.ok || !r.items.length) break
      for (const item of r.items) {
        if (item?.id && !map.has(item.id)) map.set(item.id, item)
      }
    }
    return Array.from(map.values()).slice(0, limit)
  }

  // comic random
  ctx.command('comic.random', '随机推荐漫画')
    .alias('随机漫画')
    .option('number', '-n <count:number> 每个图源推荐数量(默认5，最多20)')
    .action(async ({ session, options }) => {
      const limit = Math.min(20, Math.max(1, Math.floor(options?.number || 5)))

      const manifests = (await getSources()).filter(m => m.capabilities?.includes('random'))
      if (!manifests.length) return '当前没有图源支持随机推荐。'

      const results = await Promise.all(manifests.map(async m => ({
        m,
        items: await fetchRandomUpTo(m.id, limit).catch(() => [] as ComicItem[]),
      })))

      const formatList = (comics: ComicItem[], label: string): string => {
        if (!comics.length) return `【 ${label} 】暂无数据或获取失败`
        const lines = comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`)
        return `🎲 ${label} 随机推荐 · ${comics.length}个\n${lines.join('\n')}`
      }

      const texts = results.map(r => {
        const needLogin = r.m.capabilities?.includes('login') && r.m.account && !r.m.account.authenticated && !r.items.length
        return needLogin ? `🎲 ${r.m.name} 随机推荐\n暂无数据或获取失败(该图源需先登录)` : formatList(r.items, r.m.name)
      })

      if (session) {
        for (const t of texts) await session.send(t)
        await session.send('💡 如需下载，请使用 comic download <图源:ID> 或 comic download <ID>')
        return
      }
      return texts.join('\n\n')
    })

  // comic category [name] [page]
  ctx.command('comic.category [query:text]', '按分类浏览漫画')
    .option('page', '-p <page:number> 页码(默认1)')
    .action(async ({ session, options }, query) => {
      if (!session) return '此命令仅支持在会话中使用'
      const manifests = (await getSources()).filter(m => m.capabilities?.includes('category'))
      if (!manifests.length) return '当前没有图源支持分类浏览。'

      const page = Math.max(1, Math.floor(options?.page || 1))

      // 不带参数：列出各图源分类
      if (!query?.trim()) {
        const msgElements = [h('message', '📂 各图源可用分类：')]
        for (const m of manifests) {
          const cats = (m.categories || []).map(c => c.label).join('、') || '无'
          msgElements.push(h('message', `【 ${m.name} (${m.id}) 】\n${cats}`))
        }
        msgElements.push(h('message', '💡 用法: comic category <分类名> [-p 页码]，跨图源同名分类会分别展示'))
        await session.send(h('message', { forward: true }, msgElements))
        return
      }

      // 解析 "分类名 页码" 或 "图源:分类名"
      const parts = query.trim().split(/\s+/)
      let trailingPage = page
      if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
        trailingPage = Math.max(1, parseInt(parts.pop()!, 10))
      }
      const catQuery = parts.join(' ')

      // 支持 "图源:分类" 指定单一图源
      const resolved = resolveSourceId(catQuery, manifests)
      const targets = resolved
        ? manifests.filter(m => m.id === resolved.source)
        : manifests
      const catName = resolved ? resolved.id : catQuery

      if (resolved && !targets.length) {
        return `图源 ${resolved.source} 不支持分类浏览。`
      }

      // 匹配分类 value：先精确匹配 value/label，再模糊包含
      const jobs = targets.map(m => {
        const cats = m.categories || []
        const exact = cats.find(c => c.value === catName || c.label === catName)
        const fuzzy = exact ? undefined : cats.find(c => c.label.includes(catName) || c.value.includes(catName))
        const chosen = exact || fuzzy
        return { m, chosen }
      })

      const hits = jobs.filter(j => j.chosen)
      if (!hits.length) {
        const available = jobs.map(j => `【${j.m.name}】${(j.m.categories || []).map(c => c.label).join('、') || '无'}`).join('\n')
        return `未找到分类「${catName}」。可用分类：\n${available}`
      }

      const formatList = (comics: ComicItem[]): string => {
        if (!comics.length) return '暂无数据或获取失败'
        return comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`).join('\n')
      }

      const results = await Promise.all(hits.map(async j => ({
        m: j.m,
        cat: j.chosen!,
        r: await fetchBrowse(j.m.id, 'category', { name: j.chosen!.value, page: String(trailingPage) }),
      })))

      for (const r of results) {
        const body = r.r.ok ? formatList(r.r.items) : `获取失败: ${r.r.error}`
        await session.send(`【 ${r.m.name} (${r.m.id}) · ${r.cat.label} · 第${trailingPage}页 】\n${body}`)
      }
      await session.send('💡 如需下载，请使用 comic download <图源:ID>')
      return
    })

  // ========== 工具创建函数 ==========

  function createComicSourcesTool(cfg: Config) {
    const toolCfg = cfg.comicSourcesTool
    return tool(async () => {
      try {
        const manifests = await getSources(true)
        return JSON.stringify({
          total: manifests.length,
          sources: manifests.map(m => ({
            id: m.id,
            name: m.name,
            capabilities: m.capabilities,
            categories: m.categories,
            leaderboard_modes: m.leaderboard_modes,
            account: m.account,
          })),
        })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || '请求失败' })
      }
    }, {
      name: toolCfg.name || 'comic_sources',
      description: toolCfg.description || '查看可用漫画图源列表',
      schema: comicSourcesSchema as any,
    }) as any
  }

  function createComicSearchTool(cfg: Config) {
    const toolCfg = cfg.comicSearchTool
    return tool(async (input: z.infer<typeof comicSearchSchema>) => {
      try {
        if (!input.keyword) {
          return JSON.stringify({ error: '搜索时 keyword 不能为空' })
        }
        const params: Record<string, string> = { keyword: input.keyword }
        if (input.source) params.source = input.source
        const result = await apiGet<SearchResult>('/api/search', params)
        const flat: ComicItem[] = result.items?.length
          ? result.items
          : Object.entries(result.all_results || {}).flatMap(([src, list]) =>
              (list || []).map(c => ({ ...c, source: c.source || src })))
        // 返回前5条（含标题），让AI在最终回复中列出名字供用户参考
        return JSON.stringify({
          keyword: input.keyword,
          best_match: result.best_match || flat[0] || null,
          total: flat.length,
          results: flat.slice(0, 5),
          errors: result.errors || {},
        })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || '搜索请求失败' })
      }
    }, {
      name: toolCfg.name || 'comic_search',
      description: toolCfg.description || '搜索漫画',
      schema: comicSearchSchema as any,
    }) as any
  }

  function createComicDetailTool(cfg: Config) {
    const toolCfg = cfg.comicDetailTool
    return tool(async (input: z.infer<typeof comicDetailSchema>) => {
      try {
        if (!input.comic_id) {
          return JSON.stringify({ error: '查看详情时 comic_id 不能为空' })
        }
        const manifests = await getSources()
        const resolved = resolveSourceId(input.comic_id, manifests)
        const source = input.source || resolved?.source || 'jm'
        const id = resolved?.id || input.comic_id
        const detail = await apiGet<ComicDetail>(`/api/comic/${source}/${encodeURIComponent(id)}`)
        if (!detail?.title) {
          return JSON.stringify({ error: '未找到该漫画' })
        }
        return JSON.stringify({
          title: detail.title,
          author: detail.author,
          description: detail.description,
          source: detail.source || source,
          id,
          chapter_count: detail.chapters?.length || 0,
          chapters: detail.chapters?.slice(0, 30) || [],
        })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || '查询详情失败' })
      }
    }, {
      name: toolCfg.name || 'comic_detail',
      description: toolCfg.description || '查看漫画详情',
      schema: comicDetailSchema as any,
    }) as any
  }

  function createComicLeaderboardTool(cfg: Config) {
    const toolCfg = cfg.comicLeaderboardTool
    return tool(async (input: z.infer<typeof comicLeaderboardSchema>) => {
      try {
        const mode = input.mode || 'day'
        const page = String(input.page || 1)
        const manifests = (await getSources()).filter(m => m.capabilities?.includes('leaderboard'))

        if (input.source) {
          const result = await fetchBrowse(input.source, 'leaderboard', { mode, page })
          return JSON.stringify({
            source: input.source,
            mode,
            page: Number(page),
            total: result.items.length,
            results: result.items,
            error: result.ok ? undefined : result.error,
          })
        }
        // 聚合全部支持排行榜的源，按源分组返回
        const entries = await Promise.all(manifests.map(async m => {
          const supported = (m.leaderboard_modes || []).map(x => x.value)
          const effective = supported.length && !supported.includes(mode) ? 'day' : mode
          const r = await fetchBrowse(m.id, 'leaderboard', { mode: effective, page })
          return [m.id, {
            name: m.name,
            mode: effective,
            total: r.items.length,
            results: r.items,
            error: r.ok ? undefined : r.error,
          }] as const
        }))
        return JSON.stringify({ mode, page: Number(page), sources: Object.fromEntries(entries) })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || '获取排行榜失败' })
      }
    }, {
      name: toolCfg.name || 'comic_leaderboard',
      description: toolCfg.description || '查看漫画排行榜',
      schema: comicLeaderboardSchema as any,
    }) as any
  }

  function createComicLatestTool(cfg: Config) {
    const toolCfg = cfg.comicLatestTool
    return tool(async (input: z.infer<typeof comicLatestSchema>) => {
      try {
        const manifests = (await getSources()).filter(m => m.capabilities?.includes('latest'))
        if (input.source) {
          const result = await fetchBrowse(input.source, 'latest', { page: '1' })
          return JSON.stringify({
            source: input.source,
            total: result.items.length,
            results: result.items,
            error: result.ok ? undefined : result.error,
          })
        }
        const entries = await Promise.all(manifests.map(async m => {
          const r = await fetchBrowse(m.id, 'latest', { page: '1' })
          return [m.id, {
            name: m.name,
            total: r.items.length,
            results: r.items,
            error: r.ok ? undefined : r.error,
          }] as const
        }))
        return JSON.stringify({ sources: Object.fromEntries(entries) })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || '获取最近更新失败' })
      }
    }, {
      name: toolCfg.name || 'comic_latest',
      description: toolCfg.description || '查看最近更新的漫画',
      schema: comicLatestSchema as any,
    }) as any
  }

  function createComicRandomTool(cfg: Config) {
    const toolCfg = cfg.comicRandomTool
    return tool(async (input: z.infer<typeof comicRandomSchema>) => {
      try {
        const manifests = (await getSources()).filter(m => m.capabilities?.includes('random'))
        if (input.source) {
          const result = await fetchBrowse(input.source, 'random', {})
          return JSON.stringify({
            source: input.source,
            results: result.items,
            error: result.ok ? undefined : result.error,
          })
        }
        const entries = await Promise.all(manifests.map(async m => {
          const r = await fetchBrowse(m.id, 'random', {})
          return [m.id, {
            name: m.name,
            results: r.items,
            error: r.ok ? undefined : r.error,
          }] as const
        }))
        return JSON.stringify({ sources: Object.fromEntries(entries) })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || '获取随机推荐失败' })
      }
    }, {
      name: toolCfg.name || 'comic_random',
      description: toolCfg.description || '随机推荐漫画',
      schema: comicRandomSchema as any,
    }) as any
  }

  function createComicDownloadTool(cfg: Config) {
    const toolCfg = cfg.comicDownloadTool
    return tool(async (input: z.infer<typeof comicDownloadSchema>, runConfig?: any) => {
      try {
        if (!input.comic_id) {
          return JSON.stringify({ error: '下载漫画时 comic_id 不能为空' })
        }
        const session = runConfig?.configurable?.session
        if (!session) {
          return JSON.stringify({ error: '无法获取当前会话，不支持下载操作。请让用户在聊天界面直接使用 comic download 命令手动下载。' })
        }

        const query = input.source ? `${input.source}:${input.comic_id}` : input.comic_id
        const result = await doDownload(session, query, input.chapter_id, { silent: true })

        if (!result.success) {
          return JSON.stringify({ error: result.error || '下载失败' })
        }

        // 工具路径不依赖 LLM 转述密码：文件发出后由代码直接推送密码，避免模型省略
        try {
          await session.send(`🔑 该 PDF 已加密，解密密码为：${result.password}`)
        } catch (sendPwdErr: any) {
          logger.warn('发送 PDF 密码失败:', sendPwdErr?.message || sendPwdErr)
        }

        const chapterInfo = result.totalChapters > 1
          ? `（第1话/共${result.totalChapters}话）`
          : ''

        return JSON.stringify({
          success: true,
          title: result.title,
          password: result.password,
          chapter_name: result.chapterName,
          total_chapters: result.totalChapters,
          source: result.source,
          password_sent: true,
          must_include_in_reply: `已下载《${result.title}》${chapterInfo}，解密密码：${result.password}`,
          hint: `PDF与密码均已发送到聊天。最终回复必须原样包含密码 ${result.password}，不可省略。建议格式：列出搜索结果标题，并说明：已下载《${result.title}》${chapterInfo}，解密密码：${result.password}。整段一条消息完成。`,
        })
      } catch (err: any) {
        return JSON.stringify({ error: err.message || '下载请求失败' })
      }
    }, {
      name: toolCfg.name || 'comic_download',
      description: toolCfg.description || '下载漫画/本子为加密PDF并发送给用户；系统会自动发送解密密码，工具返回 password 字段，最终回复必须包含该密码',
      schema: comicDownloadSchema as any,
    }) as any
  }

  // Re-register tools whenever the optional ChatLuna service is loaded or reloaded.
  ctx.inject(['chatluna'], (ctx) => {
    const meta = {
      source: 'extension' as const,
      group: 'comic',
      tags: ['comic', 'manga'],
      defaultAvailability: {
        enabled: true,
        main: true,
        chatluna: true,
        characterScope: 'all' as const,
      },
    }

    const tools = [
      [config.comicSourcesTool, 'comic_sources', '查看可用漫画图源列表', () => createComicSourcesTool(config)],
      [config.comicSearchTool, 'comic_search', '搜索漫画', () => createComicSearchTool(config)],
      [config.comicDetailTool, 'comic_detail', '查看漫画详情', () => createComicDetailTool(config)],
      [config.comicLeaderboardTool, 'comic_leaderboard', '查看漫画排行榜', () => createComicLeaderboardTool(config)],
      [config.comicLatestTool, 'comic_latest', '查看最近更新的漫画', () => createComicLatestTool(config)],
      [config.comicRandomTool, 'comic_random', '随机推荐漫画', () => createComicRandomTool(config)],
      [config.comicDownloadTool, 'comic_download', '下载漫画/本子并发送给用户', () => createComicDownloadTool(config)],
    ] as const

    ctx.effect(() => {
      const chatluna = ctx.get('chatluna')
      const registerTool = chatluna?.platform?.registerTool
      if (!registerTool) {
        logger.warn('ChatLuna platform service is missing, skip comic tool registration')
        return () => {}
      }

      const disposers: Array<() => void> = []
      for (const [toolConfig, defaultName, defaultDescription, createTool] of tools) {
        if (!toolConfig.enabled) continue
        const toolName = toolConfig.name || defaultName
        try {
          disposers.push(registerTool.call(chatluna.platform, toolName, {
            description: toolConfig.description || defaultDescription,
            selector() { return true },
            createTool,
            meta,
          }))
          logger.info(`ChatLuna 工具「${toolName}」已注册`)
        } catch (error) {
          logger.warn(`注册 ChatLuna 工具「${toolName}」失败: ${error instanceof Error ? error.message : error}`)
        }
      }

      return () => {
        for (const dispose of disposers) dispose?.()
      }
    })
  })

}
