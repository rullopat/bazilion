import { existsSync, fstatSync } from 'node:fs'
import { sep } from 'node:path'

const chunks: Buffer[] = []
process.stdin.on('data', (chunk) => chunks.push(chunk as Buffer))
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks).toString('utf8')
  const input = JSON.parse(raw) as {
    runtime: { apiKey: string }
    scratch: {
      root: string
      homeDir: string
      tempDir: string
      piAgentDir: string
      reviewCwd: string
      reviewSessionDir: string
    }
  }
  if (raw.split(input.runtime.apiKey).length - 1 !== 1) {
    throw new Error('selected access token escaped its designated review runtime field')
  }
  for (const sentinel of [
    'telegram-secret-sentinel',
    'bootstrap-secret-sentinel',
    'oauth-refresh-secret-sentinel',
    'unrelated-provider-secret-sentinel',
    'unrelated-tool-secret-sentinel',
  ]) {
    if (raw.includes(sentinel)) throw new Error('ambient credential entered review stdin')
  }
  const expectedEnvironmentKeys =
    process.platform === 'win32'
      ? ['ComSpec', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'WINDIR']
      : ['HOME', 'LANG', 'LC_ALL', 'TEMP', 'TMP', 'TMPDIR']
  if (JSON.stringify(Object.keys(process.env).sort()) !== JSON.stringify(expectedEnvironmentKeys)) {
    throw new Error('review worker process environment was not minimal')
  }
  if (
    !Object.values(input.scratch).every(
      (path) => path === input.scratch.root || path.startsWith(`${input.scratch.root}${sep}`),
    ) ||
    !Object.values(input.scratch).every(existsSync)
  ) {
    throw new Error('review scratch paths were unavailable or escaped their root')
  }
  if (process.argv.join(' ').includes(input.runtime.apiKey)) {
    throw new Error('selected access token entered review argv')
  }
  if ([0, 1, 2].some((fd) => fstatSync(fd).isFile()) || !process.connected) {
    throw new Error('review worker inherited an unexpected descriptor shape')
  }
  process.stdout.write(
    `${JSON.stringify({
      kind: 'review_result',
      proposals: [
        {
          scope: 'private',
          text: 'Verify the result before reporting completion.',
          evidenceEntryIds: [{ sessionId: 'session-a', entryOrdinal: 3 }],
        },
      ],
    })}\n`,
  )
  process.disconnect?.()
})
