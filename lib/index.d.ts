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
};
export declare const usage = "\n<h2>\u805A\u5408\u6F2B\u753B\u641C\u7D22\u4E0E\u4E0B\u8F7D\u63D2\u4EF6</h2>\n<p>\u4F7F\u7528\u524D\u8BF7\u5148\u90E8\u7F72 <a href=\"https://github.com/lumia1998/comic-api\">comic-api</a> \u540E\u7AEF\u670D\u52A1</p>\n<p>\u652F\u6301\u7981\u6F2B\u5929\u5802(JM)\u548C\u54D4\u5494\u6F2B\u753B(Bika)\u53CC\u5E73\u53F0\u805A\u5408\u641C\u7D22</p>\n<h3>\u547D\u4EE4\u5217\u8868</h3>\n<ul>\n  <li><code>comic [\u5173\u952E\u8BCD]</code> - \u805A\u5408\u641C\u7D22/\u76F4\u63A5\u4E0B\u8F7D\u6F2B\u753B</li>\n  <li><code>comic search &lt;\u5173\u952E\u8BCD/ID&gt;</code> - \u805A\u5408\u641C\u7D22\u6F2B\u753B\uFF0C\u5404\u5E73\u53F0\u6700\u591A8\u6761\uFF0C\u5408\u5E76\u8F6C\u53D1\u5E76\u6807\u6CE8\u6765\u6E90</li>\n  <li><code>comic download &lt;ID&gt; [\u7AE0\u8282ID]</code> - \u4E0B\u8F7D\u6F2B\u753BPDF</li>\n  <li><code>comic detail &lt;\u5173\u952E\u8BCD/ID&gt;</code> - \u67E5\u770B\u6F2B\u753B\u8BE6\u60C5\uFF0C\u5173\u952E\u8BCD\u6A21\u5F0F\u4E0B\u53CC\u5E73\u53F0\u5404\u5C55\u793A\u6700\u76F8\u4F3C\u7ED3\u679C</li>\n  <li><code>comic leaderboard [\u7C7B\u578B] [\u9875\u7801]</code> - \u6392\u884C\u699C(\u7C7B\u578B: day/week/month/total\uFF0C\u9ED8\u8BA4day)\uFF0C\u53CC\u5E73\u53F0\u52062\u6761\u53D1\u9001</li>\n  <li><code>comic latest [-n \u6570\u91CF]</code> - \u6700\u8FD1\u66F4\u65B0\uFF0C\u6BCF\u5E73\u53F0\u9ED8\u8BA410\u6761(\u6700\u591A50)\uFF0C\u53CC\u5E73\u53F0\u52062\u6761\u53D1\u9001</li>\n  <li><code>comic random [-n \u6570\u91CF]</code> - \u968F\u673A\u63A8\u8350\uFF0C\u6BCF\u5E73\u53F0\u9ED8\u8BA45\u4E2A(\u6700\u591A20)\uFF0C\u53CC\u5E73\u53F0\u52062\u6761\u53D1\u9001</li>\n</ul>\n";
export interface ToolConfig {
    enabled: boolean;
    name: string;
    description: string;
}
export interface Config {
    apiBase: string;
    concurrency: number;
    logInfo: boolean;
    pdfPassword?: string;
    pdfSendMethod: 'buffer' | 'file';
    fileSendPath: string;
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