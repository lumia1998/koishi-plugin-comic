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
    required: ['http'],
    optional: ['chatluna'],
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
exports.Config = koishi_1.Schema.object({
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
});
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
            // 后端统一错误格式：{ success: false, error: '...' }
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
    // 子命令关键词集合，用于父命令路由时排除（避免被当作搜索词/下载ID）
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
        // 关键修复：当 keyword 以子命令名开头时，强制用点号形式转发到子命令。
        // Koishi 的 `comic [keyword:text]` 贪婪参数会吞掉 `comic random` / `comic latest`
        // 这类无参子命令，导致它们被当作搜索词处理。
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
        // Fallback to search
        return session.execute(`comic.search ${keyword}`);
    });
    // 构建单个漫画的详情文本；失败返回 null
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
            // 各平台最多取 8 条
            const jmItems = (result.all_results?.jm || []).slice(0, 8).map(c => ({ ...c, source: 'jm' }));
            const bikaItems = (result.all_results?.bika || []).slice(0, 8).map(c => ({ ...c, source: 'bika' }));
            const totalResults = jmItems.length + bikaItems.length;
            if (totalResults === 0) {
                return `没有找到关于「${keyword}」的漫画。`;
            }
            // 统一编号：禁漫在前，哔咔在后，供回复序号下载
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
                // 无会话环境（理论上不会发生），降级为纯文本
                const lines = [];
                if (jmLines.length)
                    lines.push('【 禁漫天堂 (JMComic) 】', ...jmLines);
                if (bikaLines.length)
                    lines.push('【 哔咔漫画 (Bika) 】', ...bikaLines);
                return lines.join('\n');
            }
            // 合并转发：禁漫一条、哔咔一条
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
                    return; // 非有效输入，退出
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
        let source;
        let targetId = id;
        const resolved = determineSource(id);
        if (resolved) {
            source = resolved.source;
            targetId = resolved.id;
        }
        else {
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
                    return '未找到相关漫画，请尝试其他关键词或输入正确的ID。';
                }
            }
            catch (err) {
                return `搜索本子名失败: ${err.message}`;
            }
        }
        try {
            await session.send('正在获取漫画详情...');
            let detail;
            try {
                detail = await apiGet(`/api/comic/${source}/${targetId}`);
            }
            catch (e) {
                return `获取详情失败（后端请求出错）：${e.message}\n可能原因：comic-api 未启动、源站反爬拦截或 ID 不存在。`;
            }
            if (!detail?.title) {
                const srcLabel = source === 'jm' ? '禁漫天堂' : '哔咔漫画';
                return `未找到该漫画 [${srcLabel} ID: ${targetId}]\n请确认 ID 是否正确；若是哔咔需先登录，禁漫可能被源站临时拦截。`;
            }
            if (!detail.chapters?.length)
                return '该漫画没有可下载的章节';
            const chapter = chapterId
                ? detail.chapters.find(c => c.id === chapterId)
                : detail.chapters[0];
            if (!chapter)
                return `未找到章节 ${chapterId}`;
            const chapterName = chapter.name;
            const totalChapters = detail.chapters.length;
            if (!chapterId && totalChapters > 1) {
                await session.send(`该漫画共 ${totalChapters} 话，正在下载第一话: ${chapterName}`);
            }
            await session.send(`正在下载「${detail.title} - ${chapterName}」...`);
            const pdfPassword = config.pdfPassword || getPdfPassword(source, targetId, chapter.id);
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
                return '下载失败：返回数据异常';
            }
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
                await session.send(`🔑 该 PDF 已加密，解密密码为：${pdfPassword}`);
            }
            catch (sendErr) {
                logger.warn('发送 PDF 文件失败，尝试提供直接下载链接:', sendErr.message);
                await session.send(`⚠️ 发送 PDF 文件失败，请通过以下链接直接下载：\n🔗 ${downloadUrl}\n🔑 解密密码为：${pdfPassword}`);
            }
            if (totalChapters > 1 && !chapterId) {
                return `这是第一话，共 ${totalChapters} 话。如需其他话请指定章节ID。\n章节列表:\n${detail.chapters.slice(0, 20).map((ch, i) => `${i + 1}. [${ch.id}] ${ch.name}`).join('\n')}${totalChapters > 20 ? `\n... 共 ${totalChapters} 话` : ''}`;
            }
            return '下载完成！';
        }
        catch (err) {
            logger.error('下载失败:', err.message);
            return `下载失败: ${err.message}`;
        }
    });
    // comic detail <id>
    ctx.command('comic.detail <id:text>', '查看漫画详情')
        .action(async ({ session }, query) => {
        if (!query)
            return '用法: comic detail <关键词> 或 comic detail <ID>';
        if (!session)
            return '此命令仅支持在会话中使用';
        // 直接给定 ID/源：只查该来源
        const resolved = determineSource(query);
        if (resolved) {
            return fetchAndShowDetail(session, resolved.source, resolved.id);
        }
        // 关键词模式：禁漫和哔咔各取 best 匹配，分别展示详情
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
        // 未指定类型默认日榜（最新的当日榜单）
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
            // 哔咔无总榜，自动回退日榜
            const bikaModeLabel = targetMode === 'total' ? '日榜(哔咔无总榜)' : modeMap[targetMode];
            const bikaText = `【 哔咔漫画 (Bika) ${bikaModeLabel} · 第${targetPage}页 】\n` + (bikaOk ? formatList(bikaResult.data) : '暂无数据或获取失败(哔咔需先登录)');
            // 禁漫、哔咔分成 2 条独立消息发送
            await session.send(jmText);
            await session.send(bikaText);
            return;
        }
        catch (err) {
            logger.error('获取排行榜失败:', err.message);
            return `获取排行榜失败: ${err.message}`;
        }
    });
    // 翻页累积拉取，直到达到 limit 条或没有更多（最多翻 maxPages 页防止狂刷后端）
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
            // 禁漫、哔咔分成 2 条独立消息发送
            await session.send(jmText);
            await session.send(bikaText);
            return;
        }
        catch (err) {
            logger.error('获取最近更新失败:', err.message);
            return `获取最近更新失败: ${err.message}`;
        }
    });
    // 随机推荐：多次调用累积去重，直到达到 limit 条或尝试上限
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
            // 禁漫、哔咔分成 2 条独立消息发送
            await session.send(jmText);
            await session.send(bikaText);
            await session.send('💡 如需下载，请使用 comic download <ID>');
            return;
        }
        return [jmText, '', bikaText].join('\n');
    });
    // ========== ChatLuna 工具注册 ==========
    ctx.on('ready', async () => {
        if (!ctx.chatluna) {
            logger.info('chatluna 未安装，跳过注册 ChatLuna 工具');
            return;
        }
        const chatluna = ctx.chatluna;
        const registerSingleTool = (name, description, schema, run) => {
            chatluna.platform.registerTool(name, {
                description,
                selector() {
                    return true;
                },
                createTool() {
                    return (0, tools_1.tool)(run, { name, description, schema });
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
            });
            logger.info(`ChatLuna 工具「${name}」已注册`);
        };
        // 1. comic_search
        registerSingleTool('comic_search', '搜索漫画，支持禁漫天堂(JM)和哔咔漫画(Bika)双平台聚合搜索。提示：如果用户给出的本子名、角色名或关键词模糊，或搜索未返回结果，必须先调用联网搜索工具检索获取该本子的准确正式名称或完整标题，然后再用精准的关键词调用此工具。', zod_1.z.object({
            keyword: zod_1.z.string().describe('搜索关键词'),
        }), async (input) => {
            try {
                const result = await apiGet('/api/search', { keyword: input.keyword });
                const jmList = result.all_results?.jm || [];
                const bikaList = result.all_results?.bika || [];
                const all = [
                    ...jmList.map(c => ({ ...c, source: 'jm' })),
                    ...bikaList.map(c => ({ ...c, source: 'bika' })),
                ];
                return JSON.stringify({
                    keyword: input.keyword,
                    best_match: result.best_match,
                    total: all.length,
                    results: all.slice(0, 20),
                });
            }
            catch (err) {
                logger.error('工具 comic_search 调用失败:', err.message);
                return JSON.stringify({ error: err.message || '请求失败' });
            }
        });
        // 2. comic_detail
        registerSingleTool('comic_detail', '查看指定来源和ID的漫画详情，包括标题、作者、简介以及可下载的章节列表。', zod_1.z.object({
            comic_id: zod_1.z.string().describe('漫画ID'),
            source: zod_1.z.enum(['jm', 'bika']).optional().default('jm').describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。默认jm。'),
        }), async (input) => {
            try {
                const source = input.source || 'jm';
                const detail = await apiGet(`/api/comic/${source}/${input.comic_id}`);
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
                logger.error('工具 comic_detail 调用失败:', err.message);
                return JSON.stringify({ error: err.message || '请求失败' });
            }
        });
        // 3. comic_leaderboard
        registerSingleTool('comic_leaderboard', '查看指定漫画源的排行榜。', zod_1.z.object({
            source: zod_1.z.enum(['jm', 'bika']).optional().default('jm').describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。默认jm。'),
            mode: zod_1.z.enum(['day', 'week', 'month', 'total']).optional().default('day').describe('排行榜时间维度：day=日榜, week=周榜, month=月榜, total=总榜。默认day。'),
            page: zod_1.z.number().int().min(1).optional().default(1).describe('页码，默认1。'),
        }), async (input) => {
            try {
                const source = input.source || 'jm';
                const mode = input.mode || 'day';
                const page = String(input.page || 1);
                const result = await apiGet(`/api/${source}/leaderboard`, { mode, page });
                return JSON.stringify({
                    source,
                    mode,
                    page: Number(page),
                    total: result.data?.length || 0,
                    results: result.data || [],
                });
            }
            catch (err) {
                logger.error('工具 comic_leaderboard 调用失败:', err.message);
                return JSON.stringify({ error: err.message || '请求失败' });
            }
        });
        // 4. comic_latest
        registerSingleTool('comic_latest', '查看指定漫画源的最近更新列表。', zod_1.z.object({
            source: zod_1.z.enum(['jm', 'bika']).optional().default('jm').describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。默认jm。'),
            page: zod_1.z.number().int().min(1).optional().default(1).describe('页码，默认1。'),
        }), async (input) => {
            try {
                const source = input.source || 'jm';
                const page = String(input.page || 1);
                const result = await apiGet(`/api/${source}/latest`, { page });
                return JSON.stringify({
                    source,
                    page: Number(page),
                    total: result.data?.length || 0,
                    results: result.data || [],
                });
            }
            catch (err) {
                logger.error('工具 comic_latest 调用失败:', err.message);
                return JSON.stringify({ error: err.message || '请求失败' });
            }
        });
        // 5. comic_random
        registerSingleTool('comic_random', '随机推荐指定漫画源的漫画。', zod_1.z.object({
            source: zod_1.z.enum(['jm', 'bika']).optional().default('jm').describe('漫画源：jm=禁漫天堂, bika=哔咔漫画。默认jm。'),
        }), async (input) => {
            try {
                const source = input.source || 'jm';
                const result = await apiGet(`/api/${source}/random`);
                return JSON.stringify({
                    source,
                    result: result.data || null,
                });
            }
            catch (err) {
                logger.error('工具 comic_random 调用失败:', err.message);
                return JSON.stringify({ error: err.message || '请求失败' });
            }
        });
        // 6. comic_download
        registerSingleTool('comic_download', '下载指定ID的漫画并发送给用户。会自动启动后台下载并向用户发送PDF文件及解密密码。', zod_1.z.object({
            comic_id: zod_1.z.string().describe('漫画ID'),
            chapter_id: zod_1.z.string().optional().describe('章节ID（选填，不填默认下载第一话）'),
        }), async (input, runConfig) => {
            try {
                const session = runConfig?.configurable?.session;
                if (!session) {
                    return JSON.stringify({ error: '无法获取当前会话，不支持下载操作。请让用户在聊天界面直接使用 comic 命令或 comic.download 命令手动下载。' });
                }
                const cmd = input.chapter_id ? `comic.download ${input.comic_id} ${input.chapter_id}` : `comic.download ${input.comic_id}`;
                session.execute(cmd);
                return JSON.stringify({ success: true, message: `已在后台启动漫画下载，命令为: ${cmd}。请告知用户正在下载，并让其留意后续接收的 PDF 文件与密码。` });
            }
            catch (err) {
                logger.error('工具 comic_download 调用失败:', err.message);
                return JSON.stringify({ error: err.message || '请求失败' });
            }
        });
    });
}
//# sourceMappingURL=index.js.map