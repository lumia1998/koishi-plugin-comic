import { Context, Schema } from 'koishi';
declare module 'koishi' {
    interface Context {
        chatluna: {
            platform: {
                registerTool(name: string, options: {
                    description: string;
                    selector: () => boolean;
                    createTool: () => any;
                    meta: {
                        source: string;
                        group: string;
                        tags: string[];
                        defaultAvailability: {
                            enabled: boolean;
                            main: boolean;
                            chatluna: boolean;
                            characterScope: string;
                        };
                    };
                }): () => void;
            };
            createChatModel(target: string): Promise<any>;
        };
    }
}
export declare const inject: {
    required: string[];
    optional: string[];
};
export declare const usage = "\n<h2>\u591A\u56FE\u6E90\u6F2B\u753B\u641C\u7D22\u4E0E\u4E0B\u8F7D\u63D2\u4EF6</h2>\n<p>\u4F7F\u7528\u524D\u8BF7\u5148\u90E8\u7F72 <a href=\"https://github.com/lumia1998/comic-api\">comic-api</a> \u540E\u7AEF\u670D\u52A1\uFF08v2.x\uFF09</p>\n<p>\u56FE\u6E90\u7531\u540E\u7AEF\u63D2\u4EF6\u5316\u63D0\u4F9B\uFF08\u5185\u7F6E\u7981\u6F2B\u5929\u5802/\u54D4\u5494\u6F2B\u753B/\u62F7\u8D1D\u6F2B\u753B\uFF09\uFF0C\u672C\u63D2\u4EF6\u81EA\u52A8\u53D1\u73B0\u5168\u90E8\u53EF\u7528\u56FE\u6E90\u3002</p>\n<h3>\u547D\u4EE4\u5217\u8868</h3>\n<ul>\n  <li><code>comic [\u5173\u952E\u8BCD]</code> - \u805A\u5408\u641C\u7D22/\u76F4\u63A5\u4E0B\u8F7D\u6F2B\u753B</li>\n  <li><code>comic search &lt;\u5173\u952E\u8BCD/ID&gt;</code> - \u805A\u5408\u641C\u7D22\u6F2B\u753B\uFF0C\u5404\u56FE\u6E90\u6700\u591A8\u6761\uFF0C\u5408\u5E76\u8F6C\u53D1\u5E76\u6807\u6CE8\u6765\u6E90</li>\n  <li><code>comic download &lt;ID|\u56FE\u6E90:ID&gt; [\u7AE0\u8282ID]</code> - \u4E0B\u8F7D\u6F2B\u753BPDF\uFF08\u540E\u53F0\u4EFB\u52A1\uFF0C\u5E26\u8FDB\u5EA6\u63D0\u793A\uFF09</li>\n  <li><code>comic detail &lt;\u5173\u952E\u8BCD/ID&gt;</code> - \u67E5\u770B\u6F2B\u753B\u8BE6\u60C5\uFF0C\u5173\u952E\u8BCD\u6A21\u5F0F\u4E0B\u5404\u56FE\u6E90\u5404\u5C55\u793A\u6700\u76F8\u4F3C\u7ED3\u679C</li>\n  <li><code>comic leaderboard [\u7C7B\u578B] [\u9875\u7801]</code> - \u6392\u884C\u699C(\u7C7B\u578B: day/week/month/total\uFF0C\u9ED8\u8BA4day)\uFF0C\u6309\u56FE\u6E90\u5206\u6761\u53D1\u9001</li>\n  <li><code>comic latest [-n \u6570\u91CF]</code> - \u6700\u8FD1\u66F4\u65B0\uFF0C\u6BCF\u56FE\u6E90\u9ED8\u8BA410\u6761(\u6700\u591A50)\uFF0C\u6309\u56FE\u6E90\u5206\u6761\u53D1\u9001</li>\n  <li><code>comic random [-n \u6570\u91CF]</code> - \u968F\u673A\u63A8\u8350\uFF0C\u6BCF\u56FE\u6E90\u9ED8\u8BA45\u4E2A(\u6700\u591A20)\uFF0C\u6309\u56FE\u6E90\u5206\u6761\u53D1\u9001</li>\n  <li><code>comic category [\u5206\u7C7B\u540D] [\u9875\u7801]</code> - \u6309\u5206\u7C7B\u6D4F\u89C8\uFF1B\u4E0D\u5E26\u53C2\u6570\u5217\u51FA\u5404\u56FE\u6E90\u53EF\u7528\u5206\u7C7B</li>\n  <li><code>comic sources</code> - \u67E5\u770B\u540E\u7AEF\u5F53\u524D\u56FE\u6E90\u5217\u8868\u3001\u80FD\u529B\u4E0E\u767B\u5F55\u72B6\u6001</li>\n</ul>\n<p>\u6307\u5B9A\u56FE\u6E90\u7684\u5199\u6CD5\uFF1A<code>\u56FE\u6E90\u540D:ID</code> \u6216 <code>\u56FE\u6E90\u540D|ID</code>\uFF08\u5982 <code>jm:12345</code>\u3001<code>\u54D4\u5494|xxx</code>\uFF09\u3002\u7EAF\u6570\u5B57 ID \u9ED8\u8BA4\u6309\u7981\u6F2B\u5904\u7406\uFF0C24\u4F4D\u5341\u516D\u8FDB\u5236 ID \u9ED8\u8BA4\u6309\u54D4\u5494\u5904\u7406\u3002</p>\n";
export interface ToolConfig {
    enabled: boolean;
    name: string;
    description: string;
}
export interface Config {
    apiBase: string;
    logInfo: boolean;
    downloadTimeout: number;
    pdfSendMethod: 'buffer' | 'file';
    fileSendPath: string;
    comicSourcesTool: ToolConfig;
    comicSearchTool: ToolConfig;
    comicDetailTool: ToolConfig;
    comicLeaderboardTool: ToolConfig;
    comicLatestTool: ToolConfig;
    comicRandomTool: ToolConfig;
    comicDownloadTool: ToolConfig;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map