import { Context, Schema, h, segment } from 'koishi'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
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
<h2>聚合漫画搜索与下载插件</h2>
<p>使用前请先部署 <a href="https://github.com/lumia1998/comic-api">comic-api</a> 后端服务</p>
<p>支持禁漫天堂(JM)和哔咔漫画(Bika)双平台聚合搜索</p>
<h3>命令列表</h3>
<ul>
  <li><code>comic [关键词]</code> - 聚合搜索/直接下载漫画</li>
  <li><code>comic search &lt;关键词/ID&gt;</code> - 聚合搜索漫画，各平台最多8条，合并转发并标注来源</li>
  <li><code>comic download &lt;ID&gt; [章节ID]</code> - 下载漫画PDF</li>
  <li><code>comic detail &lt;关键词/ID&gt;</code> - 查看漫画详情，关键词模式下双平台各展示最相似结果</li>
  <li><code>comic leaderboard [类型] [页码]</code> - 排行榜(类型: day/week/month/total，默认day)，双平台分2条发送</li>
  <li><code>comic latest [-n 数量]</code> - 最近更新，每平台默认10条(最多50)，双平台分2条发送</li>
  <li><code>comic random [-n 数量]</code> - 随机推荐，每平台默认5个(最多20)，双平台分2条发送</li>
