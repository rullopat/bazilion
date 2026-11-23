// Take the pictures a CI run found different (its `pictures` artifact) as the new references in
// e2e/pictures/, after looking at them: each comes with its reference and a `.diff.png` that marks
// the change in red. Needs the GitHub CLI, signed in.
//
//   pnpm pictures:accept [run id]
//
// Without a run id, the latest CI run of the current branch is used.

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const references = resolve(import.meta.dirname, '../e2e/pictures')
function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim()
    console.error(`${command} ${args.slice(0, 2).join(' ')} failed${stderr ? `: ${stderr}` : ''}`)
    process.exit(1)
  }
}

let runId = process.argv[2]
if (!runId) {
  const branch = run('git', ['branch', '--show-current'])
  runId = run('gh', [
    'run',
    'list',
    '--branch',
    branch,
    '--workflow',
    'ci.yml',
    '--limit',
    '1',
    '--json',
    'databaseId',
    '--jq',
    '.[0].databaseId',
  ])
  if (!runId) {
    console.error(`No CI run of ${branch} was found; name one: pnpm pictures:accept <run id>`)
    process.exit(1)
  }
}

const download = mkdtempSync(join(tmpdir(), 'pictures-'))
try {
  // A run that kept no pictures (it passed, or failed before the comparison) has no artifact.
  run('gh', ['run', 'download', runId, '--name', 'pictures', '--dir', download])
  const taken = readdirSync(download).filter(
    (name) => name.endsWith('.png') && !/\.(diff|reference)\.png$/.test(name),
  )
  if (taken.length === 0) {
    console.error(`Run ${runId} kept no pictures.`)
    process.exit(1)
  }
  mkdirSync(references, { recursive: true })
  for (const name of taken) {
    copyFileSync(join(download, name), join(references, name))
    console.log(`accepted ${name}`)
  }
  console.log(`\n${taken.length} reference picture(s) from run ${runId} are in e2e/pictures/.`)
} finally {
  rmSync(download, { recursive: true, force: true })
}
