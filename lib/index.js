"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.usage = exports.inject = void 0;
exports.apply = apply;
const koishi_1 = require("koishi");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const url_1 = require("url");
const crypto_1 = require("crypto");
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
exports.inject = {
    required: ['http', 'chatluna'],
};
exports.usage = `
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
`;
exports.Config = koishi_1.Schema.intersect([
    koishi_1.Schema.object({
        apiBase: koishi_1.Schema.string()
            .description('comic-api 后端地址')
            .default('http://127.0.0.1:8699'),
        concurrency: koishi_1.Schema.number()
            .min(1).max(16)
            .description('下载并发数 (1-16)')
            .default(4),
        logInfo: koishi_1.Schema.boolean()
            .description('打印 API 调用日志')
            .default(false),
        pdfPassword: koishi_1.Schema.string()
            .description('PDF 统一加密密码 (留空则使用动态生成的6位密码并自动提示)'),
        pdfSendMethod: koishi_1.Schema.union(['buffer', 'file'])
            .description('PDF 发送方式。如果 Koishi 与 Bot 客户端不在同一设备/容器，请选择 buffer；若选择 file 模式，文件将保存到指定目录中转。')
            .default('buffer'),
        fileSendPath: koishi_1.Schema.string()
            .description('PDF 发送方式为 file 时的本地中转保存目录')
            .default('/koishi/temp'),
    }),
    koishi_1.Schema.object({
        comicSearchTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_search 工具'),
            name: koishi_1.Schema.string().default('comic_search').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('搜索漫画。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。返回匹配的漫画列表(含ID、标题、作者)。搜索到结果后，立即调用 comic_download 下载第一个匹配项，然后在一条消息中列出所有结果名+下载信息。如果搜索无结果，尝试用更简短的关键词重试，或告知用户未找到。')
                .description('工具描述'),
        }).description('comic_search 工具'),
    }),
    koishi_1.Schema.object({
        comicDetailTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_detail 工具'),
            name: koishi_1.Schema.string().default('comic_detail').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('查看漫画详情(标题、作者、简介、章节列表)。仅在用户明确要求查看详情时使用。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。')
                .description('工具描述'),
        }).description('comic_detail 工具'),
    }),
    koishi_1.Schema.object({
        comicLeaderboardTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_leaderboard 工具'),
            name: koishi_1.Schema.string().default('comic_leaderboard').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('查看漫画排行榜(日榜/周榜/月榜/总榜)。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。')
                .description('工具描述'),
        }).description('comic_leaderboard 工具'),
    }),
    koishi_1.Schema.object({
        comicLatestTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_latest 工具'),
            name: koishi_1.Schema.string().default('comic_latest').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('查看最近更新的漫画。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。')
                .description('工具描述'),
        }).description('comic_latest 工具'),
    }),
    koishi_1.Schema.object({
        comicRandomTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_random 工具'),
            name: koishi_1.Schema.string().default('comic_random').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('随机推荐漫画。支持禁漫天堂(JM)和哔咔漫画(Bika)双平台。')
                .description('工具描述'),
        }).description('comic_random 工具'),
    }),
    koishi_1.Schema.object({
        comicDownloadTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_download 工具'),
            name: koishi_1.Schema.string().default('comic_download').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('下载漫画/本子为PDF并直接发送给用户。调用后会自动发送PDF文件到聊天中，并返回漫画标题和解密密码。你应该在最终回复中列出所有搜索结果的标题（让用户知道有哪些可选），同时告知已下载的内容和密码。用户说"想看xx""来个本子""下载xx"等意图时，先用 comic_search 搜索，拿到结果后直接用第一个匹配的ID调用本工具下载。最终回复格式示例：「搜索到 N 个结果：《title1》《title2》《title3》...，已为你下载《title1》，密码 123456。如需其他本子请发送本子名给我」。不要分多条消息叙述中间步骤。')
                .description('工具描述'),
        }).description('comic_download 工具'),
    }),
]);
// ============ Zod Schemas ============
const comicSearchSchema = zod_1.z.object({
    keyword: zod_1.z.string().describe('搜索关键词，可以是漫画名、角色名、画师/作者名等'),
    source: zod_1.z.enum(['jm', 'bika']).optional()
        .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则自动搜索两个平台'),
});
const comicDetailSchema = zod_1.z.object({
    comic_id: zod_1.z.string().describe('漫画ID'),
    source: zod_1.z.enum(['jm', 'bika']).optional()
        .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则自动检测'),
});
const comicLeaderboardSchema = zod_1.z.object({
    mode: zod_1.z.enum(['day', 'week', 'month', 'total']).optional()
        .describe('排行榜类型：day=日榜(默认), week=周榜, month=月榜, total=总榜'),
    source: zod_1.z.enum(['jm', 'bika']).optional()
        .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则返回双平台排行榜'),
    page: zod_1.z.number().int().min(1).optional()
        .describe('页码，默认1'),
});
const comicLatestSchema = zod_1.z.object({
    source: zod_1.z.enum(['jm', 'bika']).optional()
        .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则返回双平台最近更新'),
});
const comicRandomSchema = zod_1.z.object({
    source: zod_1.z.enum(['jm', 'bika']).optional()
        .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则返回双平台随机推荐'),
});
const comicDownloadSchema = zod_1.z.object({
    comic_id: zod_1.z.string().describe('漫画ID（从comic_search返回结果中获取）'),
    chapter_id: zod_1.z.string().optional()
        .describe('章节ID，不填默认下载第一话'),
    source: zod_1.z.enum(['jm', 'bika']).optional()
        .describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。不填则自动检测'),
});
// ============ 辅助函数 ============
function getPdfPassword(source, comicId, chapterId) {
    const src = source.trim().toLowerCase();
    const seed = `${src}:${comicId}:${chapterId}`;
    const hash = (0, crypto_1.createHash)('sha256').update(seed).digest('hex');
    const value = parseInt(hash.slice(0, 12), 16) % 1000000;
    return value.toString().padStart(6, '0');
}
function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'comic';
}
function determineSource(id) {
    const clean = id.trim();
    const hasJm = /jm/i.test(clean) || /禁漫/i.test(clean);
    const digitMatch = clean.match(/\d+/);
    if (hasJm && digitMatch) {
        return { source: 'jm', id: digitMatch[0] };
    }
    if (/^\d+$/.test(clean)) {
        return { source: 'jm', id: clean };
    }
    if (/^[0-9a-fA-F]{24}$/.test(clean)) {
        return { source: 'bika', id: clean };
    }
    return null;
}
// ============ 主逻辑 ============
function apply(ctx, config) {
    const logger = ctx.logger('comic');
    async function apiGet(path, params) {
        let url = config.apiBase.replace(/\/+$/, '') + path;
        if (params) {
            const qs = new URLSearchParams(params).toString();
            if (qs)
                url += '?' + qs;
        }
        if (config.logInfo)
            logger.info(`GET ${url}`);
        try {
            const res = await ctx.http.get(url);
            if (res && typeof res === 'object' && res.success === false) {
                const msg = res.error || '后端返回未知错误';
                logger.warn(`API 返回失败 [${url}]: ${msg}`);
                throw new Error(msg);
            }
            return res;
        }
        catch (err) {
            logger.error(`API 请求失败 [${url}]: ${err.message}`);
            throw err;
        }
    }
    // ========== 核心下载函数（命令和工具共用） ==========
    async function doDownload(session, id, chapterId, opts) {
        const silent = opts?.silent ?? false;
        // 1. 解析来源与 ID
        let source;
        let targetId;
        const resolved = determineSource(id);
        if (resolved) {
            source = resolved.source;
            targetId = resolved.id;
        }
        else {
            if (!silent)
                await session.send(`正在搜索并解析本子名「${id}」...`);
            try {
                const searchResult = await apiGet('/api/search', { keyword: id });
                const jmList = searchResult.all_results?.jm || [];
                const bikaList = searchResult.all_results?.bika || [];
                if (jmList.length > 0) {
                    source = 'jm';
                    targetId = jmList[0].id;
                }
                else if (bikaList.length > 0) {
                    source = 'bika';
                    targetId = bikaList[0].id;
                }
                else {
                    return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: '未找到相关漫画' };
                }
            }
            catch (err) {
                return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: `搜索本子名失败: ${err.message}` };
            }
        }
        // 2. 获取详情
        if (!silent)
            await session.send('正在获取漫画详情...');
        let detail;
        try {
            detail = await apiGet(`/api/comic/${source}/${targetId}`);
        }
        catch (e) {
            return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: `获取详情失败: ${e.message}` };
        }
        if (!detail?.title) {
            const srcLabel = source === 'jm' ? '禁漫天堂' : '哔咔漫画';
            return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: `未找到该漫画 [${srcLabel} ID: ${targetId}]` };
        }
        if (!detail.chapters?.length) {
            return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: '该漫画没有可下载的章节' };
        }
        // 3. 确定章节
        const chapter = chapterId
            ? detail.chapters.find(c => c.id === chapterId)
            : detail.chapters[0];
        if (!chapter) {
            return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: `未找到章节 ${chapterId}` };
        }
        const chapterName = chapter.name;
        const totalChapters = detail.chapters.length;
        const pdfPassword = config.pdfPassword || getPdfPassword(source, targetId, chapter.id);
        // 4. 下载 PDF
        if (!silent) {
            if (!chapterId && totalChapters > 1) {
                await session.send(`该漫画共 ${totalChapters} 话，正在下载第一话: ${chapterName}`);
            }
            else {
                await session.send(`正在下载「${detail.title} - ${chapterName}」...`);
            }
        }
        const downloadUrl = config.apiBase.replace(/\/+$/, '')
            + `/api/download/${source}/${targetId}/${chapter.id}`
            + `?title=${encodeURIComponent(detail.title)}`
            + `&chapter=${encodeURIComponent(chapterName)}`
            + `&password=${encodeURIComponent(pdfPassword)}`
            + `&concurrency=${config.concurrency}`;
        if (config.logInfo)
            logger.info(`Downloading: ${downloadUrl}`);
        const response = await ctx.http.get(downloadUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response);
        if (buffer.length < 100) {
            return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error: '下载失败：返回数据异常' };
        }
        // 5. 发送文件
        const cleanTitle = source === 'jm' ? `jm${targetId}` : sanitizeFilename(detail.title);
        const filename = `${cleanTitle}.pdf`;
        try {
            if (config.pdfSendMethod === 'file') {
                const tempDir = config.fileSendPath || '/koishi/temp';
                await fs.promises.mkdir(tempDir, { recursive: true });
                const tempFilePath = path.join(tempDir, filename);
                await fs.promises.writeFile(tempFilePath, buffer);
                const fileUrl = (0, url_1.pathToFileURL)(tempFilePath).href;
                await session.send(koishi_1.h.file(fileUrl));
            }
            else {
                await session.send(koishi_1.h.file(buffer, 'application/pdf', { filename }));
            }
        }
        catch (sendErr) {
            logger.warn('发送 PDF 文件失败，尝试提供直接下载链接:', sendErr.message);
            return { success: false, title: detail.title, password: pdfPassword, chapterName, totalChapters, chapters: detail.chapters, error: `发送文件失败，请手动下载: ${downloadUrl}` };
        }
        return {
            success: true,
            title: detail.title,
            password: pdfPassword,
            chapterName,
            totalChapters,
            chapters: detail.chapters,
        };
    }
    const SUBCOMMANDS = ['search', 'download', 'detail', 'leaderboard', 'latest', 'random'];
    // Parent command 'comic' routing logic
    ctx.command('comic [keyword:text]', '聚合漫画搜索与直接下载')
        .action(async ({ session }, keyword) => {
        if (!session)
            return;
        if (!keyword) {
            return session.execute('help comic');
        }
        const clean = keyword.trim();
        const parts = clean.split(/\s+/);
        const firstWord = parts[0].toLowerCase();
        if (SUBCOMMANDS.includes(firstWord)) {
            const rest = parts.slice(1).join(' ');
            return session.execute(`comic.${firstWord}${rest ? ' ' + rest : ''}`);
        }
        const resolved = determineSource(clean);
        if (resolved) {
            if (resolved.source === 'jm' && parseInt(resolved.id, 10) <= 100) {
                return session.execute(`comic.search ${keyword}`);
            }
            return session.execute(`comic.download ${resolved.id}`);
        }
        return session.execute(`comic.search ${keyword}`);
    });
    async function buildDetailText(source, id) {
        try {
            const detail = await apiGet(`/api/comic/${source}/${id}`);
            if (!detail?.title)
                return null;
            const srcLabel = source === 'jm' ? '禁漫天堂' : '哔咔漫画';
            const parts = [
                `📖 ${detail.title}`,
                `来源: ${srcLabel} | ID: ${id}`,
                `作者: ${detail.author || '佚名'}`,
                `简介: ${(detail.description || '无描述').slice(0, 200)}`,
                `章节数: ${detail.chapters?.length || 0}`,
            ];
            if (detail.chapters?.length > 0) {
                const first = detail.chapters[0];
                parts.push(`第一话: [${first.id}] ${first.name}`);
                if (detail.chapters.length > 1) {
                    parts.push(`共 ${detail.chapters.length} 话，如需下载请使用 comic download <ID> [章节ID]`);
                }
            }
            return parts.join('\n');
        }
        catch (err) {
            logger.error(`获取详情失败 [${source}/${id}]:`, err.message);
            return null;
        }
    }
    async function fetchAndShowDetail(session, source, id) {
        await session.send('正在获取详情...');
        const text = await buildDetailText(source, id);
        return text || '未找到该漫画';
    }
    // comic search <keyword>
    ctx.command('comic.search <keyword:text>', '聚合搜索漫画')
        .action(async ({ session }, keyword) => {
        if (!keyword)
            return '请输入搜索关键词';
        try {
            let result;
            const resolved = determineSource(keyword);
            if (resolved) {
                try {
                    const detail = await apiGet(`/api/comic/${resolved.source}/${resolved.id}`);
                    if (detail?.title) {
                        const mockItem = {
                            id: resolved.id,
                            title: detail.title,
                            author: detail.author,
                            source: resolved.source,
                            cover: detail.cover
                        };
                        result = {
                            keyword,
                            best_match: mockItem,
                            all_results: {
                                jm: resolved.source === 'jm' ? [mockItem] : [],
                                bika: resolved.source === 'bika' ? [mockItem] : []
                            }
                        };
                    }
                    else {
                        result = await apiGet('/api/search', { keyword });
                    }
                }
                catch {
                    result = await apiGet('/api/search', { keyword });
                }
            }
            else {
                result = await apiGet('/api/search', { keyword });
            }
            const jmItems = (result.all_results?.jm || []).slice(0, 8).map(c => ({ ...c, source: 'jm' }));
            const bikaItems = (result.all_results?.bika || []).slice(0, 8).map(c => ({ ...c, source: 'bika' }));
            const totalResults = jmItems.length + bikaItems.length;
            if (totalResults === 0) {
                return `没有找到关于「${keyword}」的漫画。`;
            }
            const all = [];
            const jmLines = [];
            const bikaLines = [];
            let idx = 1;
            for (const item of jmItems) {
                all.push(item);
                jmLines.push(`${idx}. [禁漫天堂] ${item.title}  作者:${item.author || '佚名'} (ID: ${item.id})`);
                idx++;
            }
            for (const item of bikaItems) {
                all.push(item);
                bikaLines.push(`${idx}. [哔咔漫画] ${item.title}  作者:${item.author || '佚名'} (ID: ${item.id})`);
                idx++;
            }
            if (!session) {
                const lines = [];
                if (jmLines.length)
                    lines.push('【 禁漫天堂 (JMComic) 】', ...jmLines);
                if (bikaLines.length)
                    lines.push('【 哔咔漫画 (Bika) 】', ...bikaLines);
                return lines.join('\n');
            }
            const msgElements = [];
            let header = `🔍 关键词「${keyword}」共找到 ${totalResults} 个结果`;
            if (result.best_match?.title) {
                const bm = result.best_match;
                const bmLabel = bm.source === 'jm' ? '禁漫天堂' : '哔咔漫画';
                header += `\n🏆 最佳匹配 [${bmLabel}]: ${bm.title}`;
            }
            msgElements.push((0, koishi_1.h)('message', header));
            if (jmLines.length) {
                msgElements.push((0, koishi_1.h)('message', `【 禁漫天堂 (JMComic) 】\n${jmLines.join('\n')}`));
            }
            if (bikaLines.length) {
                msgElements.push((0, koishi_1.h)('message', `【 哔咔漫画 (Bika) 】\n${bikaLines.join('\n')}`));
            }
            msgElements.push((0, koishi_1.h)('message', '💡 回复序号下载（如 1），或回复「源|ID」（如 禁漫天堂|12345），回复其他内容退出。'));
            await session.send((0, koishi_1.h)('message', { forward: true }, msgElements));
            const answer = await session.prompt(30000);
            if (!answer)
                return;
            const cleanAnswer = answer.trim();
            let targetId = '';
            const index = parseInt(cleanAnswer, 10);
            if (!isNaN(index) && index > 0 && index <= all.length && /^\d+$/.test(cleanAnswer)) {
                targetId = all[index - 1].id;
            }
            else {
                const match = cleanAnswer.match(/^(?:禁漫天堂|哔咔漫画|禁漫|哔咔|jm|bika)[|｜](.+)$/i);
                if (match) {
                    targetId = match[1].trim();
                }
                else {
                    return;
                }
            }
            if (targetId) {
                return session.execute(`comic.download ${targetId}`);
            }
            return;
        }
        catch (err) {
            logger.error('搜索失败:', err.message);
            return `搜索失败: ${err.message}`;
        }
    });
    // comic download <id> [chapterId]
    ctx.command('comic.download <id:string> [chapterId:string]', '下载漫画PDF')
        .action(async ({ session }, id, chapterId) => {
        if (!id)
            return '用法: comic download <ID> [章节ID]';
        if (!session)
            return '此命令仅支持在会话中使用';
        const result = await doDownload(session, id, chapterId);
        if (!result.success) {
            return result.error || '下载失败';
        }
        // 发送密码（文件已在 doDownload 中发送）
        await session.send(`🔑 该 PDF 已加密，解密密码为：${result.password}`);
        if (result.totalChapters > 1 && !chapterId) {
            const chapterList = result.chapters.slice(0, 20).map((ch, i) => `${i + 1}. [${ch.id}] ${ch.name}`).join('\n');
            const more = result.totalChapters > 20 ? `\n... 共 ${result.totalChapters} 话` : '';
            return `这是第一话，共 ${result.totalChapters} 话。如需其他话请指定章节ID。\n章节列表:\n${chapterList}${more}`;
        }
        return '下载完成！';
    });
    // comic detail <id>
    ctx.command('comic.detail <id:text>', '查看漫画详情')
        .action(async ({ session }, query) => {
        if (!query)
            return '用法: comic detail <关键词> 或 comic detail <ID>';
        if (!session)
            return '此命令仅支持在会话中使用';
        const resolved = determineSource(query);
        if (resolved) {
            return fetchAndShowDetail(session, resolved.source, resolved.id);
        }
        try {
            await session.send('正在搜索并获取详情...');
            const result = await apiGet('/api/search', { keyword: query });
            const jmBest = (result.all_results?.jm || [])[0];
            const bikaBest = (result.all_results?.bika || [])[0];
            if (!jmBest && !bikaBest) {
                return `没有找到关于「${query}」的漫画。`;
            }
            const [jmText, bikaText] = await Promise.all([
                jmBest ? buildDetailText('jm', jmBest.id) : Promise.resolve(null),
                bikaBest ? buildDetailText('bika', bikaBest.id) : Promise.resolve(null),
            ]);
            const msgElements = [
                (0, koishi_1.h)('message', `🔍 关键词「${query}」各平台最相似结果详情：`),
            ];
            msgElements.push((0, koishi_1.h)('message', jmText || '【 禁漫天堂 】无匹配结果'));
            msgElements.push((0, koishi_1.h)('message', bikaText || '【 哔咔漫画 】无匹配结果(或需先登录)'));
            await session.send((0, koishi_1.h)('message', { forward: true }, msgElements));
            return;
        }
        catch (err) {
            logger.error('详情搜索失败:', err.message);
            return `查询失败: ${err.message}`;
        }
    });
    // comic leaderboard [mode] [page]
    ctx.command('comic.leaderboard [mode:string] [page:number]', '查看排行榜')
        .action(async ({ session }, mode, page) => {
        if (!session)
            return '此命令仅支持在会话中使用';
        const targetMode = (mode || 'day').toLowerCase();
        if (!['day', 'week', 'month', 'total'].includes(targetMode)) {
            return 'mode 必须是 day/week/month/total';
        }
        const targetPage = Math.max(1, Math.floor(page || 1));
        const query = { mode: targetMode, page: String(targetPage) };
        try {
            const [jmResult, bikaResult] = await Promise.all([
                apiGet('/api/jm/leaderboard', query).catch(() => null),
                apiGet('/api/bika/leaderboard', query).catch(() => null),
            ]);
            const modeMap = { day: '日榜', week: '周榜', month: '月榜', total: '总榜' };
            const formatList = (comics) => {
                if (!comics || comics.length === 0)
                    return '暂无数据或获取失败';
                return comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`).join('\n');
            };
            const jmOk = jmResult && jmResult.success !== false && jmResult.data?.length;
            const bikaOk = bikaResult && bikaResult.success !== false && bikaResult.data?.length;
            const jmText = `【 禁漫天堂 (JMComic) ${modeMap[targetMode]} · 第${targetPage}页 】\n` + (jmOk ? formatList(jmResult.data) : '暂无数据或获取失败');
            const bikaModeLabel = targetMode === 'total' ? '日榜(哔咔无总榜)' : modeMap[targetMode];
            const bikaText = `【 哔咔漫画 (Bika) ${bikaModeLabel} · 第${targetPage}页 】\n` + (bikaOk ? formatList(bikaResult.data) : '暂无数据或获取失败(哔咔需先登录)');
            await session.send(jmText);
            await session.send(bikaText);
            return;
        }
        catch (err) {
            logger.error('获取排行榜失败:', err.message);
            return `获取排行榜失败: ${err.message}`;
        }
    });
    async function fetchUpTo(source, endpoint, limit, maxPages = 5) {
        const acc = [];
        for (let page = 1; page <= maxPages && acc.length < limit; page++) {
            let res = null;
            try {
                res = await apiGet(`/api/${source}/${endpoint}`, { page: String(page) });
            }
            catch {
                break;
            }
            if (!res || res.success === false || !res.data?.length)
                break;
            acc.push(...res.data);
            if (res.data.length === 0)
                break;
        }
        return acc.slice(0, limit);
    }
    // comic latest
    ctx.command('comic.latest', '查看最近更新')
        .alias('最新漫画')
        .alias('漫画更新')
        .option('number', '-n <count:number> 每个平台显示数量(默认10，最多50)')
        .action(async ({ session, options }) => {
        if (!session)
            return '此命令仅支持在会话中使用';
        const limit = Math.min(50, Math.max(1, Math.floor(options?.number || 10)));
        try {
            const [jmItems, bikaItems] = await Promise.all([
                fetchUpTo('jm', 'latest', limit).catch(() => []),
                fetchUpTo('bika', 'latest', limit).catch(() => []),
            ]);
            const formatList = (comics) => {
                if (!comics || comics.length === 0)
                    return '暂无数据或获取失败';
                return comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`).join('\n');
            };
            const jmText = `【 禁漫天堂 (JMComic) 最近更新 · ${jmItems.length}条 】\n` + formatList(jmItems);
            const bikaText = `【 哔咔漫画 (Bika) 最近更新 · ${bikaItems.length}条 】\n` + (bikaItems.length ? formatList(bikaItems) : '暂无数据或获取失败(哔咔需先登录)');
            await session.send(jmText);
            await session.send(bikaText);
            return;
        }
        catch (err) {
            logger.error('获取最近更新失败:', err.message);
            return `获取最近更新失败: ${err.message}`;
        }
    });
    async function fetchRandomUpTo(source, limit, maxTries = 4) {
        const map = new Map();
        for (let i = 0; i < maxTries && map.size < limit; i++) {
            let res = null;
            try {
                res = await apiGet(`/api/${source}/random`);
            }
            catch {
                break;
            }
            if (!res || res.success === false || !res.data?.length)
                break;
            for (const item of res.data) {
                if (item?.id && !map.has(item.id))
                    map.set(item.id, item);
            }
        }
        return Array.from(map.values()).slice(0, limit);
    }
    // comic random
    ctx.command('comic.random', '随机推荐漫画')
        .alias('随机漫画')
        .option('number', '-n <count:number> 每个平台推荐数量(默认5，最多20)')
        .action(async ({ session, options }) => {
        const limit = Math.min(20, Math.max(1, Math.floor(options?.number || 5)));
        const [jmItems, bikaItems] = await Promise.all([
            fetchRandomUpTo('jm', limit).catch(() => []),
            fetchRandomUpTo('bika', limit).catch(() => []),
        ]);
        const formatList = (comics, label) => {
            if (!comics || comics.length === 0)
                return `【 ${label} 】暂无数据或获取失败`;
            const lines = comics.map((c, i) => `${i + 1}. [${label}] ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`);
            return `🎲 ${label} 随机推荐 · ${comics.length}个\n${lines.join('\n')}`;
        };
        const jmText = formatList(jmItems, '禁漫天堂');
        const bikaText = bikaItems.length ? formatList(bikaItems, '哔咔漫画') : '🎲 哔咔漫画 随机推荐\n暂无数据或获取失败(哔咔需先登录)';
        if (session) {
            await session.send(jmText);
            await session.send(bikaText);
            await session.send('💡 如需下载，请使用 comic download <ID>');
            return;
        }
        return [jmText, '', bikaText].join('\n');
    });
    // ========== 工具创建函数 ==========
    function createToolApi(cfg) {
        const apiBase = cfg.apiBase.replace(/\/+$/, '');
        return async (path, params) => {
            let url = apiBase + path;
            if (params) {
                const qs = new URLSearchParams(params).toString();
                if (qs)
                    url += '?' + qs;
            }
            return ctx.http.get(url);
        };
    }
    function createComicSearchTool(cfg) {
        const toolCfg = cfg.comicSearchTool;
        return (0, tools_1.tool)(async (input) => {
            const apiGetTool = createToolApi(cfg);
            try {
                if (!input.keyword) {
                    return JSON.stringify({ error: '搜索时 keyword 不能为空' });
                }
                const source = input.source;
                let result;
                if (source) {
                    result = await apiGetTool('/api/search', { keyword: input.keyword, source });
                }
                else {
                    result = await apiGetTool('/api/search', { keyword: input.keyword });
                }
                const jmList = result.all_results?.jm || [];
                const bikaList = result.all_results?.bika || [];
                const all = [
                    ...jmList.map(c => ({ ...c, source: 'jm' })),
                    ...bikaList.map(c => ({ ...c, source: 'bika' })),
                ];
                // 返回前5条（含标题），让AI在最终回复中列出名字供用户参考
                return JSON.stringify({
                    keyword: input.keyword,
                    best_match: result.best_match,
                    total: all.length,
                    results: all.slice(0, 5),
                });
            }
            catch (err) {
                return JSON.stringify({ error: err.message || '搜索请求失败' });
            }
        }, {
            name: toolCfg.name || 'comic_search',
            description: toolCfg.description || '搜索漫画',
            schema: comicSearchSchema,
        });
    }
    function createComicDetailTool(cfg) {
        const toolCfg = cfg.comicDetailTool;
        return (0, tools_1.tool)(async (input) => {
            const apiGetTool = createToolApi(cfg);
            try {
                if (!input.comic_id) {
                    return JSON.stringify({ error: '查看详情时 comic_id 不能为空' });
                }
                const resolved = determineSource(input.comic_id);
                const source = input.source || resolved?.source || 'jm';
                const id = resolved?.id || input.comic_id;
                const detail = await apiGetTool(`/api/comic/${source}/${id}`);
                if (!detail?.title) {
                    return JSON.stringify({ error: '未找到该漫画' });
                }
                return JSON.stringify({
                    title: detail.title,
                    author: detail.author,
                    description: detail.description,
                    source: detail.source || source,
                    chapter_count: detail.chapters?.length || 0,
                    chapters: detail.chapters?.slice(0, 30) || [],
                });
            }
            catch (err) {
                return JSON.stringify({ error: err.message || '查询详情失败' });
            }
        }, {
            name: toolCfg.name || 'comic_detail',
            description: toolCfg.description || '查看漫画详情',
            schema: comicDetailSchema,
        });
    }
    function createComicLeaderboardTool(cfg) {
        const toolCfg = cfg.comicLeaderboardTool;
        return (0, tools_1.tool)(async (input) => {
            const apiGetTool = createToolApi(cfg);
            try {
                const mode = input.mode || 'day';
                const page = String(input.page || 1);
                const source = input.source;
                if (source) {
                    const result = await apiGetTool(`/api/${source}/leaderboard`, { mode, page });
                    return JSON.stringify({
                        source,
                        mode,
                        page: Number(page),
                        total: result.data?.length || 0,
                        results: result.data || [],
                    });
                }
                else {
                    const [jmResult, bikaResult] = await Promise.all([
                        apiGetTool(`/api/jm/leaderboard`, { mode, page }).catch(() => null),
                        apiGetTool(`/api/bika/leaderboard`, { mode, page }).catch(() => null),
                    ]);
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
                    });
                }
            }
            catch (err) {
                return JSON.stringify({ error: err.message || '获取排行榜失败' });
            }
        }, {
            name: toolCfg.name || 'comic_leaderboard',
            description: toolCfg.description || '查看漫画排行榜',
            schema: comicLeaderboardSchema,
        });
    }
    function createComicLatestTool(cfg) {
        const toolCfg = cfg.comicLatestTool;
        return (0, tools_1.tool)(async (input) => {
            const apiGetTool = createToolApi(cfg);
            try {
                const source = input.source;
                if (source) {
                    const result = await apiGetTool(`/api/${source}/latest`, { page: '1' });
                    return JSON.stringify({
                        source,
                        total: result.data?.length || 0,
                        results: result.data || [],
                    });
                }
                else {
                    const [jmResult, bikaResult] = await Promise.all([
                        apiGetTool('/api/jm/latest', { page: '1' }).catch(() => null),
                        apiGetTool('/api/bika/latest', { page: '1' }).catch(() => null),
                    ]);
                    return JSON.stringify({
                        jm: {
                            total: jmResult?.data?.length || 0,
                            results: jmResult?.data || [],
                        },
                        bika: {
                            total: bikaResult?.data?.length || 0,
                            results: bikaResult?.data || [],
                        },
                    });
                }
            }
            catch (err) {
                return JSON.stringify({ error: err.message || '获取最近更新失败' });
            }
        }, {
            name: toolCfg.name || 'comic_latest',
            description: toolCfg.description || '查看最近更新的漫画',
            schema: comicLatestSchema,
        });
    }
    function createComicRandomTool(cfg) {
        const toolCfg = cfg.comicRandomTool;
        return (0, tools_1.tool)(async (input) => {
            const apiGetTool = createToolApi(cfg);
            try {
                const source = input.source;
                if (source) {
                    const result = await apiGetTool(`/api/${source}/random`);
                    return JSON.stringify({
                        source,
                        result: result.data || null,
                    });
                }
                else {
                    const [jmResult, bikaResult] = await Promise.all([
                        apiGetTool('/api/jm/random').catch(() => null),
                        apiGetTool('/api/bika/random').catch(() => null),
                    ]);
                    return JSON.stringify({
                        jm: jmResult?.data || null,
                        bika: bikaResult?.data || null,
                    });
                }
            }
            catch (err) {
                return JSON.stringify({ error: err.message || '获取随机推荐失败' });
            }
        }, {
            name: toolCfg.name || 'comic_random',
            description: toolCfg.description || '随机推荐漫画',
            schema: comicRandomSchema,
        });
    }
    function createComicDownloadTool(cfg) {
        const toolCfg = cfg.comicDownloadTool;
        return (0, tools_1.tool)(async (input, runConfig) => {
            try {
                if (!input.comic_id) {
                    return JSON.stringify({ error: '下载漫画时 comic_id 不能为空' });
                }
                const session = runConfig?.configurable?.session;
                if (!session) {
                    return JSON.stringify({ error: '无法获取当前会话，不支持下载操作。请让用户在聊天界面直接使用 comic download 命令手动下载。' });
                }
                const result = await doDownload(session, input.comic_id, input.chapter_id, { silent: true });
                if (!result.success) {
                    return JSON.stringify({ error: result.error || '下载失败' });
                }
                const chapterInfo = result.totalChapters > 1
                    ? `（第1话/共${result.totalChapters}话）`
                    : '';
                return JSON.stringify({
                    success: true,
                    title: result.title,
                    password: result.password,
                    chapter_name: result.chapterName,
                    total_chapters: result.totalChapters,
                    hint: `PDF文件已自动发送到聊天中。请在回复中列出所有搜索结果的标题（如《title1》《title2》...），然后告知：已下载《${result.title}》${chapterInfo}，密码 ${result.password}。如需其他本子让用户发送本子名即可。整个回复必须是一条消息，不要分多条。`,
                });
            }
            catch (err) {
                return JSON.stringify({ error: err.message || '下载请求失败' });
            }
        }, {
            name: toolCfg.name || 'comic_download',
            description: toolCfg.description || '下载漫画/本子并发送给用户',
            schema: comicDownloadSchema,
        });
    }
    // ========== ChatLuna 工具注册 ==========
    ctx.on('ready', async () => {
        const meta = {
            source: 'extension',
            group: 'comic',
            tags: ['comic', 'manga', 'jmcomic', 'bika'],
            defaultAvailability: {
                enabled: true,
                main: true,
                chatluna: true,
                characterScope: 'all',
            },
        };
        if (config.comicSearchTool.enabled) {
            const toolName = config.comicSearchTool.name || 'comic_search';
            ctx.effect(() => ctx.chatluna.platform.registerTool(toolName, {
                description: config.comicSearchTool.description || '搜索漫画',
                selector() { return true; },
                createTool() { return createComicSearchTool(config); },
                meta,
            }));
            logger.info(`ChatLuna 工具「${toolName}」已注册`);
        }
        if (config.comicDetailTool.enabled) {
            const toolName = config.comicDetailTool.name || 'comic_detail';
            ctx.effect(() => ctx.chatluna.platform.registerTool(toolName, {
                description: config.comicDetailTool.description || '查看漫画详情',
                selector() { return true; },
                createTool() { return createComicDetailTool(config); },
                meta,
            }));
            logger.info(`ChatLuna 工具「${toolName}」已注册`);
        }
        if (config.comicLeaderboardTool.enabled) {
            const toolName = config.comicLeaderboardTool.name || 'comic_leaderboard';
            ctx.effect(() => ctx.chatluna.platform.registerTool(toolName, {
                description: config.comicLeaderboardTool.description || '查看漫画排行榜',
                selector() { return true; },
                createTool() { return createComicLeaderboardTool(config); },
                meta,
            }));
            logger.info(`ChatLuna 工具「${toolName}」已注册`);
        }
        if (config.comicLatestTool.enabled) {
            const toolName = config.comicLatestTool.name || 'comic_latest';
            ctx.effect(() => ctx.chatluna.platform.registerTool(toolName, {
                description: config.comicLatestTool.description || '查看最近更新的漫画',
                selector() { return true; },
                createTool() { return createComicLatestTool(config); },
                meta,
            }));
            logger.info(`ChatLuna 工具「${toolName}」已注册`);
        }
        if (config.comicRandomTool.enabled) {
            const toolName = config.comicRandomTool.name || 'comic_random';
            ctx.effect(() => ctx.chatluna.platform.registerTool(toolName, {
                description: config.comicRandomTool.description || '随机推荐漫画',
                selector() { return true; },
                createTool() { return createComicRandomTool(config); },
                meta,
            }));
            logger.info(`ChatLuna 工具「${toolName}」已注册`);
        }
        if (config.comicDownloadTool.enabled) {
            const toolName = config.comicDownloadTool.name || 'comic_download';
            ctx.effect(() => ctx.chatluna.platform.registerTool(toolName, {
                description: config.comicDownloadTool.description || '下载漫画/本子并发送给用户',
                selector() { return true; },
                createTool() { return createComicDownloadTool(config); },
                meta,
            }));
            logger.info(`ChatLuna 工具「${toolName}」已注册`);
        }
    });
}
//# sourceMappingURL=index.js.map