</ul>
`

export interface ToolConfig {
  enabled: boolean
  name: string
  description: string
}

export interface Config {
  apiBase: string
  concurrency: number
  logInfo: boolean
  pdfPassword?: string
  pdfSendMethod: 'buffer' | 'file'
  fileSendPath: string
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
    concurrency: Schema.number()
      .min(1).max(16)
      .description('下载并发数 (1-16)')
      .default(4),
    logInfo: Schema.boolean()
      .description('打印 API 调用日志')
      .default(false),
    pdfPassword: Schema.string()
      .description('PDF 统一加密密码 (留空则使用动态生成的6位密码并自动提示)'),
    pdfSendMethod: Schema.union(['buffer', 'file'] as const)
      .description('PDF 发送方式。如果 Koishi 与 Bot 客户端不在同一设备/容器，请选择 buffer；若选择 file 模式，文件将保存到指定目录中转。')
      .default('buffer'),
    fileSendPath: Schema.string()
      .description('PDF 发送方式为 file 时的本地中转保存目录')
      .default('/koishi/temp'),
  }),
  Schema.object({
    comicSearchTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_search 工具'),
      name: Schema.string().default('comic_search').description('工具名称'),
      description: Schema.string()
        .default('搜索漫画。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。返回匹配的漫画列表(含ID、标题、作者)。搜索到结果后，立即调用 comic_download 下载第一个匹配项；下载完成后最终回复必须包含工具返回的解密密码。一条消息列出所有结果名+已下载标题+密码。如果搜索无结果，尝试用更简短的关键词重试，或告知用户未找到。')
        .description('工具描述'),
    }).description('comic_search 工具'),
  }),
  Schema.object({
    comicDetailTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_detail 工具'),
      name: Schema.string().default('comic_detail').description('工具名称'),
      description: Schema.string()
        .default('查看漫画详情(标题、作者、简介、章节列表)。仅在用户明确要求查看详情时使用。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。')
        .description('工具描述'),
    }).description('comic_detail 工具'),
  }),
  Schema.object({
    comicLeaderboardTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_leaderboard 工具'),
      name: Schema.string().default('comic_leaderboard').description('工具名称'),
      description: Schema.string()
        .default('查看漫画排行榜(日榜/周榜/月榜/总榜)。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。')
        .description('工具描述'),
    }).description('comic_leaderboard 工具'),
  }),
  Schema.object({
    comicLatestTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_latest 工具'),
      name: Schema.string().default('comic_latest').description('工具名称'),
      description: Schema.string()
        .default('查看最近更新的漫画。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。')
        .description('工具描述'),
    }).description('comic_latest 工具'),
  }),
  Schema.object({
    comicRandomTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_random 工具'),
      name: Schema.string().default('comic_random').description('工具名称'),
      description: Schema.string()
        .default('随机推荐漫画。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。')
        .description('工具描述'),
    }).description('comic_random 工具'),
  }),
  Schema.object({
    comicDownloadTool: Schema.object({
      enabled: Schema.boolean().default(true).description('是否注册 comic_download 工具'),
      name: Schema.string().default('comic_download').description('工具名称'),
      description: Schema.string()
        .default('下载漫画/本子为加密PDF并发送给用户。调用后会自动发送PDF文件，并额外发送一条「解密密码」消息（系统已发出，无需你再编造密码）。工具返回的 JSON 含 success/title/password，你必须原样引用 password 字段。最终回复必须包含密码，格式示例：「搜索到 N 个结果：《title1》《title2》...，已下载《title1》，解密密码：123456。如需其他本子请发送本子名」。禁止省略密码；禁止说「文件已发送」却不报密码。用户说"想看xx""来个本子""下载xx"时，先 comic_search，再用第一个匹配 ID 调用本工具。不要分多条消息叙述中间步骤。')
        .description('工具描述'),
    }).description('comic_download 工具'),
  }),
])

// ============ Zod Schemas ============

const comicSearchSchema = z.object({
  keyword: z.string().describe('搜索关键词，可以是漫画名、角色名、画师/作者名等'),
  source: z.enum(['jm', 'bika']).optional()
    .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则自动搜索两个平台'),
})

const comicDetailSchema = z.object({
  comic_id: z.string().describe('漫画ID'),
  source: z.enum(['jm', 'bika']).optional()
    .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则自动检测'),
})

const comicLeaderboardSchema = z.object({
  mode: z.enum(['day', 'week', 'month', 'total']).optional()
    .describe('排行榜类型：day=日榜(默认), week=周榜, month=月榜, total=总榜'),
  source: z.enum(['jm', 'bika']).optional()
    .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则返回双平台排行榜'),
  page: z.number().int().min(1).optional()
    .describe('页码，默认1'),
})

const comicLatestSchema = z.object({
  source: z.enum(['jm', 'bika']).optional()
    .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则返回双平台最近更新'),
})

const comicRandomSchema = z.object({
  source: z.enum(['jm', 'bika']).optional()
    .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则返回双平台随机推荐'),
})

const comicDownloadSchema = z.object({
  comic_id: z.string().describe('漫画ID（从comic_search返回结果中获取）'),
  chapter_id: z.string().optional()
    .describe('章节ID，不填默认下载第一话'),
  source: z.enum(['jm', 'bika']).optional()
    .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则自动检测'),
})

// ============ 辅助函数 ============

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

function determineSource(id: string): { source: 'jm' | 'bika'; id: string } | null {
  const clean = id.trim()
  const hasJm = /jm/i.test(clean) || /禁漫/i.test(clean)
  const digitMatch = clean.match(/\d+/)
  if (hasJm && digitMatch) {
    return { source: 'jm', id: digitMatch[0] }
  }
  if (/^\d+$/.test(clean)) {
    return { source: 'jm', id: clean }
  }
  if (/^[0-9a-fA-F]{24}$/.test(clean)) {
    return { source: 'bika', id: clean }
  }
  return null
}

interface ComicItem {
  id: string
  title: string
  author?: string
  source?: string
  cover?: string
}

interface SearchResult {
  keyword: string
  best_match: ComicItem | null
  all_results: {
    jm: ComicItem[]
    bika: ComicItem[]
  }
}

interface ComicDetail {
  title: string
  author?: string
  description?: string
  cover?: string
  source?: string
  chapters: { id: string; name: string }[]
}

interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

interface DownloadResult {
  success: boolean
  title: string
  password: string
  chapterName: string
  totalChapters: number
  chapters: { id: string; name: string }[]
  error?: string
}

// ============ 主逻辑 ============

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('comic')

  async function apiGet<T = any>(path: string, params?: Record<string, string>): Promise<T> {
    let url = config.apiBase.replace(/\/+$/, '') + path
    if (params) {
      const qs = new URLSearchParams(params).toString()
      if (qs) url += '?' + qs
    }
    if (config.logInfo) logger.info(`GET ${url}`)
    try {
      const res = await ctx.http.get(url)
      if (res && typeof res === 'object' && (res as any).success === false) {
        const msg = (res as any).error || '后端返回未知错误'
        logger.warn(`API 返回失败 [${url}]: ${msg}`)
        throw new Error(msg)
      }
      return res as T
    } catch (err: any) {
      logger.error(`API 请求失败 [${url}]: ${err.message}`)
      throw err
    }
  }

  // ========== 核心下载函数（命令和工具共用） ==========
  async function doDownload(
    session: any,
    id: string,
    chapterId: string | undefined,
    opts?: { silent?: boolean }
  ): Promise<DownloadResult> {
    const silent = opts?.silent ?? false

    // 1. 解析来源与 ID
    let source: 'jm' | 'bika'
    let targetId: string
    const resolved = determineSource(id)
    if (resolved) {
      source = resolved.source
      targetId = resolved.id
    } else {
      if (!silent) await session.send(`正在搜索并解析本子名「${id}」...`)
      try {
        const searchResult = await apiGet<SearchResult>('/api/search', { keyword: id })
        const jmList = searchResult.all_results?.jm || []
        const bikaList = searchResult.all_results?.bika || []
        if (jmList.length > 0) {
          source = 'jm'
          targetId = jmList[0].id
        } else if (bikaList.length > 0) {
          source = 'bika'
          targetId = bikaList[0].id
        } else {
          return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: '未找到相关漫画' }
        }
      } catch (err: any) {
        return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: `搜索本子名失败: ${err.message}` }
      }
    }

    // 2. 获取详情
    if (!silent) await session.send('正在获取漫画详情...')
    let detail: ComicDetail
    try {
      detail = await apiGet<ComicDetail>(`/api/comic/${source}/${targetId}`)
    } catch (e: any) {
      return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: `获取详情失败: ${e.message}` }
    }
    if (!detail?.title) {
      const srcLabel = source === 'jm' ? '禁漫天堂' : '哔咔漫画'
      return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: `未找到该漫画 [${srcLabel} ID: ${targetId}]` }
    }
    if (!detail.chapters?.length) {
      return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: '该漫画没有可下载的章节' }
    }

    // 3. 确定章节
    const chapter = chapterId
      ? detail.chapters.find(c => c.id === chapterId)
      : detail.chapters[0]
    if (!chapter) {
      return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: `未找到章节 ${chapterId}` }
    }

    const chapterName = chapter.name
    const totalChapters = detail.chapters.length
    const pdfPassword = config.pdfPassword || getPdfPassword(source, targetId, chapter.id)

    // 4. 下载 PDF
    if (!silent) {
      if (!chapterId && totalChapters > 1) {
        await session.send(`该漫画共 ${totalChapters} 话，正在下载第一话: ${chapterName}`)
      } else {
        await session.send(`正在下载「${detail.title} - ${chapterName}」...`)
      }
    }

    const downloadUrl = config.apiBase.replace(/\/+$/, '')
      + `/api/download/${source}/${targetId}/${chapter.id}`
      + `?title=${encodeURIComponent(detail.title)}`
      + `&chapter=${encodeURIComponent(chapterName)}`
      + `&password=${encodeURIComponent(pdfPassword)}`
      + `&concurrency=${config.concurrency}`

    if (config.logInfo) logger.info(`Downloading: ${downloadUrl}`)

    const response = await ctx.http.get(downloadUrl, { responseType: 'arraybuffer' })
    const buffer = Buffer.from(response)

    if (buffer.length < 100) {
      return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: '下载失败：返回数据异常' }
    }

    // 5. 发送文件
    const cleanTitle = source === 'jm' ? `jm${targetId}` : sanitizeFilename(detail.title)
    const filename = `${cleanTitle}.pdf`

    try {
      if (config.pdfSendMethod === 'file') {
        const tempDir = config.fileSendPath || '/koishi/temp'
        await fs.promises.mkdir(tempDir, { recursive: true })
        const tempFilePath = path.join(tempDir, filename)
        await fs.promises.writeFile(tempFilePath, buffer)
        const fileUrl = pathToFileURL(tempFilePath).href
        await session.send(h.file(fileUrl))
      } else {
        await session.send(h.file(buffer, 'application/pdf', { filename }))
      }
    } catch (sendErr: any) {
      logger.warn('发送 PDF 文件失败，尝试提供直接下载链接:', sendErr.message)
      return { success: false, title: detail.title, password: pdfPassword, chapterName, totalChapters, chapters: detail.chapters, error: `发送文件失败，请手动下载: ${downloadUrl}` }
    }

    return {
      success: true,
      title: detail.title,
      password: pdfPassword,
      chapterName,
      totalChapters,
      chapters: detail.chapters,
    }
  }

  const SUBCOMMANDS = ['search', 'download', 'detail', 'leaderboard', 'latest', 'random']

  // Parent command 'comic' routing logic
  ctx.command('comic [keyword:text]', '聚合漫画搜索与直接下载')
    .action(async ({ session }, keyword) => {
      if (!session) return
      if (!keyword) {
        return session.execute('help comic')
      }
      const clean = keyword.trim()

      const parts = clean.split(/\s+/)
      const firstWord = parts[0].toLowerCase()
      if (SUBCOMMANDS.includes(firstWord)) {
        const rest = parts.slice(1).join(' ')
        return session.execute(`comic.${firstWord}${rest ? ' ' + rest : ''}`)
      }

      const resolved = determineSource(clean)
      if (resolved) {
        if (resolved.source === 'jm' && parseInt(resolved.id, 10) <= 100) {
          return session.execute(`comic.search ${keyword}`)
        }
        return session.execute(`comic.download ${resolved.id}`)
      }

      return session.execute(`comic.search ${keyword}`)
    })

  async function buildDetailText(source: string, id: string): Promise<string | null> {
    try {
      const detail = await apiGet<ComicDetail>(`/api/comic/${source}/${id}`)
      if (!detail?.title) return null

      const srcLabel = source === 'jm' ? '禁漫天堂' : '哔咔漫画'
      const parts = [
        `📖 ${detail.title}`,
        `来源: ${srcLabel} | ID: ${id}`,
        `作者: ${detail.author || '佚名'}`,
        `简介: ${(detail.description || '无描述').slice(0, 200)}`,
        `章节数: ${detail.chapters?.length || 0}`,
      ]

      if (detail.chapters?.length > 0) {
        const first = detail.chapters[0]
        parts.push(`第一话: [${first.id}] ${first.name}`)
        if (detail.chapters.length > 1) {
          parts.push(`共 ${detail.chapters.length} 话，如需下载请使用 comic download <ID> [章节ID]`)
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

  // comic search <keyword>
  ctx.command('comic.search <keyword:text>', '聚合搜索漫画')
    .action(async ({ session }, keyword) => {
      if (!keyword) return '请输入搜索关键词'

      try {
        let result: SearchResult
        const resolved = determineSource(keyword)
        if (resolved) {
          try {
            const detail = await apiGet<ComicDetail>(`/api/comic/${resolved.source}/${resolved.id}`)
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
                all_results: {
                  jm: resolved.source === 'jm' ? [mockItem] : [],
                  bika: resolved.source === 'bika' ? [mockItem] : []
                }
              }
            } else {
              result = await apiGet<SearchResult>('/api/search', { keyword })
            }
          } catch {
            result = await apiGet<SearchResult>('/api/search', { keyword })
          }
        } else {
          result = await apiGet<SearchResult>('/api/search', { keyword })
        }

        const jmItems = (result.all_results?.jm || []).slice(0, 8).map(c => ({ ...c, source: 'jm' }))
        const bikaItems = (result.all_results?.bika || []).slice(0, 8).map(c => ({ ...c, source: 'bika' }))
        const totalResults = jmItems.length + bikaItems.length

        if (totalResults === 0) {
          return `没有找到关于「${keyword}」的漫画。`
        }

        const all: (ComicItem & { source: string })[] = []
        const jmLines: string[] = []
        const bikaLines: string[] = []
        let idx = 1
        for (const item of jmItems) {
          all.push(item)
          jmLines.push(`${idx}. [禁漫天堂] ${item.title}  作者:${item.author || '佚名'} (ID: ${item.id})`)
          idx++
        }
        for (const item of bikaItems) {
          all.push(item)
          bikaLines.push(`${idx}. [哔咔漫画] ${item.title}  作者:${item.author || '佚名'} (ID: ${item.id})`)
          idx++
        }

        if (!session) {
          const lines: string[] = []
          if (jmLines.length) lines.push('【 禁漫天堂 (JMComic) 】', ...jmLines)
          if (bikaLines.length) lines.push('【 哔咔漫画 (Bika) 】', ...bikaLines)
          return lines.join('\n')
        }

        const msgElements = []
        let header = `🔍 关键词「${keyword}」共找到 ${totalResults} 个结果`
        if (result.best_match?.title) {
          const bm = result.best_match
          const bmLabel = bm.source === 'jm' ? '禁漫天堂' : '哔咔漫画'
          header += `\n🏆 最佳匹配 [${bmLabel}]: ${bm.title}`
        }
        msgElements.push(h('message', header))
        if (jmLines.length) {
          msgElements.push(h('message', `【 禁漫天堂 (JMComic) 】\n${jmLines.join('\n')}`))
        }
        if (bikaLines.length) {
          msgElements.push(h('message', `【 哔咔漫画 (Bika) 】\n${bikaLines.join('\n')}`))
        }
        msgElements.push(h('message', '💡 回复序号下载（如 1），或回复「源|ID」（如 禁漫天堂|12345），回复其他内容退出。'))

        await session.send(h('message', { forward: true }, msgElements))

        const answer = await session.prompt(30000)
        if (!answer) return
        const cleanAnswer = answer.trim()
        let targetId = ''

        const index = parseInt(cleanAnswer, 10)
        if (!isNaN(index) && index > 0 && index <= all.length && /^\d+$/.test(cleanAnswer)) {
          targetId = all[index - 1].id
        } else {
          const match = cleanAnswer.match(/^(?:禁漫天堂|哔咔漫画|禁漫|哔咔|jm|bika)[|｜](.+)$/i)
          if (match) {
            targetId = match[1].trim()
          } else {
            return
          }
        }

        if (targetId) {
          return session.execute(`comic.download ${targetId}`)
        }
        return
      } catch (err: any) {
        logger.error('搜索失败:', err.message)
        return `搜索失败: ${err.message}`
      }
    })

  // comic download <id> [chapterId]
  ctx.command('comic.download <id:string> [chapterId:string]', '下载漫画PDF')
    .action(async ({ session }, id, chapterId) => {
      if (!id) return '用法: comic download <ID> [章节ID]'
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
      if (!query) return '用法: comic detail <关键词> 或 comic detail <ID>'
      if (!session) return '此命令仅支持在会话中使用'

      const resolved = determineSource(query)
      if (resolved) {
        return fetchAndShowDetail(session, resolved.source, resolved.id)
      }

      try {
        await session.send('正在搜索并获取详情...')
        const result = await apiGet<SearchResult>('/api/search', { keyword: query })
        const jmBest = (result.all_results?.jm || [])[0]
        const bikaBest = (result.all_results?.bika || [])[0]

        if (!jmBest && !bikaBest) {
          return `没有找到关于「${query}」的漫画。`
        }

        const [jmText, bikaText] = await Promise.all([
          jmBest ? buildDetailText('jm', jmBest.id) : Promise.resolve(null),
          bikaBest ? buildDetailText('bika', bikaBest.id) : Promise.resolve(null),
        ])

        const msgElements = [
          h('message', `🔍 关键词「${query}」各平台最相似结果详情：`),
        ]
        msgElements.push(h('message', jmText || '【 禁漫天堂 】无匹配结果'))
        msgElements.push(h('message', bikaText || '【 哔咔漫画 】无匹配结果(或需先登录)'))

        await session.send(h('message', { forward: true }, msgElements))
        return
      } catch (err: any) {
        logger.error('详情搜索失败:', err.message)
        return `查询失败: ${err.message}`
      }
    })

  // comic leaderboard [mode] [page]
  ctx.command('comic.leaderboard [mode:string] [page:number]', '查看排行榜')
    .action(async ({ session }, mode, page) => {
      if (!session) return '此命令仅支持在会话中使用'
      const targetMode = (mode || 'day').toLowerCase()
      if (!['day', 'week', 'month', 'total'].includes(targetMode)) {
        return 'mode 必须是 day/week/month/total'
      }
      const targetPage = Math.max(1, Math.floor(page || 1))
      const query = { mode: targetMode, page: String(targetPage) }

      try {
        const [jmResult, bikaResult] = await Promise.all([
          apiGet<ApiResponse<ComicItem[]>>('/api/jm/leaderboard', query).catch(() => null),
          apiGet<ApiResponse<ComicItem[]>>('/api/bika/leaderboard', query).catch(() => null),
        ])

        const modeMap: Record<string, string> = { day: '日榜', week: '周榜', month: '月榜', total: '总榜' }

        const formatList = (comics: ComicItem[]): string => {
          if (!comics || comics.length === 0) return '暂无数据或获取失败'
          return comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`).join('\n')
        }

        const jmOk = jmResult && jmResult.success !== false && jmResult.data?.length
        const bikaOk = bikaResult && bikaResult.success !== false && bikaResult.data?.length
        const jmText = `【 禁漫天堂 (JMComic) ${modeMap[targetMode]} · 第${targetPage}页 】\n` + (jmOk ? formatList(jmResult!.data!) : '暂无数据或获取失败')
        const bikaModeLabel = targetMode === 'total' ? '日榜(哔咔无总榜)' : modeMap[targetMode]
        const bikaText = `【 哔咔漫画 (Bika) ${bikaModeLabel} · 第${targetPage}页 】\n` + (bikaOk ? formatList(bikaResult!.data!) : '暂无数据或获取失败(哔咔需先登录)')

        await session.send(jmText)
        await session.send(bikaText)
        return
      } catch (err: any) {
        logger.error('获取排行榜失败:', err.message)
        return `获取排行榜失败: ${err.message}`
      }
    })

  async function fetchUpTo(source: string, endpoint: string, limit: number, maxPages = 5): Promise<ComicItem[]> {
    const acc: ComicItem[] = []
    for (let page = 1; page <= maxPages && acc.length < limit; page++) {
      let res: ApiResponse<ComicItem[]> | null = null
      try {
        res = await apiGet<ApiResponse<ComicItem[]>>(`/api/${source}/${endpoint}`, { page: String(page) })
      } catch {
        break
      }
      if (!res || res.success === false || !res.data?.length) break
      acc.push(...res.data)
      if (res.data.length === 0) break
    }
    return acc.slice(0, limit)
  }

  // comic latest
  ctx.command('comic.latest', '查看最近更新')
    .alias('最新漫画')
    .alias('漫画更新')
    .option('number', '-n <count:number> 每个平台显示数量(默认10，最多50)')
    .action(async ({ session, options }) => {
      if (!session) return '此命令仅支持在会话中使用'
      const limit = Math.min(50, Math.max(1, Math.floor(options?.number || 10)))

      try {
        const [jmItems, bikaItems] = await Promise.all([
          fetchUpTo('jm', 'latest', limit).catch(() => []),
          fetchUpTo('bika', 'latest', limit).catch(() => []),
        ])

        const formatList = (comics: ComicItem[]): string => {
          if (!comics || comics.length === 0) return '暂无数据或获取失败'
          return comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`).join('\n')
        }

        const jmText = `【 禁漫天堂 (JMComic) 最近更新 · ${jmItems.length}条 】\n` + formatList(jmItems)
        const bikaText = `【 哔咔漫画 (Bika) 最近更新 · ${bikaItems.length}条 】\n` + (bikaItems.length ? formatList(bikaItems) : '暂无数据或获取失败(哔咔需先登录)')

        await session.send(jmText)
        await session.send(bikaText)
        return
      } catch (err: any) {
        logger.error('获取最近更新失败:', err.message)
        return `获取最近更新失败: ${err.message}`
      }
    })

  async function fetchRandomUpTo(source: string, limit: number, maxTries = 4): Promise<ComicItem[]> {
    const map = new Map<string, ComicItem>()
    for (let i = 0; i < maxTries && map.size < limit; i++) {
      let res: ApiResponse<ComicItem[]> | null = null
      try {
        res = await apiGet<ApiResponse<ComicItem[]>>(`/api/${source}/random`)
      } catch {
        break
      }
      if (!res || res.success === false || !res.data?.length) break
      for (const item of res.data) {
        if (item?.id && !map.has(item.id)) map.set(item.id, item)
      }
    }
    return Array.from(map.values()).slice(0, limit)
  }

  // comic random
  ctx.command('comic.random', '随机推荐漫画')
    .alias('随机漫画')
    .option('number', '-n <count:number> 每个平台推荐数量(默认5，最多20)')
    .action(async ({ session, options }) => {
      const limit = Math.min(20, Math.max(1, Math.floor(options?.number || 5)))

      const [jmItems, bikaItems] = await Promise.all([
        fetchRandomUpTo('jm', limit).catch(() => []),
        fetchRandomUpTo('bika', limit).catch(() => []),
      ])

      const formatList = (comics: ComicItem[], label: string): string => {
        if (!comics || comics.length === 0) return `【 ${label} 】暂无数据或获取失败`
        const lines = comics.map((c, i) => `${i + 1}. [${label}] ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`)
        return `🎲 ${label} 随机推荐 · ${comics.length}个\n${lines.join('\n')}`
      }

      const jmText = formatList(jmItems, '禁漫天堂')
      const bikaText = bikaItems.length ? formatList(bikaItems, '哔咔漫画') : '🎲 哔咔漫画 随机推荐\n暂无数据或获取失败(哔咔需先登录)'

      if (session) {
        await session.send(jmText)
        await session.send(bikaText)
        await session.send('💡 如需下载，请使用 comic download <ID>')
        return
      }
      return [jmText, '', bikaText].join('\n')
    })

  // ========== 工具创建函数 ==========

  function createToolApi(cfg: Config) {
    const apiBase = cfg.apiBase.replace(/\/+$/, '')
    return async <T = any>(path: string, params?: Record<string, string>): Promise<T> => {
      let url = apiBase + path
      if (params) {
        const qs = new URLSearchParams(params).toString()
        if (qs) url += '?' + qs
      }
      return ctx.http.get(url) as Promise<T>
    }
  }

  function createComicSearchTool(cfg: Config) {
    const toolCfg = cfg.comicSearchTool
    return tool(async (input: z.infer<typeof comicSearchSchema>) => {
      const apiGetTool = createToolApi(cfg)
      try {
        if (!input.keyword) {
          return JSON.stringify({ error: '搜索时 keyword 不能为空' })
        }
        const source = input.source
        let result: SearchResult
        if (source) {
          result = await apiGetTool<SearchResult>('/api/search', { keyword: input.keyword, source })
        } else {
          result = await apiGetTool<SearchResult>('/api/search', { keyword: input.keyword })
        }
        const jmList = result.all_results?.jm || []
        const bikaList = result.all_results?.bika || []
        const all = [
          ...jmList.map(c => ({ ...c, source: 'jm' })),
          ...bikaList.map(c => ({ ...c, source: 'bika' })),
        ]
        // 返回前5条（含标题），让AI在最终回复中列出名字供用户参考
        return JSON.stringify({
          keyword: input.keyword,
          best_match: result.best_match,
          total: all.length,
          results: all.slice(0, 5),
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
      const apiGetTool = createToolApi(cfg)
      try {
        if (!input.comic_id) {
          return JSON.stringify({ error: '查看详情时 comic_id 不能为空' })
        }
        const resolved = determineSource(input.comic_id)
        const source = input.source || resolved?.source || 'jm'
        const id = resolved?.id || input.comic_id
        const detail = await apiGetTool<ComicDetail>(`/api/comic/${source}/${id}`)
        if (!detail?.title) {
          return JSON.stringify({ error: '未找到该漫画' })
        }
        return JSON.stringify({
          title: detail.title,
          author: detail.author,
          description: detail.description,
          source: detail.source || source,
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
      const apiGetTool = createToolApi(cfg)
      try {
        const mode = input.mode || 'day'
        const page = String(input.page || 1)
        const source = input.source

        if (source) {
          const result = await apiGetTool<ApiResponse<ComicItem[]>>(`/api/${source}/leaderboard`, { mode, page })
          return JSON.stringify({
            source,
            mode,
            page: Number(page),
            total: result.data?.length || 0,
            results: result.data || [],
          })
        } else {
          const [jmResult, bikaResult] = await Promise.all([
            apiGetTool<ApiResponse<ComicItem[]>>(`/api/jm/leaderboard`, { mode, page }).catch(() => null),
            apiGetTool<ApiResponse<ComicItem[]>>(`/api/bika/leaderboard`, { mode, page }).catch(() => null),
          ])
          return JSON.stringify({
            mode,
            page: Number(page),
            jm: {
              total: jmResult?.data?.length || 0,
              results: jmResult?.data || [],
            },
            bika: {
              total: bikaResult?.data?.length || 0,
              results: bikaResult?.data || [],
            },
          })
        }
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
      const apiGetTool = createToolApi(cfg)
      try {
        const source = input.source
        if (source) {
          const result = await apiGetTool<ApiResponse<ComicItem[]>>(`/api/${source}/latest`, { page: '1' })
          return JSON.stringify({
            source,
            total: result.data?.length || 0,
            results: result.data || [],
          })
        } else {
          const [jmResult, bikaResult] = await Promise.all([
            apiGetTool<ApiResponse<ComicItem[]>>('/api/jm/latest', { page: '1' }).catch(() => null),
            apiGetTool<ApiResponse<ComicItem[]>>('/api/bika/latest', { page: '1' }).catch(() => null),
          ])
          return JSON.stringify({
            jm: {
              total: jmResult?.data?.length || 0,
              results: jmResult?.data || [],
            },
            bika: {
              total: bikaResult?.data?.length || 0,
              results: bikaResult?.data || [],
            },
          })
        }
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
      const apiGetTool = createToolApi(cfg)
      try {
        const source = input.source
        if (source) {
          const result = await apiGetTool<ApiResponse<ComicItem[]>>(`/api/${source}/random`)
          return JSON.stringify({
            source,
            result: result.data || null,
          })
        } else {
          const [jmResult, bikaResult] = await Promise.all([
            apiGetTool<ApiResponse<ComicItem[]>>('/api/jm/random').catch(() => null),
            apiGetTool<ApiResponse<ComicItem[]>>('/api/bika/random').catch(() => null),
          ])
          return JSON.stringify({
            jm: jmResult?.data || null,
            bika: bikaResult?.data || null,
          })
        }
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

        const result = await doDownload(session, input.comic_id, input.chapter_id, { silent: true })

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
      tags: ['comic', 'manga', 'jmcomic', 'bika'],
      defaultAvailability: {
        enabled: true,
        main: true,
        chatluna: true,
        characterScope: 'all' as const,
      },
    }

    const tools = [
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
