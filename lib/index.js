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
`;
exports.Config = koishi_1.Schema.intersect([
    koishi_1.Schema.object({
        apiBase: koishi_1.Schema.string()
            .description('comic-api 后端地址')
            .default('http://127.0.0.1:8699'),
        logInfo: koishi_1.Schema.boolean()
            .description('打印 API 调用日志')
            .default(false),
        downloadTimeout: koishi_1.Schema.number()
            .min(60).max(3600)
            .description('单个下载任务的最长等待时间（秒）。comic-api v2 使用后台任务队列，超时后可到 WebUI 任务列表继续等待或重试。')
            .default(600),
        pdfSendMethod: koishi_1.Schema.union(['buffer', 'file'])
            .description('PDF 发送方式。如果 Koishi 与 Bot 客户端不在同一设备/容器，请选择 buffer；若选择 file 模式，文件将保存到指定目录中转。')
            .default('buffer'),
        fileSendPath: koishi_1.Schema.string()
            .description('PDF 发送方式为 file 时的本地中转保存目录')
            .default('/koishi/temp'),
    }),
    koishi_1.Schema.object({
        comicSourcesTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_sources 工具'),
            name: koishi_1.Schema.string().default('comic_sources').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('查看 comic-api 后端当前可用的漫画图源列表（id、名称、能力、分类、榜单类型、登录状态）。当需要确认图源 ID、判断某个功能是否可用、或排查搜索无结果时先调用此工具。')
                .description('工具描述'),
        }).description('comic_sources 工具'),
    }),
    koishi_1.Schema.object({
        comicSearchTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_search 工具'),
            name: koishi_1.Schema.string().default('comic_search').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('搜索漫画。聚合 comic-api 后端全部图源（如禁漫天堂/哔咔漫画/拷贝漫画，可用 comic_sources 查看）。返回匹配的漫画列表(含 source、ID、标题、作者)。搜索到结果后，立即调用 comic_download 下载第一个匹配项；下载完成后最终回复必须包含工具返回的解密密码。一条消息列出所有结果名+已下载标题+密码。如果搜索无结果，尝试用更简短的关键词重试，或告知用户未找到。')
                .description('工具描述'),
        }).description('comic_search 工具'),
    }),
    koishi_1.Schema.object({
        comicDetailTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_detail 工具'),
            name: koishi_1.Schema.string().default('comic_detail').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('查看漫画详情(标题、作者、简介、章节列表)。仅在用户明确要求查看详情时使用。source 为图源 ID（可用 comic_sources 查询，不填则自动识别）。')
                .description('工具描述'),
        }).description('comic_detail 工具'),
    }),
    koishi_1.Schema.object({
        comicLeaderboardTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_leaderboard 工具'),
            name: koishi_1.Schema.string().default('comic_leaderboard').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('查看漫画排行榜(日榜/周榜/月榜/总榜)。source 为图源 ID（可用 comic_sources 查询），不填则聚合全部支持排行榜的图源。')
                .description('工具描述'),
        }).description('comic_leaderboard 工具'),
    }),
    koishi_1.Schema.object({
        comicLatestTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_latest 工具'),
            name: koishi_1.Schema.string().default('comic_latest').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('查看最近更新的漫画。source 为图源 ID（可用 comic_sources 查询），不填则聚合全部支持该功能的图源。')
                .description('工具描述'),
        }).description('comic_latest 工具'),
    }),
    koishi_1.Schema.object({
        comicRandomTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_random 工具'),
            name: koishi_1.Schema.string().default('comic_random').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('随机推荐漫画。source 为图源 ID（可用 comic_sources 查询），不填则聚合全部支持随机推荐的图源。')
                .description('工具描述'),
        }).description('comic_random 工具'),
    }),
    koishi_1.Schema.object({
        comicDownloadTool: koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).description('是否注册 comic_download 工具'),
            name: koishi_1.Schema.string().default('comic_download').description('工具名称'),
            description: koishi_1.Schema.string()
                .default('下载漫画/本子为加密PDF并发送给用户。调用后会自动发送PDF文件，并额外发送一条「解密密码」消息（系统已发出，无需你再编造密码）。工具返回的 JSON 含 success/title/password，你必须原样引用 password 字段。最终回复必须包含密码，格式示例：「搜索到 N 个结果：《title1》《title2》...，已下载《title1》，解密密码：123456。如需其他本子请发送本子名」。禁止省略密码；禁止说「文件已发送」却不报密码。用户说"想看xx""来个本子""下载xx"时，先 comic_search，再用第一个匹配项的 source 和 ID 调用本工具。不要分多条消息叙述中间步骤。')
                .description('工具描述'),
        }).description('comic_download 工具'),
    }),
]);
// ============ Zod Schemas ============
const comicSourcesSchema = zod_1.z.object({});
const comicSearchSchema = zod_1.z.object({
    keyword: zod_1.z.string().describe('搜索关键词，可以是漫画名、角色名、画师/作者名等'),
    source: zod_1.z.string().optional()
        .describe('限定图源 ID（如 jm/bika/copy，可用 comic_sources 查询）。不填则聚合全部图源'),
});
const comicDetailSchema = zod_1.z.object({
    comic_id: zod_1.z.string().describe('漫画ID'),
    source: zod_1.z.string().optional()
        .describe('图源 ID（如 jm/bika/copy）。不填则自动识别：纯数字按 jm、24位hex按 bika'),
});
const comicLeaderboardSchema = zod_1.z.object({
    mode: zod_1.z.enum(['day', 'week', 'month', 'total']).optional()
        .describe('排行榜类型：day=日榜(默认), week=周榜, month=月榜, total=总榜。部分图源不支持 total，会自动回退日榜'),
    source: zod_1.z.string().optional()
        .describe('图源 ID。不填则聚合全部支持排行榜的图源'),
    page: zod_1.z.number().int().min(1).optional()
        .describe('页码，默认1'),
});
const comicLatestSchema = zod_1.z.object({
    source: zod_1.z.string().optional()
        .describe('图源 ID。不填则聚合全部支持最近更新的图源'),
});
const comicRandomSchema = zod_1.z.object({
    source: zod_1.z.string().optional()
        .describe('图源 ID。不填则聚合全部支持随机推荐的图源'),
});
const comicDownloadSchema = zod_1.z.object({
    comic_id: zod_1.z.string().describe('漫画ID（从comic_search返回结果中获取）'),
    chapter_id: zod_1.z.string().optional()
        .describe('章节ID，不填默认下载第一话'),
    source: zod_1.z.string().optional()
        .describe('图源 ID（如 jm/bika/copy）。不填则自动识别，建议从 comic_search 结果的 source 字段直接传入'),
});
// ============ 辅助函数 ============
// 与后端 pdf_password_for 保持一致，仅在任务信息缺失密码时兜底使用
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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// 源别名：id / 名称 / 常见别名，大小写不敏感
const EXTRA_ALIASES = {
    jm: ['jm', 'jmcomic', '禁漫', '禁漫天堂', '18comic'],
    bika: ['bika', 'picacg', 'pica', '哔咔', '哔咔漫画', 'picacomic'],
    copy: ['copy', 'copymanga', '拷贝', '拷贝漫画'],
};
const STAGE_LABELS = {
    queued: '排队中',
    fetching: '获取章节信息',
    downloading: '下载图片',
    packaging: '打包PDF',
    completed: '完成',
    failed: '失败',
    cancelled: '已取消',
    interrupted: '已中断',
};
function failResult(error) {
    return { success: false, title: '', password: '', chapterName: '', totalChapters: 0, chapters: [], error };
}
// ============ 主逻辑 ============
function apply(ctx, config) {
    const logger = ctx.logger('comic');
    const base = () => config.apiBase.replace(/\/+$/, '');
    // ---------- 图源清单缓存 ----------
    let manifestCache = { at: 0, list: [] };
    function normalizeErrorBody(body, fallback) {
        if (!body)
            return fallback;
        if (typeof body === 'string')
            return body;
        const err = body.error;
        // 新格式 {error:{code,message,source}}；兼容旧格式 {success:false,error:'...'}
        if (err && typeof err === 'object')
            return err.message || fallback;
        if (typeof err === 'string')
            return err;
        return body.detail || body.message || fallback;
    }
    async function apiGet(path, params) {
        const url = base() + path;
        if (config.logInfo)
            logger.info(`GET ${url} ${params ? JSON.stringify(params) : ''}`);
        try {
            const res = await ctx.http.get(url, { params });
            if (res && typeof res === 'object') {
                const r = res;
                if (r.success === false || (r.error && typeof r.error === 'object' && r.error.code)) {
                    throw new Error(normalizeErrorBody(r, '后端返回未知错误'));
                }
            }
            return res;
        }
        catch (err) {
            const errMsg = normalizeErrorBody(err.response?.data ?? err.data, err.message);
            logger.error(`API 请求失败 [${url}]: ${errMsg}`);
            throw new Error(errMsg);
        }
    }
    async function apiPost(path, data) {
        const url = base() + path;
        if (config.logInfo)
            logger.info(`POST ${url} ${data ? JSON.stringify(data) : ''}`);
        try {
            return await ctx.http.post(url, data);
        }
        catch (err) {
            const errMsg = normalizeErrorBody(err.response?.data ?? err.data, err.message);
            logger.error(`API 请求失败 [${url}]: ${errMsg}`);
            throw new Error(errMsg);
        }
    }
    async function getSources(force = false) {
        if (!force && manifestCache.list.length && Date.now() - manifestCache.at < 60000) {
            return manifestCache.list;
        }
        try {
            const res = await apiGet('/api/sources');
            manifestCache = { at: Date.now(), list: res?.sources || [] };
        }
        catch {
            // 后端不可达时保留旧缓存，不阻塞命令
        }
        return manifestCache.list;
    }
    function sourceNameSync(source) {
        return manifestCache.list.find(m => m.id === source)?.name || source;
    }
    // 解析 "源:ID"、"源|ID"、"源ID"、纯数字ID(jm)、24位hex(bika)
    // 返回 null 表示无法判断来源（按关键词处理）
    function resolveSourceId(raw, manifests) {
        const clean = raw.trim();
        if (!clean)
            return null;
        const alias = new Map();
        for (const m of manifests) {
            alias.set(m.id.toLowerCase(), m.id);
            alias.set(m.name.toLowerCase(), m.id);
            for (const a of EXTRA_ALIASES[m.id] || [])
                alias.set(a.toLowerCase(), m.id);
        }
        // 后端不可达时的兜底别名
        if (!alias.size) {
            for (const [id, names] of Object.entries(EXTRA_ALIASES)) {
                for (const a of names)
                    alias.set(a, id);
            }
        }
        // 显式分隔符：源:ID / 源|ID（全角也支持）
        const sep = clean.match(/^([^\s:：|｜]+)[:：|｜]\s*(\S+)\s*$/);
        if (sep) {
            const src = alias.get(sep[1].toLowerCase());
            if (src)
                return { source: src, id: sep[2] };
        }
        // 前缀形式：jm12345 / 哔咔xxx / 拷贝abc（别名按长度降序优先匹配长名）
        const lower = clean.toLowerCase();
        for (const name of [...alias.keys()].sort((a, b) => b.length - a.length)) {
            if (lower.startsWith(name) && clean.length > name.length) {
                const rest = clean.slice(name.length).trim();
                if (/^[\w-]{2,}$/.test(rest)) {
                    return { source: alias.get(name), id: rest };
                }
            }
        }
        // 裸 ID 启发式
        if (/^[0-9a-fA-F]{24}$/.test(clean)) {
            return { source: alias.get('bika') || 'bika', id: clean };
        }
        if (/^\d+$/.test(clean)) {
            return { source: alias.get('jm') || 'jm', id: clean };
        }
        return null;
    }
    // ========== 核心下载函数（命令和工具共用） ==========
    async function doDownload(session, id, chapterId, opts) {
        const silent = opts?.silent ?? false;
        const manifests = await getSources();
        // 1. 解析来源与 ID
        let source = '';
        let comicId = '';
        const resolved = resolveSourceId(id, manifests);
        if (resolved) {
            source = resolved.source;
            comicId = resolved.id;
        }
        else {
            if (!silent)
                await session.send(`正在搜索并解析本子名「${id}」...`);
            try {
                const searchResult = await apiGet('/api/search', { keyword: id });
                const best = searchResult.best_match || searchResult.items?.[0];
                if (best?.id && best?.source) {
                    source = best.source;
                    comicId = best.id;
                }
                else {
                    for (const [src, list] of Object.entries(searchResult.all_results || {})) {
                        if (list?.length) {
                            source = src;
                            comicId = list[0].id;
                            break;
                        }
                    }
                }
                if (!source || !comicId) {
                    return failResult('未找到相关漫画');
                }
            }
            catch (err) {
                return failResult(`搜索本子名失败: ${err.message}`);
            }
        }
        // 2. 获取详情
        if (!silent)
            await session.send('正在获取漫画详情...');
        let detail;
        try {
            detail = await apiGet(`/api/comic/${source}/${encodeURIComponent(comicId)}`);
        }
        catch (e) {
            return failResult(`获取详情失败: ${e.message}`);
        }
        const srcLabel = sourceNameSync(source);
        if (!detail?.title) {
            return failResult(`未找到该漫画 [${srcLabel} ID: ${comicId}]`);
        }
        if (!detail.chapters?.length) {
            return failResult('该漫画没有可下载的章节');
        }
        // 3. 确定章节
        const chapter = chapterId
            ? detail.chapters.find(c => c.id === chapterId)
            : detail.chapters[0];
        if (!chapter) {
            return failResult(`未找到章节 ${chapterId}`);
        }
        const chapterName = chapter.name;
        const totalChapters = detail.chapters.length;
        // 4. 创建下载任务（comic-api v2 任务式接口）
        if (!silent) {
            if (!chapterId && totalChapters > 1) {
                await session.send(`该漫画共 ${totalChapters} 话，正在下载第一话: ${chapterName}`);
            }
            else {
                await session.send(`正在下载「${detail.title} - ${chapterName}」(${srcLabel})...`);
            }
        }
        let task;
        try {
            task = await apiPost('/api/downloads', {
                source,
                comic_id: comicId,
                chapter_id: chapter.id,
                title: detail.title,
                chapter: chapterName,
            });
        }
        catch (e) {
            return failResult(`创建下载任务失败: ${e.message}`);
        }
        // 5. 轮询任务状态，按阶段/进度节流提示
        const deadline = Date.now() + config.downloadTimeout * 1000;
        let lastStage = '';
        let lastNotify = 0;
        let current = task;
        while (true) {
            try {
                current = await apiGet(`/api/downloads/${task.id}`);
            }
            catch {
                // 轮询失败不致命，继续等
            }
            if (current.status === 'completed')
                break;
            if (current.status === 'failed' || current.status === 'cancelled') {
                return failResult(`下载${current.status === 'failed' ? '失败' : '已取消'}: ${current.error || '未知原因'}`);
            }
            const now = Date.now();
            if (now > deadline) {
                return failResult(`等待超时（${config.downloadTimeout}s）。任务仍在后台执行，可稍后在 comic-api WebUI 下载列表取回，重新执行下载命令会自动复用同一任务。`);
            }
            const stageLabel = STAGE_LABELS[current.stage] || current.stage;
            const progress = current.total > 0 ? ` ${current.completed}/${current.total}` : '';
            if (!silent && (current.stage !== lastStage || now - lastNotify > 15000)) {
                lastStage = current.stage;
                lastNotify = now;
                try {
                    await session.send(`📥 ${stageLabel}${progress}...`);
                }
                catch { /* 发送失败不影响下载 */ }
            }
            await sleep(2000);
        }
        // 6. 取回 PDF 文件
        const pdfPassword = current.password || getPdfPassword(source, comicId, chapter.id);
        const fileUrl = `${base()}/api/downloads/${task.id}/file`;
        if (config.logInfo)
            logger.info(`Fetching PDF: ${fileUrl}`);
        let buffer;
        try {
            const data = await ctx.http.get(fileUrl, { responseType: 'arraybuffer', timeout: 120000 });
            buffer = Buffer.from(data);
        }
        catch (e) {
            return failResult(`下载完成但取回文件失败: ${e.message}。可在 comic-api WebUI 下载列表手动取回。`);
        }
        if (buffer.length < 100) {
            return failResult('下载失败：返回数据异常');
        }
        // 7. 发送文件
        const cleanTitle = source === 'jm' ? `jm${comicId}` : `${source}-${sanitizeFilename(detail.title)}`;
        const filename = `${cleanTitle}.pdf`;
        try {
            if (config.pdfSendMethod === 'file') {
                const tempDir = config.fileSendPath || '/koishi/temp';
                await fs.promises.mkdir(tempDir, { recursive: true });
                const tempFilePath = path.join(tempDir, filename);
                await fs.promises.writeFile(tempFilePath, buffer);
                const fileUri = (0, url_1.pathToFileURL)(tempFilePath).href;
                await session.send(koishi_1.h.file(fileUri));
            }
            else {
                await session.send(koishi_1.h.file(buffer, 'application/pdf', { filename, title: filename }));
            }
        }
        catch (sendErr) {
            logger.warn('发送 PDF 文件失败，尝试提供直接下载链接:', sendErr.message);
            return {
                success: false, title: detail.title, password: pdfPassword, chapterName, totalChapters,
                chapters: detail.chapters, source, comicId,
                error: `发送文件失败，请手动下载: ${fileUrl}`,
            };
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
        };
    }
    const SUBCOMMANDS = ['search', 'download', 'detail', 'leaderboard', 'latest', 'random', 'category', 'sources'];
    // Parent command 'comic' routing logic
    ctx.command('comic [keyword:text]', '多图源漫画搜索与直接下载')
        .action(async ({ session }, keyword) => {
        if (!session)
            return;
        if (!keyword) {
            return session.execute('help comic');
        }
        const clean = keyword.trim();
        // 当 keyword 以子命令名开头时，强制用点号形式转发到子命令。
        // Koishi 的 `comic [keyword:text]` 贪婪参数会吞掉 `comic random` / `comic latest`
        // 这类无参子命令，导致它们被当作搜索词处理。
        const parts = clean.split(/\s+/);
        const firstWord = parts[0].toLowerCase();
        if (SUBCOMMANDS.includes(firstWord)) {
            const rest = parts.slice(1).join(' ');
            return session.execute(`comic.${firstWord}${rest ? ' ' + rest : ''}`);
        }
        const resolved = resolveSourceId(parts[0], await getSources());
        if (resolved) {
            // 兼容旧习惯：禁漫小号数字 ID 多半是误输入的关键词，走搜索
            if (resolved.source === 'jm' && /^\d+$/.test(resolved.id) && parseInt(resolved.id, 10) <= 100) {
                return session.execute(`comic.search ${keyword}`);
            }
            const chapterId = parts.slice(1).join(' ');
            const downloadCmd = chapterId
                ? `comic.download ${resolved.source}:${resolved.id} ${chapterId}`
                : `comic.download ${resolved.source}:${resolved.id}`;
            return session.execute(downloadCmd);
        }
        return session.execute(`comic.search ${keyword}`);
    });
    async function buildDetailText(source, id) {
        try {
            const detail = await apiGet(`/api/comic/${source}/${encodeURIComponent(id)}`);
            if (!detail?.title)
                return null;
            const srcLabel = sourceNameSync(source);
            const parts = [
                `📖 ${detail.title}`,
                `来源: ${srcLabel}(${source}) | ID: ${id}`,
                `作者: ${detail.author || '佚名'}`,
                `简介: ${(detail.description || '无描述').slice(0, 200)}`,
                `章节数: ${detail.chapters?.length || 0}`,
            ];
            if (detail.chapters?.length > 0) {
                const first = detail.chapters[0];
                parts.push(`第一话: [${first.id}] ${first.name}`);
                if (detail.chapters.length > 1) {
                    parts.push(`共 ${detail.chapters.length} 话，如需下载请使用 comic download ${source}:${id} [章节ID]`);
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
    // comic sources：查看图源清单
    ctx.command('comic.sources', '查看可用图源列表')
        .action(async () => {
        const manifests = await getSources(true);
        if (!manifests.length)
            return '未能获取图源列表，请确认 comic-api 后端已启动。';
        const lines = manifests.map(m => {
            const caps = m.capabilities?.join('/') || '';
            let account = '';
            if (m.capabilities?.includes('login')) {
                account = m.account?.authenticated ? '｜已登录' : '｜未登录';
            }
            return `• ${m.name}(${m.id})${account}\n  能力: ${caps}`;
        });
        return `📚 当前图源（共 ${manifests.length} 个）\n${lines.join('\n')}`;
    });
    // comic search <keyword>
    ctx.command('comic.search <keyword:text>', '聚合搜索漫画')
        .action(async ({ session }, keyword) => {
        if (!keyword)
            return '请输入搜索关键词';
        try {
            const manifests = await getSources();
            let result;
            const resolved = resolveSourceId(keyword, manifests);
            if (resolved) {
                // 明确的 源:ID，先按详情直查，失败回退到该源内搜索
                try {
                    const detail = await apiGet(`/api/comic/${resolved.source}/${encodeURIComponent(resolved.id)}`);
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
                            all_results: { [resolved.source]: [mockItem] },
                        };
                    }
                    else {
                        result = await apiGet('/api/search', { keyword: resolved.id, source: resolved.source });
                    }
                }
                catch {
                    result = await apiGet('/api/search', { keyword: resolved.id, source: resolved.source });
                }
            }
            else {
                result = await apiGet('/api/search', { keyword });
            }
            // 单源搜索响应没有 best_match，用排序结果首条兜底
            if (!result.best_match && result.items?.length) {
                result.best_match = result.items[0];
            }
            const groups = result.all_results || {};
            const nameOf = (id) => manifests.find(m => m.id === id)?.name || id;
            // 每图源最多取 8 条，全局统一编号
            const all = [];
            const perSourceLines = {};
            let idx = 1;
            for (const [src, list] of Object.entries(groups)) {
                const items = (list || []).slice(0, 8).map(c => ({ ...c, source: src }));
                perSourceLines[src] = items.map(item => {
                    all.push(item);
                    const line = `${idx}. ${item.title}  作者:${item.author || '佚名'} (ID: ${item.id})`;
                    idx++;
                    return line;
                });
            }
            const totalResults = all.length;
            if (totalResults === 0) {
                const errs = Object.entries(result.errors || {})
                    .map(([src, e]) => `${nameOf(src)}: ${e?.message || '失败'}`)
                    .join('；');
                return errs
                    ? `没有找到关于「${keyword}」的漫画。（部分图源异常：${errs}）`
                    : `没有找到关于「${keyword}」的漫画。`;
            }
            if (!session) {
                const lines = [];
                for (const [src, srcLines] of Object.entries(perSourceLines)) {
                    if (srcLines.length)
                        lines.push(`【 ${nameOf(src)} (${src}) 】`, ...srcLines);
                }
                return lines.join('\n');
            }
            // 合并转发：头部 + 每个图源一条 + 提示
            const msgElements = [];
            let header = `🔍 关键词「${keyword}」共找到 ${totalResults} 个结果`;
            if (result.best_match?.title) {
                const bm = result.best_match;
                header += `\n🏆 最佳匹配 [${bm.source ? nameOf(bm.source) : '?'}]: ${bm.title}`;
            }
            const errNotes = Object.entries(result.errors || {})
                .map(([src, e]) => `${nameOf(src)}(${e?.message || '异常'})`)
                .join('、');
            if (errNotes)
                header += `\n⚠️ 部分图源未返回结果: ${errNotes}`;
            msgElements.push((0, koishi_1.h)('message', header));
            for (const [src, srcLines] of Object.entries(perSourceLines)) {
                if (srcLines.length) {
                    msgElements.push((0, koishi_1.h)('message', `【 ${nameOf(src)} (${src}) 】\n${srcLines.join('\n')}`));
                }
            }
            msgElements.push((0, koishi_1.h)('message', '💡 回复序号下载（如 1），或回复「源|ID」（如 jm|12345），回复其他内容退出。'));
            await session.send((0, koishi_1.h)('message', { forward: true }, msgElements));
            const answer = await session.prompt(30000);
            if (!answer)
                return;
            const cleanAnswer = answer.trim();
            // 序号
            const index = parseInt(cleanAnswer, 10);
            if (!isNaN(index) && /^\d+$/.test(cleanAnswer) && index > 0 && index <= all.length) {
                const pick = all[index - 1];
                return session.execute(`comic.download ${pick.source}:${pick.id}`);
            }
            // 源|ID / 源:ID / 源ID / 裸ID
            const resolved2 = resolveSourceId(cleanAnswer, manifests);
            if (resolved2) {
                return session.execute(`comic.download ${resolved2.source}:${resolved2.id}`);
            }
            return; // 非有效输入，退出
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
            return '用法: comic download <ID|图源:ID> [章节ID]';
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
            return '用法: comic detail <关键词> 或 comic detail <ID|图源:ID>';
        if (!session)
            return '此命令仅支持在会话中使用';
        const manifests = await getSources();
        // 直接给定 ID/源：只查该来源
        const resolved = resolveSourceId(query, manifests);
        if (resolved) {
            return fetchAndShowDetail(session, resolved.source, resolved.id);
        }
        // 关键词模式：聚合搜索后各图源各取最佳匹配展示详情
        try {
            await session.send('正在搜索并获取详情...');
            const result = await apiGet('/api/search', { keyword: query });
            const groups = result.all_results || {};
            const bests = [];
            for (const [src, list] of Object.entries(groups)) {
                if (list?.length)
                    bests.push({ source: src, item: list[0] });
            }
            // 兜底：若没有分组但有排序结果，取前若干去重源
            if (!bests.length && result.items?.length) {
                const seen = new Set();
                for (const item of result.items) {
                    const src = item.source || '';
                    if (src && !seen.has(src)) {
                        seen.add(src);
                        bests.push({ source: src, item });
                    }
                }
            }
            if (!bests.length) {
                return `没有找到关于「${query}」的漫画。`;
            }
            const nameOf = (id) => manifests.find(m => m.id === id)?.name || id;
            const texts = await Promise.all(bests.slice(0, 5).map(b => buildDetailText(b.source, b.item.id)));
            const msgElements = [
                (0, koishi_1.h)('message', `🔍 关键词「${query}」各图源最相似结果详情：`),
            ];
            bests.slice(0, 5).forEach((b, i) => {
                const needLogin = manifests.find(m => m.id === b.source)?.capabilities?.includes('login');
                msgElements.push((0, koishi_1.h)('message', texts[i] || `【 ${nameOf(b.source)} 】详情获取失败${needLogin ? '(该图源可能需先在 comic-api 登录)' : ''}`));
            });
            await session.send((0, koishi_1.h)('message', { forward: true }, msgElements));
            return;
        }
        catch (err) {
            logger.error('详情搜索失败:', err.message);
            return `查询失败: ${err.message}`;
        }
    });
    // 通用浏览：latest / leaderboard / random / category
    async function fetchBrowse(source, action, params) {
        try {
            const res = await apiGet(`/api/${source}/${action}`, params);
            return { ok: true, items: res?.data || [] };
        }
        catch (e) {
            return { ok: false, items: [], error: e.message };
        }
    }
    // comic leaderboard [mode] [page]
    ctx.command('comic.leaderboard [mode:string] [page:number]', '查看排行榜')
        .action(async ({ session }, mode, page) => {
        if (!session)
            return '此命令仅支持在会话中使用';
        const targetMode = (mode || 'day').toLowerCase();
        const targetPage = Math.max(1, Math.floor(page || 1));
        const manifests = await getSources();
        const candidates = manifests.filter(m => m.capabilities?.includes('leaderboard'));
        if (!candidates.length)
            return '当前没有图源支持排行榜。';
        // 校验 mode：取所有源支持的 mode 合集
        const allModes = new Set();
        const modeLabel = new Map();
        for (const m of candidates) {
            for (const lm of m.leaderboard_modes || []) {
                allModes.add(lm.value);
                modeLabel.set(lm.value, lm.label);
            }
        }
        if (allModes.size && !allModes.has(targetMode)) {
            return `mode 必须是 ${[...allModes].join('/')}（默认 day）`;
        }
        try {
            const results = await Promise.all(candidates.map(async (m) => {
                // 该源不支持此 mode 时回退 day（如哔咔无总榜）
                const supported = (m.leaderboard_modes || []).map(x => x.value);
                const effective = supported.length && !supported.includes(targetMode) ? 'day' : targetMode;
                const r = await fetchBrowse(m.id, 'leaderboard', { mode: effective, page: String(targetPage) });
                return { m, effective, ...r };
            }));
            const formatList = (comics) => {
                if (!comics.length)
                    return '暂无数据或获取失败';
                return comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`).join('\n');
            };
            for (const r of results) {
                const label = modeLabel.get(r.effective) || r.effective;
                const suffix = r.effective !== targetMode ? `(该源无${modeLabel.get(targetMode) || targetMode}，已回退${label})` : '';
                const body = r.ok
                    ? (r.items.length ? formatList(r.items) : '暂无数据')
                    : `获取失败: ${r.error}`;
                await session.send(`【 ${r.m.name} (${r.m.id}) ${label}${suffix} · 第${targetPage}页 】\n${body}`);
            }
            return;
        }
        catch (err) {
            logger.error('获取排行榜失败:', err.message);
            return `获取排行榜失败: ${err.message}`;
        }
    });
    // 翻页累积拉取，直到达到 limit 条或没有更多（最多翻 maxPages 页防止狂刷后端）
    async function fetchUpTo(source, action, limit, params = {}, maxPages = 5) {
        const acc = [];
        for (let page = 1; page <= maxPages && acc.length < limit; page++) {
            const r = await fetchBrowse(source, action, { ...params, page: String(page) });
            if (!r.ok || !r.items.length)
                break;
            acc.push(...r.items);
        }
        return acc.slice(0, limit);
    }
    // comic latest
    ctx.command('comic.latest', '查看最近更新')
        .alias('最新漫画')
        .alias('漫画更新')
        .option('number', '-n <count:number> 每个图源显示数量(默认10，最多50)')
        .action(async ({ session, options }) => {
        if (!session)
            return '此命令仅支持在会话中使用';
        const limit = Math.min(50, Math.max(1, Math.floor(options?.number || 10)));
        const manifests = (await getSources()).filter(m => m.capabilities?.includes('latest'));
        if (!manifests.length)
            return '当前没有图源支持最近更新。';
        try {
            const formatList = (comics) => {
                if (!comics.length)
                    return '暂无数据或获取失败';
                return comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`).join('\n');
            };
            const results = await Promise.all(manifests.map(async (m) => ({
                m,
                items: await fetchUpTo(m.id, 'latest', limit).catch(() => []),
            })));
            for (const r of results) {
                const needLogin = r.m.capabilities?.includes('login') && r.m.account && !r.m.account.authenticated && !r.items.length;
                const body = r.items.length
                    ? formatList(r.items)
                    : (needLogin ? '暂无数据或获取失败(该图源需先在 comic-api 登录)' : '暂无数据或获取失败');
                await session.send(`【 ${r.m.name} (${r.m.id}) 最近更新 · ${r.items.length}条 】\n${body}`);
            }
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
            const r = await fetchBrowse(source, 'random', {});
            if (!r.ok || !r.items.length)
                break;
            for (const item of r.items) {
                if (item?.id && !map.has(item.id))
                    map.set(item.id, item);
            }
        }
        return Array.from(map.values()).slice(0, limit);
    }
    // comic random
    ctx.command('comic.random', '随机推荐漫画')
        .alias('随机漫画')
        .option('number', '-n <count:number> 每个图源推荐数量(默认5，最多20)')
        .action(async ({ session, options }) => {
        const limit = Math.min(20, Math.max(1, Math.floor(options?.number || 5)));
        const manifests = (await getSources()).filter(m => m.capabilities?.includes('random'));
        if (!manifests.length)
            return '当前没有图源支持随机推荐。';
        const results = await Promise.all(manifests.map(async (m) => ({
            m,
            items: await fetchRandomUpTo(m.id, limit).catch(() => []),
        })));
        const formatList = (comics, label) => {
            if (!comics.length)
                return `【 ${label} 】暂无数据或获取失败`;
            const lines = comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`);
            return `🎲 ${label} 随机推荐 · ${comics.length}个\n${lines.join('\n')}`;
        };
        const texts = results.map(r => {
            const needLogin = r.m.capabilities?.includes('login') && r.m.account && !r.m.account.authenticated && !r.items.length;
            return needLogin ? `🎲 ${r.m.name} 随机推荐\n暂无数据或获取失败(该图源需先登录)` : formatList(r.items, r.m.name);
        });
        if (session) {
            for (const t of texts)
                await session.send(t);
            await session.send('💡 如需下载，请使用 comic download <图源:ID> 或 comic download <ID>');
            return;
        }
        return texts.join('\n\n');
    });
    // comic category [name] [page]
    ctx.command('comic.category [query:text]', '按分类浏览漫画')
        .option('page', '-p <page:number> 页码(默认1)')
        .action(async ({ session, options }, query) => {
        if (!session)
            return '此命令仅支持在会话中使用';
        const manifests = (await getSources()).filter(m => m.capabilities?.includes('category'));
        if (!manifests.length)
            return '当前没有图源支持分类浏览。';
        const page = Math.max(1, Math.floor(options?.page || 1));
        // 不带参数：列出各图源分类
        if (!query?.trim()) {
            const msgElements = [(0, koishi_1.h)('message', '📂 各图源可用分类：')];
            for (const m of manifests) {
                const cats = (m.categories || []).map(c => c.label).join('、') || '无';
                msgElements.push((0, koishi_1.h)('message', `【 ${m.name} (${m.id}) 】\n${cats}`));
            }
            msgElements.push((0, koishi_1.h)('message', '💡 用法: comic category <分类名> [-p 页码]，跨图源同名分类会分别展示'));
            await session.send((0, koishi_1.h)('message', { forward: true }, msgElements));
            return;
        }
        // 解析 "分类名 页码" 或 "图源:分类名"
        const parts = query.trim().split(/\s+/);
        let trailingPage = page;
        if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
            trailingPage = Math.max(1, parseInt(parts.pop(), 10));
        }
        const catQuery = parts.join(' ');
        // 支持 "图源:分类" 指定单一图源
        const resolved = resolveSourceId(catQuery, manifests);
        const targets = resolved
            ? manifests.filter(m => m.id === resolved.source)
            : manifests;
        const catName = resolved ? resolved.id : catQuery;
        if (resolved && !targets.length) {
            return `图源 ${resolved.source} 不支持分类浏览。`;
        }
        // 匹配分类 value：先精确匹配 value/label，再模糊包含
        const jobs = targets.map(m => {
            const cats = m.categories || [];
            const exact = cats.find(c => c.value === catName || c.label === catName);
            const fuzzy = exact ? undefined : cats.find(c => c.label.includes(catName) || c.value.includes(catName));
            const chosen = exact || fuzzy;
            return { m, chosen };
        });
        const hits = jobs.filter(j => j.chosen);
        if (!hits.length) {
            const available = jobs.map(j => `【${j.m.name}】${(j.m.categories || []).map(c => c.label).join('、') || '无'}`).join('\n');
            return `未找到分类「${catName}」。可用分类：\n${available}`;
        }
        const formatList = (comics) => {
            if (!comics.length)
                return '暂无数据或获取失败';
            return comics.map((c, i) => `${i + 1}. ${c.title}  作者:${c.author || '佚名'} (ID: ${c.id})`).join('\n');
        };
        const results = await Promise.all(hits.map(async (j) => ({
            m: j.m,
            cat: j.chosen,
            r: await fetchBrowse(j.m.id, 'category', { name: j.chosen.value, page: String(trailingPage) }),
        })));
        for (const r of results) {
            const body = r.r.ok ? formatList(r.r.items) : `获取失败: ${r.r.error}`;
            await session.send(`【 ${r.m.name} (${r.m.id}) · ${r.cat.label} · 第${trailingPage}页 】\n${body}`);
        }
        await session.send('💡 如需下载，请使用 comic download <图源:ID>');
        return;
    });
    // ========== 工具创建函数 ==========
    function createComicSourcesTool(cfg) {
        const toolCfg = cfg.comicSourcesTool;
        return (0, tools_1.tool)(async () => {
            try {
                const manifests = await getSources(true);
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
                });
            }
            catch (err) {
                return JSON.stringify({ error: err.message || '请求失败' });
            }
        }, {
            name: toolCfg.name || 'comic_sources',
            description: toolCfg.description || '查看可用漫画图源列表',
            schema: comicSourcesSchema,
        });
    }
    function createComicSearchTool(cfg) {
        const toolCfg = cfg.comicSearchTool;
        return (0, tools_1.tool)(async (input) => {
            try {
                if (!input.keyword) {
                    return JSON.stringify({ error: '搜索时 keyword 不能为空' });
                }
                const params = { keyword: input.keyword };
                if (input.source)
                    params.source = input.source;
                const result = await apiGet('/api/search', params);
                const flat = result.items?.length
                    ? result.items
                    : Object.entries(result.all_results || {}).flatMap(([src, list]) => (list || []).map(c => ({ ...c, source: c.source || src })));
                // 返回前5条（含标题），让AI在最终回复中列出名字供用户参考
                return JSON.stringify({
                    keyword: input.keyword,
                    best_match: result.best_match || flat[0] || null,
                    total: flat.length,
                    results: flat.slice(0, 5),
                    errors: result.errors || {},
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
            try {
                if (!input.comic_id) {
                    return JSON.stringify({ error: '查看详情时 comic_id 不能为空' });
                }
                const manifests = await getSources();
                const resolved = resolveSourceId(input.comic_id, manifests);
                const source = input.source || resolved?.source || 'jm';
                const id = resolved?.id || input.comic_id;
                const detail = await apiGet(`/api/comic/${source}/${encodeURIComponent(id)}`);
                if (!detail?.title) {
                    return JSON.stringify({ error: '未找到该漫画' });
                }
                return JSON.stringify({
                    title: detail.title,
                    author: detail.author,
                    description: detail.description,
                    source: detail.source || source,
                    id,
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
            try {
                const mode = input.mode || 'day';
                const page = String(input.page || 1);
                const manifests = (await getSources()).filter(m => m.capabilities?.includes('leaderboard'));
                if (input.source) {
                    const result = await fetchBrowse(input.source, 'leaderboard', { mode, page });
                    return JSON.stringify({
                        source: input.source,
                        mode,
                        page: Number(page),
                        total: result.items.length,
                        results: result.items,
                        error: result.ok ? undefined : result.error,
                    });
                }
                // 聚合全部支持排行榜的源，按源分组返回
                const entries = await Promise.all(manifests.map(async (m) => {
                    const supported = (m.leaderboard_modes || []).map(x => x.value);
                    const effective = supported.length && !supported.includes(mode) ? 'day' : mode;
                    const r = await fetchBrowse(m.id, 'leaderboard', { mode: effective, page });
                    return [m.id, {
                            name: m.name,
                            mode: effective,
                            total: r.items.length,
                            results: r.items,
                            error: r.ok ? undefined : r.error,
                        }];
                }));
                return JSON.stringify({ mode, page: Number(page), sources: Object.fromEntries(entries) });
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
            try {
                const manifests = (await getSources()).filter(m => m.capabilities?.includes('latest'));
                if (input.source) {
                    const result = await fetchBrowse(input.source, 'latest', { page: '1' });
                    return JSON.stringify({
                        source: input.source,
                        total: result.items.length,
                        results: result.items,
                        error: result.ok ? undefined : result.error,
                    });
                }
                const entries = await Promise.all(manifests.map(async (m) => {
                    const r = await fetchBrowse(m.id, 'latest', { page: '1' });
                    return [m.id, {
                            name: m.name,
                            total: r.items.length,
                            results: r.items,
                            error: r.ok ? undefined : r.error,
                        }];
                }));
                return JSON.stringify({ sources: Object.fromEntries(entries) });
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
            try {
                const manifests = (await getSources()).filter(m => m.capabilities?.includes('random'));
                if (input.source) {
                    const result = await fetchBrowse(input.source, 'random', {});
                    return JSON.stringify({
                        source: input.source,
                        results: result.items,
                        error: result.ok ? undefined : result.error,
                    });
                }
                const entries = await Promise.all(manifests.map(async (m) => {
                    const r = await fetchBrowse(m.id, 'random', {});
                    return [m.id, {
                            name: m.name,
                            results: r.items,
                            error: r.ok ? undefined : r.error,
                        }];
                }));
                return JSON.stringify({ sources: Object.fromEntries(entries) });
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
                const query = input.source ? `${input.source}:${input.comic_id}` : input.comic_id;
                const result = await doDownload(session, query, input.chapter_id, { silent: true });
                if (!result.success) {
                    return JSON.stringify({ error: result.error || '下载失败' });
                }
                // 工具路径不依赖 LLM 转述密码：文件发出后由代码直接推送密码，避免模型省略
                try {
                    await session.send(`🔑 该 PDF 已加密，解密密码为：${result.password}`);
                }
                catch (sendPwdErr) {
                    logger.warn('发送 PDF 密码失败:', sendPwdErr?.message || sendPwdErr);
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
                    source: result.source,
                    password_sent: true,
                    must_include_in_reply: `已下载《${result.title}》${chapterInfo}，解密密码：${result.password}`,
                    hint: `PDF与密码均已发送到聊天。最终回复必须原样包含密码 ${result.password}，不可省略。建议格式：列出搜索结果标题，并说明：已下载《${result.title}》${chapterInfo}，解密密码：${result.password}。整段一条消息完成。`,
                });
            }
            catch (err) {
                return JSON.stringify({ error: err.message || '下载请求失败' });
            }
        }, {
            name: toolCfg.name || 'comic_download',
            description: toolCfg.description || '下载漫画/本子为加密PDF并发送给用户；系统会自动发送解密密码，工具返回 password 字段，最终回复必须包含该密码',
            schema: comicDownloadSchema,
        });
    }
    // Re-register tools whenever the optional ChatLuna service is loaded or reloaded.
    ctx.inject(['chatluna'], (ctx) => {
        const meta = {
            source: 'extension',
            group: 'comic',
            tags: ['comic', 'manga'],
            defaultAvailability: {
                enabled: true,
                main: true,
                chatluna: true,
                characterScope: 'all',
            },
        };
        const tools = [
            [config.comicSourcesTool, 'comic_sources', '查看可用漫画图源列表', () => createComicSourcesTool(config)],
            [config.comicSearchTool, 'comic_search', '搜索漫画', () => createComicSearchTool(config)],
            [config.comicDetailTool, 'comic_detail', '查看漫画详情', () => createComicDetailTool(config)],
            [config.comicLeaderboardTool, 'comic_leaderboard', '查看漫画排行榜', () => createComicLeaderboardTool(config)],
            [config.comicLatestTool, 'comic_latest', '查看最近更新的漫画', () => createComicLatestTool(config)],
            [config.comicRandomTool, 'comic_random', '随机推荐漫画', () => createComicRandomTool(config)],
            [config.comicDownloadTool, 'comic_download', '下载漫画/本子并发送给用户', () => createComicDownloadTool(config)],
        ];
        ctx.effect(() => {
            const chatluna = ctx.get('chatluna');
            const registerTool = chatluna?.platform?.registerTool;
            if (!registerTool) {
                logger.warn('ChatLuna platform service is missing, skip comic tool registration');
                return () => { };
            }
            const disposers = [];
            for (const [toolConfig, defaultName, defaultDescription, createTool] of tools) {
                if (!toolConfig.enabled)
                    continue;
                const toolName = toolConfig.name || defaultName;
                try {
                    disposers.push(registerTool.call(chatluna.platform, toolName, {
                        description: toolConfig.description || defaultDescription,
                        selector() { return true; },
                        createTool,
                        meta,
                    }));
                    logger.info(`ChatLuna 工具「${toolName}」已注册`);
                }
                catch (error) {
                    logger.warn(`注册 ChatLuna 工具「${toolName}」失败: ${error instanceof Error ? error.message : error}`);
                }
            }
            return () => {
                for (const dispose of disposers)
                    dispose?.();
            };
        });
    });
}
//# sourceMappingURL=index.js.map