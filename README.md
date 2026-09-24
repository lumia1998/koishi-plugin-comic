# koishi-plugin-comic

Koishi plugin for searching, inspecting, ranking, and downloading comics through a self-hosted [`comic-api`](https://github.com/lumia1998/comic-api) backend (v2.x). Sources are provided by backend plugins (built-in: JMComic, Bika, CopyManga) and are discovered automatically — no source list is hardcoded here. The same functions can be exposed as ChatLuna tools when ChatLuna is installed.

## Requirements

- Node.js 18 or newer
- Koishi 4.18 or newer with the `http` service
- A reachable self-hosted `comic-api` v2 backend
- Optional: `koishi-plugin-chatluna` to register ChatLuna tools

## Install

```sh
npm install koishi-plugin-comic
```

Enable `comic` in the Koishi configuration and set `apiBase` to the address of the `comic-api` backend:

```yaml
plugins:
  comic:
    apiBase: http://127.0.0.1:8699
```

The plugin works without ChatLuna. When ChatLuna is available, enabled tool configurations register automatically. If ChatLuna is disabled, restarted, or reloaded later, the tools are registered again automatically.

## Commands

| Command | Description |
| --- | --- |
| `comic <keyword>` | Search for a comic or download a directly supplied ID. |
| `comic search <keyword>` | Aggregate search across all sources. |
| `comic detail <keyword-or-id>` | Show comic details and chapters. |
| `comic download <id\|source:id> [chapter-id]` | Download a chapter as a password-protected PDF (queued backend task with progress). |
| `comic leaderboard [day\|week\|month\|total] [page]` | Show per-source leaderboards (falls back to day when a source lacks the mode). |
| `comic latest -n <count>` | Show recent updates per source. |
| `comic random -n <count>` | Show random recommendations per source. |
| `comic category [name] [page]` | Browse by category; without arguments lists each source's categories. |
| `comic sources` | List backend sources, capabilities, and login status. |

Comic IDs can be written as `source:id` or `source|id` (e.g. `jm:12345`, `哔咔|xxxx`). Bare numeric IDs are treated as JMComic and 24-char hex IDs as Bika.

## ChatLuna Tools

Each ChatLuna tool can be enabled, renamed, or described in the Koishi plugin configuration:

- `comicSourcesTool` — list backend sources and capabilities
- `comicSearchTool`
- `comicDetailTool`
- `comicLeaderboardTool`
- `comicLatestTool`
- `comicRandomTool`
- `comicDownloadTool`

ChatLuna is an optional peer dependency. The plugin uses Koishi service injection so registration follows the ChatLuna service lifecycle rather than a one-time startup event.

## Development

```sh
npm install
npm run test
npm run build
npm run pack:check
```

## License

[MIT](./LICENSE)
