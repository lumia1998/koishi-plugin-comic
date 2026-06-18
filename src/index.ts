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
    chatluna?: {
      platform: {
        registerTool(name: string, options: any): void
      }
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

export interface Config {
  apiBase: string
  concurrency: number
  logInfo: boolean
  pdfPassword?: string
  pdfSendMethod: 'buffer' | 'file'
  fileSendPath: string
  tool: {
    enabled: boolean
    name: string
    description: string
  }
}

export const Config = Schema.object({
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
  tool: Schema.object({
    enabled: Schema.boolean().default(true).description('开启后自动注册 ChatLuna 工具'),
    name: Schema.string().default('comic').description('工具名称'),
    description: Schema.string()
      .default('漫画搜索与下载工具。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。包含动作：search (搜索), detail (查看详情), leaderboard (排行榜), latest (最近更新), random (随机推荐), download (下载本子并发送)。提示：如果用户给出的本子名、角色名或关键词模糊、包含缩写或拼写不够精确，或者使用该工具搜索未返回结果，你必须先调用联网搜索工具检索获取该本子的准确正式名称、画师/作者或完整标题，然后再用精准的关键词调用此工具。')
      .description('工具描述'),
  }).description('ChatLuna 工具设置'),
})

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
      // 后端统一错误格式：{ success: false, error: '...' }
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

  // 子命令关键词集合，用于父命令路由时排除（避免被当作搜索词/下载ID）
  const SUBCOMMANDS = ['search', 'download', 'detail', 'leaderboard', 'latest', 'random']

  // Parent command 'comic' routing logic
  ctx.command('comic [keyword:text]', '聚合漫画搜索与直接下载')
    .action(async ({ session }, keyword) => {
      if (!session) return
      if (!keyword) {
        return session.execute('help comic')
      }
      const clean = keyword.trim()

      // 关键修复：当 keyword 以子命令名开头时，强制用点号形式转发到子命令。
      // Koishi 的 `comic [keyword:text]` 贪婪参数会吞掉 `comic random` / `comic latest`
      // 这类无参子命令，导致它们被当作搜索词处理。
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

      // Fallback to search
      return session.execute(`comic.search ${keyword}`)
    })

  // 构建单个漫画的详情文本；失败返回 null
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

        // 各平台最多取 8 条
        const jmItems = (result.all_results?.jm || []).slice(0, 8).map(c => ({ ...c, source: 'jm' }))
        const bikaItems = (result.all_results?.bika || []).slice(0, 8).map(c => ({ ...c, source: 'bika' }))
        const totalResults = jmItems.length + bikaItems.length

        if (totalResults === 0) {
          return `没有找到关于「${keyword}」的漫画。`
        }

        // 统一编号：禁漫在前，哔咔在后，供回复序号下载
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
          // 无会话环境（理论上不会发生），降级为纯文本
          const lines: string[] = []
          if (jmLines.length) lines.push('【 禁漫天堂 (JMComic) 】', ...jmLines)
          if (bikaLines.length) lines.push('【 哔咔漫画 (Bika) 】', ...bikaLines)
          return lines.join('\n')
        }

        // 合并转发：禁漫一条、哔咔一条
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
            return // 非有效输入，退出
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

      let source: 'jm' | 'bika'
      let targetId = id

      const resolved = determineSource(id)
      if (resolved) {
        source = resolved.source
        targetId = resolved.id
      } else {
        await session.send(`正在搜索并解析本子名「${id}」...`)
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
            return '未找到相关漫画，请尝试其他关键词或输入正确的ID。'
          }
        } catch (err: any) {
          return `搜索本子名失败: ${err.message}`
        }
      }

      try {
        await session.send('正在获取漫画详情...')

        let detail: ComicDetail
        try {
          detail = await apiGet<ComicDetail>(`/api/comic/${source}/${targetId}`)
        } catch (e: any) {
          return `获取详情失败（后端请求出错）：${e.message}\n可能原因：comic-api 未启动、源站反爬拦截或 ID 不存在。`
        }
        if (!detail?.title) {
          const srcLabel = source === 'jm' ? '禁漫天堂' : '哔咔漫画'
          return `未找到该漫画 [${srcLabel} ID: ${targetId}]\n请确认 ID 是否正确；若是哔咔需先登录，禁漫可能被源站临时拦截。`
        }
        if (!detail.chapters?.length) return '该漫画没有可下载的章节'

        const chapter = chapterId
          ? detail.chapters.find(c => c.id === chapterId)
          : detail.chapters[0]

        if (!chapter) return `未找到章节 ${chapterId}`

        const chapterName = chapter.name
        const totalChapters = detail.chapters.length

        if (!chapterId && totalChapters > 1) {
          await session.send(`该漫画共 ${totalChapters} 话，正在下载第一话: ${chapterName}`)
        }

        await session.send(`正在下载「${detail.title} - ${chapterName}」...`)

        const pdfPassword = config.pdfPassword || getPdfPassword(source, targetId, chapter.id)

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
          return '下载失败：返回数据异常'
        }

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
          await session.send(`🔑 该 PDF 已加密，解密密码为：${pdfPassword}`)
        } catch (sendErr: any) {
          logger.warn('发送 PDF 文件失败，尝试提供直接下载链接:', sendErr.message)
          await session.send(`⚠️ 发送 PDF 文件失败，请通过以下链接直接下载：\n🔗 ${downloadUrl}\n🔑 解密密码为：${pdfPassword}`)
        }

        if (totalChapters > 1 && !chapterId) {
          return `这是第一话，共 ${totalChapters} 话。如需其他话请指定章节ID。\n章节列表:\n${
            detail.chapters.slice(0, 20).map((ch, i) => `${i + 1}. [${ch.id}] ${ch.name}`).join('\n')
          }${totalChapters > 20 ? `\n... 共 ${totalChapters} 话` : ''}`
        }

        return '下载完成！'
      } catch (err: any) {
        logger.error('下载失败:', err.message)
        return `下载失败: ${err.message}`
      }
    })

  // comic detail <id>
  ctx.command('comic.detail <id:text>', '查看漫画详情')
    .action(async ({ session }, query) => {
      if (!query) return '用法: comic detail <关键词> 或 comic detail <ID>'
      if (!session) return '此命令仅支持在会话中使用'

      // 直接给定 ID/源：只查该来源
      const resolved = determineSource(query)
      if (resolved) {
        return fetchAndShowDetail(session, resolved.source, resolved.id)
      }

      // 关键词模式：禁漫和哔咔各取 best 匹配，分别展示详情
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
      // 未指定类型默认日榜（最新的当日榜单）
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
        // 哔咔无总榜，自动回退日榜
        const bikaModeLabel = targetMode === 'total' ? '日榜(哔咔无总榜)' : modeMap[targetMode]
        const bikaText = `【 哔咔漫画 (Bika) ${bikaModeLabel} · 第${targetPage}页 】\n` + (bikaOk ? formatList(bikaResult!.data!) : '暂无数据或获取失败(哔咔需先登录)')

        // 禁漫、哔咔分成 2 条独立消息发送
        await session.send(jmText)
        await session.send(bikaText)
        return
      } catch (err: any) {
        logger.error('获取排行榜失败:', err.message)
        return `获取排行榜失败: ${err.message}`
      }
    })

  // 翻页累积拉取，直到达到 limit 条或没有更多（最多翻 maxPages 页防止狂刷后端）
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

        // 禁漫、哔咔分成 2 条独立消息发送
        await session.send(jmText)
        await session.send(bikaText)
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
        // 禁漫、哔咔分成 2 条独立消息发送
        await session.send(jmText)
        await session.send(bikaText)
        await session.send('💡 如需下载，请使用 comic download <ID>')
        return
      }
      return [jmText, '', bikaText].join('\n')
    })

  // ========== ChatLuna 工具注册 ==========
  ctx.on('ready', async () => {
    if (!config.tool.enabled) return
    if (!ctx.chatluna) {
      logger.info('chatluna 未安装，跳过注册 ChatLuna 工具')
      return
    }
    const toolName = (config.tool.name || 'comic').trim() || 'comic'
    ctx.chatluna.platform.registerTool(toolName, {
      description: config.tool.description || '漫画搜索与下载工具',
      selector() {
        return true
      },
      createTool() {
        return createComicTool(ctx, config)
      },
      meta: {
        source: 'extension',
        group: 'comic',
        tags: ['comic', 'manga', 'jmcomic', 'bika'],
        defaultAvailability: {
          enabled: true,
          main: true,
          chatluna: true,
          characterScope: 'all',
        },
      },
    })
    logger.info(`ChatLuna 工具「${toolName}」已注册`)
  })

}

