import { expect,test } from 'vitest'
import { codingDefaultsRequest } from '../src/lib/coding-defaults.ts'
const form={backend:'native' as const,image:'must-not-be-reinterpreted',cwd:'app',ci:'true',noColor:'1',tz:'UTC'}
test('web native defaults use the same explicit closed envelope as CLI/API and never carry an image',()=>{
  expect(codingDefaultsRequest(form,4)).toEqual({expectedRevision:4,config:{backend:'native',cwd:'app',env:{CI:'true',NO_COLOR:'1',TZ:'UTC'}}})
})
test('an explicitly selected Docker backend retains its image rather than becoming native defaults',()=>{
  expect(codingDefaultsRequest({...form,backend:'docker',image:'local/toolchain:one'},2)).toEqual({expectedRevision:2,config:{backend:'docker',image:'local/toolchain:one',cwd:'app',env:{CI:'true',NO_COLOR:'1',TZ:'UTC'}}})
  expect(codingDefaultsRequest({...form,ci:'',noColor:'',tz:''},0).config.env).toEqual({})
})
test.each([{ci:'secret'},{noColor:'false'},{tz:'personal-zone'}])('web does not silently drop invalid defaults: %j',patch=>{
  expect(()=>codingDefaultsRequest({...form,...patch},0)).toThrow('Invalid runtime defaults')
})
