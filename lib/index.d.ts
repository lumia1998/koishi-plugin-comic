import { Context, Schema } from 'koishi';
export declare const inject: string[];
export declare const usage = "\n<h2>\u805A\u5408\u6F2B\u753B\u641C\u7D22\u4E0E\u4E0B\u8F7D\u63D2\u4EF6</h2>\n<p>\u4F7F\u7528\u524D\u8BF7\u5148\u90E8\u7F72 <a href=\"https://github.com/lumia1998/comic-api\">comic-api</a> \u540E\u7AEF\u670D\u52A1</p>\n<p>\u652F\u6301\u7981\u6F2B\u5929\u5802(JM)\u548C\u54D4\u5494\u6F2B\u753B(Bika)\u53CC\u5E73\u53F0\u805A\u5408\u641C\u7D22</p>\n<h3>\u547D\u4EE4\u5217\u8868</h3>\n<ul>\n  <li><code>comic [\u5173\u952E\u8BCD]</code> - \u805A\u5408\u641C\u7D22/\u76F4\u63A5\u4E0B\u8F7D\u6F2B\u753B</li>\n  <li><code>comic search &lt;\u5173\u952E\u8BCD&gt;</code> - \u805A\u5408\u641C\u7D22\u6F2B\u753B</li>\n  <li><code>comic download &lt;ID&gt; [\u7AE0\u8282ID]</code> - \u4E0B\u8F7D\u6F2B\u753BPDF</li>\n  <li><code>comic detail &lt;ID&gt;</code> - \u67E5\u770B\u6F2B\u753B\u8BE6\u60C5</li>\n  <li><code>comic leaderboard [\u7C7B\u578B]</code> - \u6392\u884C\u699C</li>\n  <li><code>comic category &lt;\u5206\u7C7B\u540D&gt;</code> - \u5206\u7C7B\u6D4F\u89C8</li>\n  <li><code>comic latest</code> - \u6700\u8FD1\u66F4\u65B0</li>\n  <li><code>comic random</code> - \u968F\u673A\u63A8\u8350</li>\n</ul>\n";
export interface Config {
    apiBase: string;
    concurrency: number;
    logInfo: boolean;
    pdfPassword?: string;
}
export declare const Config: Schema<Schemastery.ObjectS<{
    apiBase: Schema<string, string>;
    concurrency: Schema<number, number>;
    logInfo: Schema<boolean, boolean>;
    pdfPassword: Schema<string, string>;
}>, Schemastery.ObjectT<{
    apiBase: Schema<string, string>;
    concurrency: Schema<number, number>;
    logInfo: Schema<boolean, boolean>;
    pdfPassword: Schema<string, string>;
}>>;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map