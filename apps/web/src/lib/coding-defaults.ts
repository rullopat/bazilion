import type { ConfigureCodingEnvironmentRequest, CodingEnvironmentValues } from '@bazilion/api-types'

/** Form serialization only; the daemon still validates and owns workspace mutation admission. */
export function codingDefaultsRequest(input:{backend:'native'|'docker';image:string;cwd:string;ci:string;noColor:string;tz:string},expectedRevision:number):ConfigureCodingEnvironmentRequest {
  if(!['native','docker'].includes(input.backend)||!['','true','false'].includes(input.ci)||!['','0','1'].includes(input.noColor)||!['','UTC'].includes(input.tz))throw new Error('Invalid runtime defaults')
  const env:CodingEnvironmentValues={
    ...(input.ci==='true'||input.ci==='false'?{CI:input.ci}:{}),
    ...(input.noColor==='0'||input.noColor==='1'?{NO_COLOR:input.noColor}:{}),
    ...(input.tz==='UTC'?{TZ:input.tz}:{}),
  }
  const config=input.backend==='native'?{backend:input.backend,cwd:input.cwd,env}:{backend:input.backend,image:input.image,cwd:input.cwd,env}
  return {expectedRevision,config}
}
