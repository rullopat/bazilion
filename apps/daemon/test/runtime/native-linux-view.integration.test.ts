import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { nativeLinuxDomainFixture } from '../fixtures/native-linux-domain.ts'

const enabled = process.platform === 'linux' && process.env.BAZILION_TEST_NATIVE === '1'
test.skipIf(!enabled)(
  'sparse pinned ELF runtime runs native Bash/Node without a whole /usr/lib grant',
  async () => {
    const fixture = await nativeLinuxDomainFixture()
    try {
      const script = `import {writeFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process';
      writeFileSync('result', 'native-minimal-view');
      const result = spawnSync('/usr/bin/true');
      if (result.status !== 0) throw Error('nested command failed');
      console.log(JSON.stringify({node:process.version,nestedExit:result.status}));`
      const run = await fixture.start([
        '--noprofile',
        '--norc',
        '-s',
        '--',
        process.execPath,
        script,
        fixture.probe,
      ])
      await run.owner.ready
      expect(run.owner.matches(JSON.parse(JSON.stringify(run.owner.receipt)))).toBe(true)
      expect(run.owner.matches({ ...run.owner.receipt, pid: run.child.pid })).toBe(false)
      await run.release(
        'ulimit -S -c 0 && ulimit -H -c 0 && "$3" > descriptor-probe.json && exec "$1" --input-type=module -e "$2"\n',
      )
      expect(await run.waitSettled(), run.stderr).toBe(true)
      expect(run.child.exitCode).toBe(0)
      expect(JSON.parse(run.stdout.trim())).toEqual({ node: process.version, nestedExit: 0 })
      expect(readFileSync(join(run.workspace, 'result'), 'utf8')).toBe('native-minimal-view')
      expect(
        JSON.parse(readFileSync(join(run.workspace, 'descriptor-probe.json'), 'utf8')),
      ).toMatchObject({
        inheritedFds: 0,
        seccomp: 2,
        noNewPrivs: 1,
        zeroCaps: true,
        initMem: 30,
        initMemRead: 13,
      })
      expect(run.finish()).toBe(true)
      fixture.cleanup()
    } catch (cause) {
      throw new Error(`Native sparse view failed; retained ${fixture.root}`, { cause })
    }
  },
  20_000,
)
