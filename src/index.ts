import { Context, Schema, h, segment } from 'koishi'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { pathToFileURL } from 'url'
import { createHash } from 'crypto'

export const inject = ['http']

export const usage = `
<h2>聚合漫画搜索与下载插件</h2>
<p>使用前请先部署 <a href="https://github.com/lumia1998/comic-api">comic-api</a> 后端服务</p>
<p>支持禁漫天堂(JM)和哔咔漫画(Bika)双平台聚合搜索</p>
<h3>命令列表</h3>
<ul>
  <li><code>comic [关键词]</code> - 聚合搜索/直接下载漫画</li>
  <li><code>comic search &lt;关键词&gt;</code> - 聚合搜索漫画</li>
  <li><code>comic download &lt;ID&gt; [章节ID]</code> - 下载漫画PDF</li>
  <li><code>comic detail &lt;ID&gt;</code> - 查看漫画详情</li>
  <li><code>comic leaderboard [类型]</code> - 排行榜</li>
  <li><code>comic category &lt;分类名&gt;</code> - 分类浏览</li>
  <li><code>comic latest</code> - 最近更新</li>
  <li><code>comic random</code> - 随机推荐</li>
</ul>
`

export interface Config {
  apiBase: string
  concurrency: number
  logInfo: boolean
  pdfPassword?: string
}

