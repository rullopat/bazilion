import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  finalizeInstallerFixture,
  INSTALLER_BUILD_ALLOWLIST,
  InstallerProcesses,
  readBoundedText,
  runGuardedUninstall,
} from './installer-process.mjs'

const node = process.execPath

test('command waits for actual close; an already-closed child stops without a lost event', async () => {
  const processes = new InstallerProcesses()
  const result = await processes.run(node, ['-e', 'console.log("done")'])
  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'done')
  await processes.closeAll()
  assert.equal(processes.facts()[0].outcome.code, 0)
})

test('spawn error is retained as an abnormal outcome, not an early successful completion', async () => {
  const processes = new InstallerProcesses()
  const result = await processes.run('/does-not-exist-installer-fixture', [])
  assert.ok(result.code < 0)
  assert.equal(result.code, processes.facts()[0].outcome.code)
  assert.ok(result.spawnError)
  await assert.rejects(processes.closeAll(), /abnormal/)
  assert.ok(processes.facts()[0].outcome.spawnError)
})

test('intentional negative CLI exit remains available to its functional oracle', async () => {
  const processes = new InstallerProcesses()
  const result = await processes.run(node, [
    '-e',
    'process.stderr.write("refused");process.exit(7)',
  ])
  assert.equal(result.code, 7)
  assert.equal(result.stderr, 'refused')
  await processes.closeAll()
})

test('command deadline retires the owned child and cannot become a pass', async () => {
  const processes = new InstallerProcesses()
  await assert.rejects(processes.run(node, ['-e', 'setInterval(()=>{},1000)'], {}, 50), /deadline/)
  await processes.closeAll()
  assert.ok(processes.facts()[0].outcome.signal)
})

test('output overflow is stored and prevents normal cleanup acceptance', async () => {
  const processes = new InstallerProcesses()
  await assert.rejects(
    processes.run(node, ['-e', 'process.stdout.write("x".repeat(2*1024*1024+1))']),
    /output bound/,
  )
  await assert.rejects(processes.closeAll(), /abnormal/)
  assert.equal(processes.facts()[0].outcome.overflow, true)
})

test('unknown child is never signalled or relabelled owned', async () => {
  const processes = new InstallerProcesses()
  let signalled = false
  await assert.rejects(
    processes.stop({
      kill: () => {
        signalled = true
      },
    }),
    /ownership is unknown/,
  )
  assert.equal(signalled, false)
  await processes.closeAll()
})

test('forced close prevents the destructive uninstall callback', async () => {
  const processes = new InstallerProcesses()
  const child = processes.spawn(node, [
    '-e',
    'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)',
  ])
  await once(child.stdout, 'data')
  const result = await processes.stop(child)
  assert.equal(result.forced, true)
  let uninstalled = false
  await assert.rejects(
    runGuardedUninstall(processes, [], () => {
      uninstalled = true
    }),
    /abnormal/,
  )
  assert.equal(uninstalled, false)
  assert.equal(processes.facts()[0].outcome.forced, true)
})

test('owned HTTP200/ok:true health preserves actual public posture', async () => {
  const processes = new InstallerProcesses()
  const child = processes.spawn(node, [
    '-e',
    'const s=require("node:http").createServer((q,r)=>r.end(JSON.stringify({ok:true,auth:{required:true}})));s.listen(0,"127.0.0.1",()=>console.log(s.address().port))',
  ])
  const [data] = await once(child.stdout, 'data')
  try {
    const body = await processes.healthy(child, `http://127.0.0.1:${String(data).trim()}`)
    assert.equal(body.auth.required, true)
  } finally {
    await processes.stop(child)
    await processes.closeAll()
  }
})

test('error HTTP status is not health even if its JSON claims ok', async () => {
  const processes = new InstallerProcesses()
  const child = processes.spawn(node, [
    '-e',
    'const s=require("node:http").createServer((q,r)=>r.writeHead(503).end(JSON.stringify({ok:true})));s.listen(0,"127.0.0.1",()=>console.log(s.address().port))',
  ])
  const [data] = await once(child.stdout, 'data')
  await assert.rejects(
    processes.healthy(child, `http://127.0.0.1:${String(data).trim()}`, 100),
    /startup timed out/,
  )
  await processes.closeAll()
})

test('accumulated functional failures cannot reach destructive uninstall', async () => {
  const processes = new InstallerProcesses()
  let uninstalled = false
  await assert.rejects(
    runGuardedUninstall(processes, ['browser diagnostic assertion'], () => {
      uninstalled = true
    }),
    /assertions failed; retain home before uninstall/,
  )
  assert.equal(uninstalled, false)
  await processes.closeAll()
})

