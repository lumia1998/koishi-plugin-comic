"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.usage = exports.inject = void 0;
exports.apply = apply;
const koishi_1 = require("koishi");
exports.inject = ['http'];
exports.usage = `
<h2>聚合漫画搜索与下载插件</h2>
<p>使用前请先部署 <a href="https://github.com/lumia1998/comic-api">comic-api</a> 后端服务</p>
<p>支持禁漫天堂(JM)和哔咔漫画(Bika)双平台聚合搜索</p>
<h3>命令列表</h3>
<ul>
  <li><code>comic search &lt;关键词&gt;</code> - 聚合搜索漫画</li>
  <li><code>comic download &lt;jm|bika&gt; &lt;ID&gt; [章节ID]</code> - 下载漫画PDF</li>
  <li><code>comic detail &lt;jm|bika&gt; &lt;ID&gt;</code> - 查看漫画详情</li>
  <li><code>comic leaderboard [jm|bika] [day|week|month|total]</code> - 排行榜</li>
  <li><code>comic category &lt;jm|bika&gt; &lt;分类名&gt;</code> - 分类浏览</li>
  <li><code>comic latest [jm|bika]</code> - 最近更新</li>
  <li><code>comic random [jm|bika]</code> - 随机推荐</li>
</ul>
`;
exports.Config = koishi_1.Schema.object({
    apiBase: koishi_1.Schema.string()
        .description('comic-api 后端地址')
        .default('http://127.0.0.1:8699'),
    defaultSource: koishi_1.Schema.union(['jm', 'bika'])
        .description('默认漫画源')
        .default('jm'),
    concurrency: koishi_1.Schema.number()
        .description('下载并发数')
        .default(4),
    logInfo: koishi_1.Schema.boolean()
        .description('打印 API 调用日志')
        .default(false),
});
function formatComics(comics, sourceLabel = '') {
    if (!comics || comics.length === 0)
        return '没有找到相关漫画。';
    return comics.map((c, i) => {
        const src = c.source === 'jm' ? '禁漫' : c.source === 'bika' ? '哔咔' : sourceLabel;
        return `${i + 1}. [${src}|${c.id}] ${c.title}  作者:${c.author || '佚名'}`;
    }).join('\n');
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
        const res = await ctx.http.get(url);
        return res;
    }
    // comic search <keyword>
    ctx.command('comic search <keyword:text>', '聚合搜索漫画（禁漫+哔咔）')
        .action(async ({ session }, keyword) => {
        if (!keyword)
            return '请输入搜索关键词';
        try {
            const result = await apiGet('/api/search', { keyword });
            const parts = [];
            if (result.best_match?.title) {
                const bm = result.best_match;
                const srcLabel = bm.source === 'jm' ? '禁漫' : '哔咔';
                parts.push(`🏆 最佳匹配 [${srcLabel}|${bm.id}]:`);
                parts.push(`  ${bm.title}  作者:${bm.author || '佚名'}`);
                parts.push('');
            }
            const jmList = result.all_results?.jm || [];
            const bikaList = result.all_results?.bika || [];
            const all = [...jmList.map(c => ({ ...c, source: 'jm' })), ...bikaList.map(c => ({ ...c, source: 'bika' }))];
            if (all.length > 0) {
                parts.push(`找到 ${all.length} 个结果：`);
                parts.push(formatComics(all));
                parts.push('');
                parts.push('回复序号或「禁漫/哔咔|ID」下载');
            }
            else {
                parts.push('没有找到任何结果');
            }
            return parts.join('\n');
        }
        catch (err) {
            logger.error('搜索失败:', err.message);
            return `搜索失败: ${err.message}`;
        }
    });
    // comic detail <source> <id>
    ctx.command('comic detail <source:string> <id:string>', '查看漫画详情和章节列表')
        .action(async ({ session }, source, id) => {
        if (!source || !id)
            return '用法: comic detail <jm|bika> <ID>';
        source = source.toLowerCase();
        if (source !== 'jm' && source !== 'bika')
            return 'source 必须是 jm 或 bika';
        try {
            const detail = await apiGet(`/api/comic/${source}/${id}`);
            if (!detail?.title)
                return '未找到该漫画';
            const srcLabel = source === 'jm' ? '禁漫' : '哔咔';
            const parts = [
                `📖 ${detail.title}`,
                `来源: ${srcLabel} | ID: ${id}`,
                `作者: ${detail.author || '佚名'}`,
                `简介: ${(detail.description || '无描述').slice(0, 200)}`,
                `章节数: ${detail.chapters?.length || 0}`,
            ];
            if (detail.chapters?.length > 0) {
                const first = detail.chapters[0];
                parts.push(`\n第一话: [${first.id}] ${first.name}`);
                if (detail.chapters.length > 1) {
                    parts.push(`共 ${detail.chapters.length} 话，如需下载请用 comic download 命令`);
                }
            }
            return parts.join('\n');
        }
        catch (err) {
            logger.error('获取详情失败:', err.message);
            return `获取详情失败: ${err.message}`;
        }
    });
    // comic download <source> <id> [chapterId]
    ctx.command('comic download <source:string> <id:string> [chapterId:string]', '下载漫画PDF（默认第一话）')
        .action(async ({ session }, source, id, chapterId) => {
        if (!source || !id)
            return '用法: comic download <jm|bika> <ID> [章节ID]';
        source = source.toLowerCase();
        if (source !== 'jm' && source !== 'bika')
            return 'source 必须是 jm 或 bika';
        if (!session)
            return '此命令仅支持在会话中使用';
        try {
            await session.send('正在获取漫画详情...');
            const detail = await apiGet(`/api/comic/${source}/${id}`);
            if (!detail?.title)
                return '未找到该漫画';
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
            const downloadUrl = config.apiBase.replace(/\/+$/, '')
                + `/api/download/${source}/${id}/${chapter.id}`
                + `?title=${encodeURIComponent(detail.title)}`
                + `&chapter=${encodeURIComponent(chapterName)}`
                + `&concurrency=${config.concurrency}`;
            if (config.logInfo)
                logger.info(`Downloading: ${downloadUrl}`);
            const response = await ctx.http.get(downloadUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response);
            if (buffer.length < 100) {
                return '下载失败：返回数据异常';
            }
            const filename = `${id}_${chapter.id}.pdf`;
            const fileElement = koishi_1.h.file(buffer, 'application/pdf', { filename });
            await session.send(fileElement);
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
    // comic leaderboard [source] [mode]
    ctx.command('comic leaderboard [source:string] [mode:string]', '查看排行榜')
        .action(async ({ session }, source, mode) => {
        source = (source || config.defaultSource).toLowerCase();
        if (source !== 'jm' && source !== 'bika')
            return 'source 必须是 jm 或 bika';
        mode = mode || 'day';
        if (!['day', 'week', 'month', 'total'].includes(mode)) {
            return 'mode 必须是 day/week/month/total';
        }
        try {
            const result = await apiGet(`/api/${source}/leaderboard`, { mode });
            const srcLabel = source === 'jm' ? '禁漫' : '哔咔';
            const modeMap = { day: '日榜', week: '周榜', month: '月榜', total: '总榜' };
            if (!result.data?.length)
                return `${srcLabel} ${modeMap[mode]}暂无数据`;
            const comics = result.data.map(c => ({ ...c, source }));
            return `[${srcLabel} ${modeMap[mode]}]\n${formatComics(comics)}`;
        }
        catch (err) {
            logger.error('获取排行榜失败:', err.message);
            return `获取排行榜失败: ${err.message}`;
        }
    });
    // comic category <source> <name>
    ctx.command('comic category <source:string> <name:string>', '按分类浏览漫画')
        .action(async ({ session }, source, name) => {
        if (!source || !name)
            return '用法: comic category <jm|bika> <分类名>';
        source = source.toLowerCase();
        if (source !== 'jm' && source !== 'bika')
            return 'source 必须是 jm 或 bika';
        try {
            const result = await apiGet(`/api/${source}/category`, { name });
            const srcLabel = source === 'jm' ? '禁漫' : '哔咔';
            if (!result.data?.length)
                return `${srcLabel} 分类「${name}」暂无数据`;
            const comics = result.data.map(c => ({ ...c, source }));
            return `[${srcLabel} 分类「${name}」]\n${formatComics(comics)}`;
        }
        catch (err) {
            logger.error('获取分类失败:', err.message);
            return `获取分类失败: ${err.message}`;
        }
    });
    // comic latest [source]
    ctx.command('comic latest [source:string]', '查看最近更新')
        .action(async ({ session }, source) => {
        source = (source || config.defaultSource).toLowerCase();
        if (source !== 'jm' && source !== 'bika')
            return 'source 必须是 jm 或 bika';
        try {
            const result = await apiGet(`/api/${source}/latest`);
            const srcLabel = source === 'jm' ? '禁漫' : '哔咔';
            if (!result.data?.length)
                return `${srcLabel} 最近更新暂无数据`;
            const comics = result.data.map(c => ({ ...c, source }));
            return `[${srcLabel} 最近更新]\n${formatComics(comics)}`;
        }
        catch (err) {
            logger.error('获取最近更新失败:', err.message);
            return `获取最近更新失败: ${err.message}`;
        }
    });
    // comic random [source]
    ctx.command('comic random [source:string]', '随机推荐漫画')
        .action(async ({ session }, source) => {
        source = (source || config.defaultSource).toLowerCase();
        if (source !== 'jm' && source !== 'bika')
            return 'source 必须是 jm 或 bika';
        try {
            const result = await apiGet(`/api/${source}/random`);
            const srcLabel = source === 'jm' ? '禁漫' : '哔咔';
            const comic = result.data;
            if (!comic?.title)
                return `${srcLabel} 随机推荐暂无数据`;
            const item = { ...comic, source };
            return `[${srcLabel} 随机推荐]\n${formatComics([item])}`;
        }
        catch (err) {
            logger.error('获取随机推荐失败:', err.message);
            return `获取随机推荐失败: ${err.message}`;
        }
    });
}
//# sourceMappingURL=index.js.map