export const Config = Schema.object({
  apiBase: Schema.string()
    .description('comic-api 后端地址')
    .default('http://127.0.0.1:8699'),
  concurrency: Schema.number()
    .description('下载并发数')
    .default(4),
  logInfo: Schema.boolean()
    .description('打印 API 调用日志')
    .default(false),
  pdfPassword: Schema.string()
    .description('PDF 统一加密密码 (留空则使用动态生成的6位密码并自动提示)'),
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
    const src = c.source === 'jm' ? '禁漫' : c.source === 'bika' ? '哔咔' : sourceLabel
    return `${i + 1}. [${src}|${c.id}] ${c.title}  作者:${c.author || '佚名'}`
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
  ctx.command('comic [keyword:text]', '聚合漫画搜索与下载。若用户给的名字不准确、包含缩写或搜不到，请调用联网工具搜索获取准确的漫画名称、关联角色或作者，然后再进行搜索或下载。')
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

  // comic search <keyword>
  ctx.command('comic search <keyword:text>', '聚合搜索漫画（禁漫+哔咔）。若漫画名称模糊、拼写错误或搜不到，请先调用联网工具搜索获取其准确别名、正式标题或作者后，再重试搜索。')
    .action(async ({ session }, keyword) => {
      if (!keyword) return '请输入搜索关键词'

      try {
        const result = await apiGet<SearchResult>('/api/search', { keyword })
        const parts: string[] = []

        if (result.best_match?.title) {
          const bm = result.best_match
          const srcLabel = bm.source === 'jm' ? '禁漫' : '哔咔'
          parts.push(`🏆 最佳匹配 [${srcLabel}|${bm.id}]:`)
          parts.push(`  ${bm.title}  作者:${bm.author || '佚名'}`)
          parts.push('')
        }

        const jmList = result.all_results?.jm || []
        const bikaList = result.all_results?.bika || []

        const all: (ComicItem & { source: string })[] = []
        const jmItems = jmList.map(c => ({ ...c, source: 'jm' }))
        const bikaItems = bikaList.map(c => ({ ...c, source: 'bika' }))

        if (jmItems.length > 0 || bikaItems.length > 0) {
          parts.push(`共找到 ${jmItems.length + bikaItems.length} 个结果：\n`)

          let currentIndex = 1
          if (jmItems.length > 0) {
            parts.push('【 禁漫天堂 (JMComic) 】')
            for (const item of jmItems) {
              all.push(item)
              parts.push(`  ${currentIndex}. [禁漫|${item.id}] ${item.title}  作者:${item.author || '佚名'}`)
              currentIndex++
            }
            parts.push('')
          }

          if (bikaItems.length > 0) {
            parts.push('【 哔咔漫画 (Bika) 】')
            for (const item of bikaItems) {
              all.push(item)
              parts.push(`  ${currentIndex}. [哔咔|${item.id}] ${item.title}  作者:${item.author || '佚名'}`)
              currentIndex++
            }
            parts.push('')
          }

          parts.push('输入序号（例如：1）或「源|ID」（例如：禁漫|12345）进行下载')

          if (session) {
            await session.send(parts.join('\n'))
            const answer = await session.prompt(30000)
            if (!answer) return
            const cleanAnswer = answer.trim()
            let targetId = ''

            const index = parseInt(cleanAnswer, 10)
            if (!isNaN(index) && index > 0 && index <= all.length) {
              const selected = all[index - 1]
              targetId = selected.id
            } else {
              const match = cleanAnswer.match(/^(?:禁漫|哔咔|jm|bika)[|｜](.+)$/i)
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
          } else {
            return parts.join('\n')
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
  ctx.command('comic download <id:string> [chapterId:string]', '下载漫画PDF。可接受漫画ID或本子名字。提示：若名字不准确、带有缩写或搜不到，可先调用联网工具搜索获取准确本子名、角色或关联画师，再进行下载。')
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
        const tempFilePath = path.join(os.tmpdir(), filename)

        await fs.promises.writeFile(tempFilePath, buffer)

        try {
          const fileUrl = pathToFileURL(tempFilePath).href
          await session.send(h.file(fileUrl))
          await session.send(`🔑 该 PDF 已加密，解密密码为：${pdfPassword}`)
        } finally {
          fs.promises.unlink(tempFilePath).catch((err) => {
            logger.error('Failed to delete temp file:', err.message)
          })
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
  ctx.command('comic detail <id:string>', '查看漫画详情和章节列表')
    .action(async ({ session }, id) => {
      if (!id) return '用法: comic detail <ID>'
      const resolved = determineSource(id)
      if (!resolved) {
        return '无效的 ID 格式。禁漫 ID 应为纯数字，哔咔 ID 应为 24 位十六进制字符。'
      }
      const { source, id: targetId } = resolved

      try {
        const detail = await apiGet<ComicDetail>(`/api/comic/${source}/${targetId}`)
        if (!detail?.title) return '未找到该漫画'

        const srcLabel = source === 'jm' ? '禁漫' : '哔咔'
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

        if (jmResult && jmResult.success !== false && jmResult.data?.length) {
          const comics = jmResult.data.map(c => ({ ...c, source: 'jm' }))
          parts.push(`【 禁漫天堂 (JMComic) ${modeMap[targetMode]} 】`)
          parts.push(formatComics(comics, '禁漫'))
          parts.push('')
        } else {
          parts.push(`【 禁漫天堂 (JMComic) ${modeMap[targetMode]} 】`)
          parts.push('暂无数据或获取失败')
          parts.push('')
        }

        if (bikaResult && bikaResult.success !== false && bikaResult.data?.length) {
          const comics = bikaResult.data.map(c => ({ ...c, source: 'bika' }))
          parts.push(`【 哔咔漫画 (Bika) ${modeMap[targetMode]} 】`)
          parts.push(formatComics(comics, '哔咔'))
          parts.push('')
        } else {
          parts.push(`【 哔咔漫画 (Bika) ${modeMap[targetMode]} 】`)
          parts.push('暂无数据或获取失败')
          parts.push('')
        }

        return parts.join('\n')
      } catch (err: any) {
        logger.error('获取排行榜失败:', err.message)
        return `获取排行榜失败: ${err.message}`
      }
    })

  // comic category <name>
  ctx.command('comic category <name:string>', '按分类浏览漫画')
    .action(async ({ session }, name) => {
      if (!name) return '用法: comic category <分类名>'

      try {
        const [jmResult, bikaResult] = await Promise.all([
          apiGet<ApiResponse<ComicItem[]>>('/api/jm/category', { name }).catch(() => null),
          apiGet<ApiResponse<ComicItem[]>>('/api/bika/category', { name }).catch(() => null),
        ])

        const parts: string[] = []
        let hasResults = false

        if (jmResult && jmResult.success !== false && jmResult.data?.length) {
          const comics = jmResult.data.map(c => ({ ...c, source: 'jm' }))
          parts.push(`【 禁漫天堂 (JMComic) 分类「${name}」 】`)
          parts.push(formatComics(comics, '禁漫'))
          parts.push('')
          hasResults = true
        }

        if (bikaResult && bikaResult.success !== false && bikaResult.data?.length) {
          const comics = bikaResult.data.map(c => ({ ...c, source: 'bika' }))
          parts.push(`【 哔咔漫画 (Bika) 分类「${name}」 】`)
          parts.push(formatComics(comics, '哔咔'))
          parts.push('')
          hasResults = true
        }

        if (!hasResults) {
          return `两平台分类「${name}」均暂无数据或获取失败`
        }

        return parts.join('\n')
      } catch (err: any) {
        logger.error('获取分类失败:', err.message)
        return `获取分类失败: ${err.message}`
      }
    })

  // comic latest
  ctx.command('comic latest', '查看最近更新')
    .action(async ({ session }) => {
      try {
        const [jmResult, bikaResult] = await Promise.all([
          apiGet<ApiResponse<ComicItem[]>>('/api/jm/latest').catch(() => null),
          apiGet<ApiResponse<ComicItem[]>>('/api/bika/latest').catch(() => null),
        ])

        const parts: string[] = []

        if (jmResult && jmResult.success !== false && jmResult.data?.length) {
          const comics = jmResult.data.map(c => ({ ...c, source: 'jm' }))
          parts.push('【 禁漫天堂 (JMComic) 最近更新 】')
          parts.push(formatComics(comics, '禁漫'))
          parts.push('')
        } else {
          parts.push('【 禁漫天堂 (JMComic) 最近更新 】')
          parts.push('暂无数据或获取失败')
          parts.push('')
        }

        if (bikaResult && bikaResult.success !== false && bikaResult.data?.length) {
          const comics = bikaResult.data.map(c => ({ ...c, source: 'bika' }))
          parts.push('【 哔咔漫画 (Bika) 最近更新 】')
          parts.push(formatComics(comics, '哔咔'))
          parts.push('')
        } else {
          parts.push('【 哔咔漫画 (Bika) 最近更新 】')
          parts.push('暂无数据或获取失败')
          parts.push('')
        }

        return parts.join('\n')
      } catch (err: any) {
        logger.error('获取最近更新失败:', err.message)
        return `获取最近更新失败: ${err.message}`
      }
    })

  // comic random
  ctx.command('comic random', '随机推荐漫画')
    .action(async ({ session }) => {
      try {
        const [jmResult, bikaResult] = await Promise.all([
          apiGet<ApiResponse<ComicItem[]>>('/api/jm/random').catch(() => null),
          apiGet<ApiResponse<ComicItem[]>>('/api/bika/random').catch(() => null),
        ])

        const parts: string[] = []

        if (jmResult && jmResult.success !== false && jmResult.data?.length) {
          const comics = jmResult.data
          const comic = comics[Math.floor(Math.random() * comics.length)]
          if (comic?.title) {
            const item = { ...comic, source: 'jm' }
            parts.push('【 禁漫天堂 (JMComic) 随机推荐 】')
            parts.push(formatComics([item], '禁漫'))
            parts.push('')
          }
        }

        if (bikaResult && bikaResult.success !== false && bikaResult.data?.length) {
          const comics = bikaResult.data
          const comic = comics[Math.floor(Math.random() * comics.length)]
          if (comic?.title) {
            const item = { ...comic, source: 'bika' }
            parts.push('【 哔咔漫画 (Bika) 随机推荐 】')
            parts.push(formatComics([item], '哔咔'))
            parts.push('')
          }
        }

        if (parts.length === 0) {
          return '两平台随机推荐均暂无数据或获取失败'
        }

        return parts.join('\n')
      } catch (err: any) {
        logger.error('获取随机推荐失败:', err.message)
        return `获取随机推荐失败: ${err.message}`
      }
    })

}