test('successful uninstall callback runs only after all preceding owned closes settle', async () => {
  const processes = new InstallerProcesses()
  const child = processes.spawn(node, ['-e', 'console.log("ready");setInterval(()=>{},1000)'])
  await once(child.stdout, 'data')
  const result = await runGuardedUninstall(processes, [], () => {
    assert.ok(processes.facts()[0].outcome.signal)
    assert.equal(processes.facts()[0].outcome.forced, false)
    return 'uninstall oracle remains enabled'
  })
  assert.equal(result, 'uninstall oracle remains enabled')
  await processes.closeAll()
})

test('fixture removal failure is persisted as failed, never as passed:true', async () => {
  const snapshots = []
  const report = { passed: true, cleanupErrors: [] }
  await finalizeInstallerFixture(report, {
    writeEvidence: (value) => snapshots.push(structuredClone(value)),
    removeFixture: () => {
      assert.equal(snapshots[0].passed, false)
      assert.equal(snapshots[0].fixtureRemoval.status, 'pending')
      throw new Error('controlled EACCES removal')
    },
  })
  assert.equal(report.passed, false)
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[1].passed, false)
  assert.equal(snapshots[1].fixtureRemoval.status, 'failed')
  assert.match(snapshots[1].cleanupErrors[0], /controlled EACCES/)
})

test('passed evidence is emitted only after actual successful removal callback', async () => {
  const snapshots = []
  let removed = false
  const report = { passed: true, cleanupErrors: [] }
  await finalizeInstallerFixture(report, {
    writeEvidence: (value) => {
      if (value.passed) assert.equal(removed, true)
      snapshots.push(structuredClone(value))
    },
    removeFixture: () => {
      removed = true
    },
  })
  assert.equal(report.passed, true)
  assert.equal(snapshots[0].passed, false)
  assert.equal(snapshots[1].fixtureRemoval.status, 'removed')
})

test('failed checks retain the fixture without attempting removal', async () => {
  const snapshots = []
  const report = { passed: false, cleanupErrors: [] }
  await finalizeInstallerFixture(report, {
    writeEvidence: (value) => snapshots.push(structuredClone(value)),
    removeFixture: () => assert.fail('failed fixture must not be removed'),
  })
  assert.equal(report.passed, false)
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].fixtureRemoval.status, 'retained')
})

test('initial evidence-write failure prevents removal and is not retried', async () => {
  let writes = 0
  const report = { passed: true, cleanupErrors: [] }
  await finalizeInstallerFixture(report, {
    writeEvidence: () => {
      writes++
      throw new Error('controlled evidence failure')
    },
    removeFixture: () => assert.fail('unrecorded fixture must not be removed'),
  })
  assert.equal(writes, 1)
  assert.equal(report.passed, false)
  assert.equal(report.fixtureRemoval.status, 'retained')
  assert.match(report.cleanupErrors[0], /controlled evidence failure/)
})

test('final evidence-write failure does not turn initial pending evidence into a pass', async () => {
  const snapshots = []
  const report = { passed: true, cleanupErrors: [] }
  await finalizeInstallerFixture(report, {
    writeEvidence: (value) => {
      if (snapshots.length) throw new Error('controlled final evidence failure')
      snapshots.push(structuredClone(value))
    },
    removeFixture: () => {},
  })
  assert.equal(report.passed, false)
  assert.equal(report.fixtureRemoval.status, 'removed')
  assert.equal(snapshots[0].passed, false)
  assert.match(report.cleanupErrors[0], /controlled final evidence failure/)
})

test('HTTP body limit counts bytes and cancels overflowing SSR-style responses', async () => {
  let cancelled = false
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('éé'))
      },
      cancel() {
        cancelled = true
      },
    }),
  )
  await assert.rejects(readBoundedText(response, 3), /HTTP body exceeded byte bound/)
  assert.equal(cancelled, true)
  assert.equal(response.body.locked, false)
})

test('bounded HTTP text preserves split UTF8 and content at its exact byte limit', async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        const bytes = Buffer.from('Open Bazilion é')
        controller.enqueue(bytes.subarray(0, bytes.length - 1))
        controller.enqueue(bytes.subarray(bytes.length - 1))
        controller.close()
      },
    }),
  )
  assert.equal(
    await readBoundedText(response, Buffer.byteLength('Open Bazilion é')),
    'Open Bazilion é',
  )
})

test('explicit build names equal the repository positive policy; false names are not widened', () => {
  const text = readFileSync(new URL('../../pnpm-workspace.yaml', import.meta.url), 'utf8')
  const rows = text.split('allowBuilds:\n')[1].split('minimumReleaseAgeExclude:')[0].split('\n')
  const names = rows
    .filter((line) => line.trim().endsWith(': true'))
    .map((line) => line.trim().split(': ')[0].replaceAll("'", ''))
  assert.deepEqual([...INSTALLER_BUILD_ALLOWLIST].sort(), names.sort())
  assert.ok(!INSTALLER_BUILD_ALLOWLIST.includes('koffi'))
  assert.ok(!INSTALLER_BUILD_ALLOWLIST.includes('node-llama-cpp'))
  assert.ok(!INSTALLER_BUILD_ALLOWLIST.includes('@google/genai'))
})
