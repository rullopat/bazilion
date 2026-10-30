import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { CodingToolResult } from '../src/components/CodingToolResult.tsx'
import { nativeCodingRuntimeLabel } from '../src/lib/coding-presentation.ts'

const native={backend:'darwin-seatbelt',architecture:'arm64',nodeVersion:'v26.12.1',kernelRelease:'fixture-kernel',policyFingerprint:'a'.repeat(64),fingerprint:'b'.repeat(64)}
test('native environment metadata is not relabelled as a host runtime, image or verification verdict',()=>{
  const body=JSON.stringify({posture:'native',native,imageId:null,cwd:'.',restrictions:['IPC only']})
  const html=renderToStaticMarkup(createElement(CodingToolResult,{name:'coding_environment',body}))
  expect(html).toContain('darwin-seatbelt')
  expect(html).toContain('arm64')
  expect(html).toContain('v26.12.1')
  expect(html).not.toContain('Host runtime')
  expect(html).not.toContain('verified')
})
test('missing or malformed native facts remain unknown native details, never host fallback',()=>{
  for(const value of [undefined,{}, {...native,backend:'host'},{...native,nodeVersion:{secret:'untrusted'}}])
    expect(nativeCodingRuntimeLabel(value)).toBe('Native runtime (details unavailable)')
})
test('durable native receipt rendering retains its observed backend rather than inventing an image',()=>{
  const body=JSON.stringify({id:'fixture-native-receipt',state:'succeeded',exitCode:0,input:{command:'test',cwd:'.',purpose:'test'},environment:{posture:'native',imageId:null,native},diagnostic:'',truncated:false})
  const html=renderToStaticMarkup(createElement(CodingToolResult,{name:'coding_command',body}))
  expect(html).toContain('darwin-seatbelt')
  expect(html).not.toContain('Host runtime')
  expect(html).toContain('Not checked')
})
