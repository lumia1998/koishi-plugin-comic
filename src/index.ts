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
  <li><code>comic search &lt;关键词&gt;</code> - 聚合搜索漫画</li>
  <li><code>comic download &lt;ID&gt; [章节ID]</code> - 下载漫画PDF</li>
  <li><code>comic detail &lt;关键词/ID&gt;</code> - 查看漫画详情</li>
  <li><code>comic leaderboard [类型]</code> - 排行榜</li>
  <li><code>comic latest</code> - 最近更新</li>
  <li><code>comic random</code> - 随机推荐</li>
</ul>
`

export interface Config {
  apiBase: string
  defaultSource: 'jm' | 'bika'
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
  defaultSource: Schema.union(['jm', 'bika'] as const)
    .description('默认漫画源')
    .default('jm'),
  concurrency: Schema.number()
    .description('下载并发数')
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

function formatComics(comics: ComicItem[], sourceLabel: string = ''): string {
  if (!comics || comics.length === 0) return '没有找到相关漫画。'
  return comics.map((c, i) => {
    const src = c.source === 'jm' ? '禁漫天堂' : c.source === 'bika' ? '哔咔漫画' : sourceLabel
    return `${i + 1}. [${src}] ${c.title}  作者:${c.author || '佚名'}`
  }).join('\n')
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
    const res = await ctx.http.get(url)
    return res as T
  }

  // Parent command 'comic' routing logic
  ctx.command('comic [keyword:text]', '聚合漫画搜索与直接下载')
    .action(async ({ session }, keyword) => {
      if (!session) return
      if (!keyword) {
        return session.execute('help comic')
      }
      const clean = keyword.trim()
      
      const resolved = determineSource(clean)
      if (resolved) {
        if (resolved.source === 'jm' && parseInt(resolved.id, 10) <= 100) {
          return session.execute(`comic search ${keyword}`)
        }
        return session.execute(`comic download ${resolved.id}`)
      }
      
      // Fallback to search
      return session.execute(`comic search ${keyword}`)
    })

  async function fetchAndShowDetail(session: any, source: string, id: string): Promise<string | void> {
    try {
      await session.send('正在获取详情...')
      const detail = await apiGet<ComicDetail>(`/api/comic/${source}/${id}`)
      if (!detail?.title) return '未找到该漫画'

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
        parts.push(`\n第一话: [${first.id}] ${first.name}`)
        if (detail.chapters.length > 1) {
          parts.push(`共 ${detail.chapters.length} 话，如需下载请使用 comic download <ID> [章节ID]`)
        }
      }

      return parts.join('\n')
    } catch (err: any) {
      logger.error('获取详情失败:', err.message)
      return `获取详情失败: ${err.message}`
    }
  }

  // comic search <keyword>
  ctx.command('comic search <keyword:text>', '聚合搜索漫画')
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

        const parts: string[] = []

        if (result.best_match?.title) {
          const bm = result.best_match
          const srcLabel = bm.source === 'jm' ? '禁漫天堂' : '哔咔漫画'
          parts.push(`🏆 最佳匹配 [${srcLabel}]:`)
          parts.push(`  ${bm.title}  作者:${bm.author || '佚名'}`)
          parts.push('')
        }

        const jmList = result.all_results?.jm || []
        const bikaList = result.all_results?.bika || []

        const all: (ComicItem & { source: string })[] = []
        const jmItems = jmList.map(c => ({ ...c, source: 'jm' }))
        const bikaItems = bikaList.map(c => ({ ...c, source: 'bika' }))

        const totalResults = jmItems.length + bikaItems.length

        if (totalResults > 0) {
          if (totalResults > 5) {
            parts.push(`共找到 ${totalResults} 个结果，已生成合并转发记录：`)
            if (session) {
              await session.send(parts.join('\n'))

              const msgElements = []
              let currentIndex = 1
              if (jmItems.length > 0) {
                msgElements.push(h('message', '【 禁漫天堂 (JMComic) 】'))
                for (const item of jmItems) {
                  all.push(item)
                  msgElements.push(h('message', `  ${currentIndex}. [禁漫天堂] ${item.title}  作者:${item.author || '佚名'}`))
                  currentIndex++
                }
              }
              if (bikaItems.length > 0) {
                msgElements.push(h('message', '【 哔咔漫画 (Bika) 】'))
                for (const item of bikaItems) {
                  all.push(item)
                  msgElements.push(h('message', `  ${currentIndex}. [哔咔漫画] ${item.title}  作者:${item.author || '佚名'}`))
                  currentIndex++
                }
              }
              msgElements.push(h('message', '💡 请查看上述列表后，在当前会话直接回复序号进行下载，回复其他内容退出。'))

              await session.send(h('message', { forward: true }, msgElements))
            } else {
              parts.push(formatComics(jmItems, '禁漫天堂'))
              parts.push('')
              parts.push(formatComics(bikaItems, '哔咔漫画'))
              return parts.join('\n')
            }
          } else {
            parts.push(`共找到 ${totalResults} 个结果：\n`)
            let currentIndex = 1
            if (jmItems.length > 0) {
              parts.push('【 禁漫天堂 (JMComic) 】')
              for (const item of jmItems) {
                all.push(item)
                parts.push(`  ${currentIndex}. [禁漫天堂] ${item.title}  作者:${item.author || '佚名'}`)
                currentIndex++
              }
              parts.push('')
            }

            if (bikaItems.length > 0) {
              parts.push('【 哔咔漫画 (Bika) 】')
              for (const item of bikaItems) {
                all.push(item)
                parts.push(`  ${currentIndex}. [哔咔漫画] ${item.title}  作者:${item.author || '佚名'}`)
                currentIndex++
              }
              parts.push('')
            }

            parts.push('输入序号（例如：1）或「源|ID」（例如：禁漫天堂|12345）进行下载')
            if (session) {
              await session.send(parts.join('\n'))
            } else {
              return parts.join('\n')
            }
          }

          if (session) {
            const answer = await session.prompt(30000)
            if (!answer) return
            const cleanAnswer = answer.trim()
            let targetId = ''

            const index = parseInt(cleanAnswer, 10)
            if (!isNaN(index) && index > 0 && index <= all.length) {
              const selected = all[index - 1]
              targetId = selected.id
            } else {
              const match = cleanAnswer.match(/^(?:禁漫天堂|哔咔漫画|禁漫|哔咔|jm|bika)[|｜](.+)$/i)
              if (match) {
                targetId = match[1].trim()
              } else {
                targetId = cleanAnswer
              }
            }

            if (targetId) {
              return session.execute(`comic download ${targetId}`)
            }
            return
          }
        } else {
          return '没有找到任何结果'
        }
      } catch (err: any) {
        logger.error('搜索失败:', err.message)
        return `搜索失败: ${err.message}`
      }
    })

  // comic download <id> [chapterId]
  ctx.command('comic download <id:string> [chapterId:string]', '下载漫画PDF')
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

        const detail = await apiGet<ComicDetail>(`/api/comic/${source}/${targetId}`)
        if (!detail?.title) return '未找到该漫画'
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
  ctx.command('comic detail <id:text>', '查看漫画详情')
    .action(async ({ session }, query) => {
      if (!query) return '用法: comic detail <关键词> 或 comic detail <ID>'
      if (!session) return '此命令仅支持在会话中使用'

      const resolved = determineSource(query)
      if (resolved) {
        return fetchAndShowDetail(session, resolved.source, resolved.id)
      }

      try {
        const result = await apiGet<SearchResult>('/api/search', { keyword: query })
        const jmList = result.all_results?.jm || []
        const bikaList = result.all_results?.bika || []
        const all = [
          ...jmList.map(c => ({ ...c, source: 'jm' })),
          ...bikaList.map(c => ({ ...c, source: 'bika' })),
        ]

        if (all.length === 0) {
          return `没有找到关于「${query}」的漫画。`
        }

        if (all.length === 1) {
          const chosen = all[0]
          return fetchAndShowDetail(session, chosen.source, chosen.id)
        }

        const parts: string[] = []
        if (result.best_match?.title) {
          const bm = result.best_match
          const srcLabel = bm.source === 'jm' ? '禁漫天堂' : '哔咔漫画'
          parts.push(`🏆 最佳匹配 [${srcLabel}]: ${bm.title}`)
          parts.push('')
        }

        if (all.length > 5) {
          parts.push(`找到 ${all.length} 个结果，已生成合并转发记录：`)
          await session.send(parts.join('\n'))
          const msgElements = all.map((c, i) => {
            const src = c.source === 'jm' ? '禁漫天堂' : '哔咔漫画'
            return h('message', `${i + 1}. [${src}] ${c.title}  作者:${c.author || '佚名'}`)
          })
          msgElements.push(h('message', `💡 请回复序号（1-${all.length}）查看详情，或回复其他任意内容退出。`))
          await session.send(h('message', { forward: true }, msgElements))
        } else {
          parts.push(`找到以下多个结果，请回复序号（1-${all.length}）查看详情，或回复其他任意内容退出：`)
          parts.push(formatComics(all))
          await session.send(parts.join('\n'))
        }

        const answer = await session.prompt(30000)
        if (!answer) return
        const trimmed = answer.trim()
        const index = parseInt(trimmed, 10)
        if (!isNaN(index) && index >= 1 && index <= all.length) {
          const chosen = all[index - 1]
          return fetchAndShowDetail(session, chosen.source, chosen.id)
        } else {
          return '输入无效，已退出。'
        }
      } catch (err: any) {
        logger.error('详情搜索失败:', err.message)
        return `查询失败: ${err.message}`
      }
    })

  // comic leaderboard [mode]
  ctx.command('comic leaderboard [mode:string]', '查看排行榜')
    .action(async ({ session }, mode) => {
      const targetMode = (mode || 'day').toLowerCase()
      if (!['day', 'week', 'month', 'total'].includes(targetMode)) {
        return 'mode 必须是 day/week/month/total'
      }

      try {
        const [jmResult, bikaResult] = await Promise.all([
          apiGet<ApiResponse<ComicItem[]>>('/api/jm/leaderboard', { mode: targetMode }).catch(() => null),
          apiGet<ApiResponse<ComicItem[]>>('/api/bika/leaderboard', { mode: targetMode }).catch(() => null),
        ])

        const modeMap: Record<string, string> = { day: '日榜', week: '周榜', month: '月榜', total: '总榜' }
        const parts: string[] = []

        const formatLeaderboard = (comics: ComicItem[]): string => {
          if (!comics || comics.length === 0) return '暂无数据或获取失败'
          return comics.map((c, i) => {
            return `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`
          }).join('\n')
        }

        parts.push(`【 禁漫天堂 (JMComic) ${modeMap[targetMode]} 】`)
        if (jmResult && jmResult.success !== false && jmResult.data?.length) {
          parts.push(formatLeaderboard(jmResult.data))
        } else {
          parts.push('暂无数据或获取失败')
        }
        parts.push('')

        parts.push(`【 哔咔漫画 (Bika) ${modeMap[targetMode]} 】`)
        if (bikaResult && bikaResult.success !== false && bikaResult.data?.length) {
          parts.push(formatLeaderboard(bikaResult.data))
        } else {
          parts.push('暂无数据或获取失败')
        }

        return parts.join('\n')
      } catch (err: any) {
        logger.error('获取排行榜失败:', err.message)
        return `获取排行榜失败: ${err.message}`
      }
    })

  // comic latest
  ctx.command('comic latest', '查看最近更新')
    .alias('最新漫画')
    .alias('漫画更新')
    .action(async ({ session }) => {
      if (!session) return '此命令仅支持在会话中使用'

      try {
        const [jmResult, bikaResult] = await Promise.all([
          apiGet<ApiResponse<ComicItem[]>>('/api/jm/latest').catch(() => null),
          apiGet<ApiResponse<ComicItem[]>>('/api/bika/latest').catch(() => null),
        ])

        const formatLatest = (comics: ComicItem[]): string => {
          if (!comics || comics.length === 0) return '暂无数据或获取失败'
          const list = comics.slice(0, 20)
          return list.map((c, i) => {
            return `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`
          }).join('\n')
        }

        const jmText = `【 禁漫天堂 (JMComic) 最近更新 】\n` + (jmResult && jmResult.success !== false && jmResult.data?.length ? formatLatest(jmResult.data) : '暂无数据或获取失败')
        const bikaText = `【 哔咔漫画 (Bika) 最近更新 】\n` + (bikaResult && bikaResult.success !== false && bikaResult.data?.length ? formatLatest(bikaResult.data) : '暂无数据或获取失败')

        const msgElements = [
          h('message', jmText),
          h('message', bikaText)
        ]

        await session.send(h('message', { forward: true }, msgElements))
        return
      } catch (err: any) {
        logger.error('获取最近更新失败:', err.message)
        return `获取最近更新失败: ${err.message}`
      }
    })

  // comic random
  ctx.command('comic random', '随机推荐漫画')
    .alias('随机漫画')
    .action(async ({ session }) => {
      const source = Math.random() < 0.5 ? 'jm' : 'bika'
      try {
        const result = await apiGet<ApiResponse<ComicItem[]>>(`/api/${source}/random`)
        const srcLabel = source === 'jm' ? '禁漫天堂' : '哔咔漫画'
        if (result && result.success !== false && result.data?.length) {
          const comic = result.data[Math.floor(Math.random() * result.data.length)]
          if (comic?.title) {
            return `🎲 随机推荐 [${srcLabel}]\n书名: ${comic.title}\n作者: ${comic.author || '佚名'}\nID: ${comic.id}\n(如需下载，请输入 comic.download ${comic.id})`
          }
        }
        return `${srcLabel} 随机推荐暂无数据`
      } catch (err: any) {
        const srcLabel = source === 'jm' ? '禁漫天堂' : '哔咔漫画'
        logger.error(`获取${srcLabel}随机推荐失败:`, err.message)
        return `获取随机推荐失败: ${err.message}`
      }
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
    const source = input.source || cfg.defaultSource || 'jm'
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
