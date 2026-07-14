# koishi-plugin-comic

Koishi plugin for searching, inspecting, ranking, and downloading comics through a self-hosted [`comic-api`](https://github.com/lumia1998/comic-api) backend. It supports the JMComic and Bika sources and can expose the same functions as ChatLuna tools when ChatLuna is installed.

## Requirements

- Node.js 18 or newer
- Koishi 4.18 or newer with the `http` service
- A reachable self-hosted `comic-api` backend
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
| `comic search <keyword>` | Search both sources. |
| `comic detail <keyword-or-id>` | Show comic details and chapters. |
| `comic download <id> [chapter-id]` | Download a chapter as a password-protected PDF. |
| `comic leaderboard [day\|week\|month\|total] [page]` | Show source leaderboards. |
| `comic latest -n <count>` | Show recent updates. |
| `comic random -n <count>` | Show random recommendations. |

## ChatLuna Tools

Each ChatLuna tool can be enabled, renamed, or described in the Koishi plugin configuration:

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