const comicToolSchema = z.object({
  action: z.enum(['search', 'detail', 'leaderboard', 'latest', 'random', 'download'])
    .describe('操作类型：search=搜索, detail=详情, leaderboard=排行榜, latest=最近更新, random=随机推荐, download=下载漫画/本子并发送给用户'),
  keyword: z.string().optional()
    .describe('搜索关键词（action=search 时必填）'),
  source: z.enum(['jm', 'bika']).optional()
    .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则根据需要自动检测或使用默认源'),
  comic_id: z.string().optional()
    .describe('漫画ID（action=detail 或 action=download 时必填）'),
  chapter_id: z.string().optional()
    .describe('章节ID（action=download 时选填，不填默认下载第一话）'),
  mode: z.enum(['day', 'week', 'month', 'total']).optional()
    .describe('排行榜时间维度（action=leaderboard 时使用）：day=日榜, week=周榜, month=月榜, total=总榜'),
  page: z.number().int().min(1).optional()
    .describe('页码，默认1'),
})

function createComicTool(ctx: Context, cfg: Config) {
  const description = (cfg.tool.description || '').trim() || '漫画搜索与下载工具。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。包含动作：search (搜索), detail (查看详情), leaderboard (排行榜), latest (最近更新), random (随机推荐), download (下载本子并发送)。提示：如果用户给出的本子名、角色名或关键词模糊、包含缩写或拼写不够精确，或者使用该工具搜索未返回结果，你必须先调用联网搜索工具检索获取该本子的准确正式名称、画师/作者或完整标题，然后再用精准的关键词调用此工具。'
  const name = (cfg.tool.name || 'comic').trim() || 'comic'

  return tool(async (input: any, runConfig?: any) => {
    const logger = ctx.logger('comic')
    const source = input.source || 'jm'
    const apiBase = cfg.apiBase.replace(/\/+$/, '')

    const apiGet = async <T = any>(path: string, params?: Record<string, string>): Promise<T> => {
      let url = apiBase + path
      if (params) {
        const qs = new URLSearchParams(params).toString()
        if (qs) url += '?' + qs
      }
      return ctx.http.get(url) as Promise<T>
    }

    try {
      switch (input.action) {
        case 'download': {
          if (!input.comic_id) {
            return JSON.stringify({ error: '下载漫画时 comic_id 不能为空' })
          }
          const session = runConfig?.configurable?.session
          if (!session) {
            return JSON.stringify({ error: '无法获取当前会话，不支持下载操作。请让用户在聊天界面直接使用 comic 命令或 comic.download 命令手动下载。' })
          }
          const cmd = input.chapter_id ? `comic.download ${input.comic_id} ${input.chapter_id}` : `comic.download ${input.comic_id}`
          session.execute(cmd)
          return JSON.stringify({ success: true, message: `已在后台启动漫画下载，命令为: ${cmd}。请告知用户正在下载，并让其留意后续接收的 PDF 文件与密码。` })
        }
        case 'search': {
          if (!input.keyword) {
            return JSON.stringify({ error: '搜索时 keyword 不能为空' })
          }
          const result = await apiGet<SearchResult>('/api/search', { keyword: input.keyword })
          const jmList = result.all_results?.jm || []
          const bikaList = result.all_results?.bika || []
          const all = [
            ...jmList.map(c => ({ ...c, source: 'jm' })),
            ...bikaList.map(c => ({ ...c, source: 'bika' })),
          ]
          return JSON.stringify({
            keyword: input.keyword,
            best_match: result.best_match,
            total: all.length,
            results: all.slice(0, 20),
          })
        }
        case 'detail': {
          if (!input.comic_id) {
            return JSON.stringify({ error: '查看详情时 comic_id 不能为空' })
          }
          const detail = await apiGet<ComicDetail>(`/api/comic/${source}/${input.comic_id}`)
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
        }
        case 'leaderboard': {
          const mode = input.mode || 'day'
          const page = String(input.page || 1)
          const result = await apiGet<ApiResponse<ComicItem[]>>(`/api/${source}/leaderboard`, { mode, page })
          return JSON.stringify({
            source,
            mode,
            page: Number(page),
            total: result.data?.length || 0,
            results: result.data || [],
          })
        }
        case 'latest': {
          const page = String(input.page || 1)
          const result = await apiGet<ApiResponse<ComicItem[]>>(`/api/${source}/latest`, { page })
          return JSON.stringify({
            source,
            page: Number(page),
            total: result.data?.length || 0,
            results: result.data || [],
          })
        }
        case 'random': {
          const result = await apiGet<ApiResponse<ComicItem[]>>(`/api/${source}/random`)
          return JSON.stringify({
            source,
            result: result.data || null,
          })
        }
        default:
          return JSON.stringify({ error: '未知操作类型' })
      }
    } catch (err: any) {
      logger.error('工具调用失败:', err.message)
      return JSON.stringify({ error: err.message || '请求失败' })
    }
  }, {
    name,
    description,
    schema: comicToolSchema as any,
  }) as any
}
