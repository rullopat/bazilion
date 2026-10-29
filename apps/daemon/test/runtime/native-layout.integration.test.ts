import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'

const enabled = process.platform === 'linux' && process.env.BAZILION_TEST_NATIVE === '1'

test.skipIf(!enabled)(
  'actual same-device nested bind mount is refused by native layout admission',
  () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-native-submount-')))
    const root = join(base, 'workspace')
    const target = join(root, 'nested')
    const outside = join(base, 'outside')
    mkdirSync(target, { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(outside, 'marker'), 'synthetic alias outside the workspace')
    const source = new URL('../../src/lib/native-execution/layout.ts', import.meta.url).href
    // A fixed trusted fixture creates only a private unprivileged mount namespace. This is not
    // an admitted unfiltered coding path, a global mount change, or a fallback native executor.
    const script = `
    import { spawnSync } from 'node:child_process';
    import { statSync } from 'node:fs';
    import { captureNativeLayout } from ${JSON.stringify(source)};
    const mounted = spawnSync('/usr/bin/mount', ['--bind', ${JSON.stringify(outside)}, ${JSON.stringify(target)}], {encoding: 'utf8'});
    if (mounted.status !== 0) throw Error('private fixture mount failed: ' + mounted.stderr);
    if (statSync(${JSON.stringify(root)}).dev !== statSync(${JSON.stringify(target)}).dev) throw Error('fixture is not a same-device alias');
    try {
      const capture = await captureNativeLayout({registeredPath: ${JSON.stringify(root)}, writable: true, readableRoots: [], readOnlyPaths: []});
      capture.close(); throw Error('unsafe alias was admitted');
    } catch (error) {
      if (error.reason !== 'nested_mount') throw error;
      console.log(JSON.stringify({sameDevice: true, refused: 'nested_mount'}));
    }
  `
    const result = spawnSync(
      '/usr/bin/unshare',
      [
        '--user',
        '--map-root-user',
        '--mount',
        '--propagation',
        'private',
        '--',
        process.execPath,
        '--input-type=module',
        '-e',
        script,
      ],
      {
        env: { PATH: '/usr/bin:/bin', HOME: base, TMPDIR: base, LANG: 'C' },
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 256 * 1024,
      },
    )
    if (result.status !== 0 || result.signal || result.error) {
      throw new Error(
        `Native alias fixture failed; retained ${pathToFileURL(base)}: ${result.stderr}`,
      )
    }
    expect(JSON.parse(result.stdout.trim())).toEqual({ sameDevice: true, refused: 'nested_mount' })
    rmSync(base, { recursive: true })
  },
  15_000,
)

test.skipIf(!enabled)(
  'immutable input symlinks do not add outside roots or movable host aliases',
  () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-native-input-links-')))
    const workspace = join(base, 'workspace')
    const input = join(base, 'input')
    const outside = join(base, 'unavailable-marker')
    mkdirSync(workspace)
    mkdirSync(input)
    writeFileSync(outside, 'synthetic-not-a-personal-secret')
    symlinkSync(outside, join(input, 'external'))
    const script = `
    set -eu
    if cat "$1/external" > "$2/leak" 2>/dev/null; then exit 11; fi
    if mv "$1/external" "$2/moved" 2>/dev/null; then exit 12; fi
    if ln "$1/external" "$2/hardlink" 2>/dev/null; then exit 13; fi
    if ln -L "$1/external" "$2/followed" 2>/dev/null; then exit 14; fi
    [ ! -s "$2/leak" ]
    printf '{"outsideUnavailable":true,"aliasImmovable":true}\\n'
  `
    const result = spawnSync(
      '/usr/bin/bwrap',
      [
        '--unshare-user',
        '--unshare-pid',
        '--unshare-net',
        '--unshare-ipc',
        '--unshare-uts',
        '--die-with-parent',
        '--new-session',
        '--cap-drop',
        'ALL',
        '--ro-bind',
        '/usr',
        '/usr',
        '--symlink',
        'usr/bin',
        '/bin',
        '--symlink',
        'usr/lib',
        '/lib',
        ...(existsSync('/lib64') ? ['--ro-bind', '/lib64', '/lib64'] : []),
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--dir',
        '/tmp',
        '--bind',
        workspace,
        workspace,
        '--ro-bind',
        input,
        input,
        '--chdir',
        workspace,
        '--',
        '/usr/bin/bash',
        '--noprofile',
        '--norc',
        '-c',
        script,
        'native-input-probe',
        input,
        workspace,
      ],
      {
        env: { PATH: '/usr/bin:/bin', HOME: '/tmp', LANG: 'C' },
        encoding: 'utf8',
        timeout: 10_000,
      },
    )
    if (result.status !== 0 || result.signal || result.error) {
      throw new Error(`Readonly alias probe failed; retained ${base}: ${result.stderr}`)
    }
    expect(JSON.parse(result.stdout.trim())).toEqual({
      outsideUnavailable: true,
      aliasImmovable: true,
    })
    rmSync(base, { recursive: true })
  },
  15_000,
)
