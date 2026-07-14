const assert = require('node:assert/strict')
const test = require('node:test')
const { Context } = require('koishi')

const plugin = require('../lib')

function tool(name, enabled = false) {
  return { enabled, name, description: '' }
}

function config() {
  return {
    apiBase: 'http://127.0.0.1:8699',
    concurrency: 4,
    logInfo: false,
    pdfSendMethod: 'buffer',
    fileSendPath: '/tmp',
    comicSearchTool: tool('comic_search', true),
    comicDetailTool: tool('comic_detail'),
    comicLeaderboardTool: tool('comic_leaderboard'),
    comicLatestTool: tool('comic_latest'),
    comicRandomTool: tool('comic_random'),
    comicDownloadTool: tool('comic_download'),
  }
}

function chatluna() {
  const registrations = []
  const disposed = []
  return {
    registrations,
    disposed,
    platform: {
      registerTool(name, options) {
        registrations.push({ name, options })
        return () => disposed.push(name)
      },
    },
  }
}

test('Comic ChatLuna tools follow the ChatLuna service lifecycle', async () => {
  const ctx = new Context()
  await ctx.start()
  plugin.apply(ctx, config())

  const first = chatluna()
  const removeFirst = ctx.set('chatluna', first)
  assert.deepEqual(first.registrations.map((entry) => entry.name), ['comic_search'])

  removeFirst()
  assert.deepEqual(first.disposed, ['comic_search'])

  const second = chatluna()
  ctx.set('chatluna', second)
  assert.deepEqual(second.registrations.map((entry) => entry.name), ['comic_search'])

  await ctx.stop()
  assert.deepEqual(second.disposed, ['comic_search'])
})
