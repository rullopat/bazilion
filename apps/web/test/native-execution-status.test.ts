import type{ExecutionSecurityReport}from'@bazilion/api-types'
import{createElement}from'react'
import{renderToStaticMarkup}from'react-dom/server'
import{expect,test}from'vitest'
import{ExecutionSecurityCard}from'../src/components/ExecutionSecurityCard.tsx'
import{InstallationReadinessCard}from'../src/components/InstallationReadinessCard.tsx'
const status:ExecutionSecurityReport={configuredOperatorHttp:{protected:false,codingSurface:'native',dockerImage:null,browser:'enabled',mcp:'enabled'},protectedUnattendedTurns:{baseRuntimeReady:false,codingSurface:'native',docker:null,native:{backend:'darwin-seatbelt',readiness:'not_checked'},browser:'denied',mcp:'denied',openaiCodex:{enabled:false,connected:false,accessCurrent:false,refreshOnNextTurn:false,baselineEligible:false},remediation:'Every turn requires native admission.'}}
test('native execution status is configuration evidence, not Docker readiness or whole-turn confinement',()=>{
 const html=renderToStaticMarkup(createElement(ExecutionSecurityCard,{status}))
 expect(html).toContain('Native OS sandbox')
 expect(html).toContain('ordinary capabilities')
 expect(html).toContain('darwin-seatbelt')
 expect(html).toContain('Not checked')
 expect(html).not.toContain('Docker image')
 expect(html).not.toContain('Docker only')
 expect(html).not.toContain('base runtime ready')
 expect(html).not.toContain('base runtime unavailable')
})
test('installation health does not turn a passive native selection into readiness or unavailability',()=>{
 const html=renderToStaticMarkup(createElement(InstallationReadinessCard,{codingSurface:'native',report:{ok:true,protectedWorkBaselineReady:false,platformCapabilities:{platform:'macOS',note:'Platform evidence only.',capabilities:[]}}}))
 expect(html).toContain('Healthy')
 expect(html).toContain('Not checked · per-turn admission required')
 expect(html).not.toContain('Unavailable')
 expect(html).not.toContain('Ready ·')
})
