# BAZ-069 — corrected read-only Bing diagnostic, 2026-09-30

## Authorization and outcome

After the [first diagnostic stopped without samples](BAZ-069-bing-readonly-diagnostic.md), the operator explicitly authorized one corrected retry under the same ≤2-minute read-only restrictions. This authorized no Agent/provider turn or T18(b) qualification attempt.

**Completed read-only**, UTC **15:13:05.695–15:13:37.689**, **31.994 seconds**, **20 samples**. Effective and final document: `https://www.bing.com/`. The single navigation's post-load snapshot expired; the harness recorded that refusal and continued only passive measurements on the authorized homepage. **No navigation replay, clicks, keys, form fills, searches, submissions, provider calls or consent selections.** No challenge interaction. No second retry.

Headed installed Chromium 152.0.7977.82, fresh isolated profile, real daemon liveness, production managed pool/launcher, scrubbed display environment, normal validating SSRF proxy and `allowPrivate: false`. The additional homepage-only top-level navigation restriction used `route.fallback()` so production routing checks remained installed. Zero denied navigations were recorded. This was a daemon-component engineering host, not a real Agent-led research turn.

## Measurements

| Measurement | Observed |
| --- | --- |
| Legacy generation | 5 → 386 across samples; one document id |
| Maximum legacy DOM estimate | **10,645 nodes**, **698,762 counted characters** (text plus attributes, not ARIA-result bytes) |
| Native reader | **20/20 unknown / over-budget**; no accepted native digest |
| Additional bounded CDP DOM measurement | First two samples captured (381 and 9,269 nodes); later **18/20 refused the 10,000-node budget** |
| Main-light-DOM passive observer | 719 records: 138 attributes, 2 character-data, 579 child-list |
| Attribute comparison at delivery | 122 different, 16 equal; equality at delivery is not a no-op proof |
| Heuristic region totals | 77 search, 2 consent-id-prefix, 640 outside; no claim of complete region/semantic coverage |
| Later measurement gap | From sample 2 to 19, legacy generation +61 but light-DOM records only +1 |

Early returned CDP samples show substantial node insertion/replacement, listener metadata changes and changed attributes including `class`, `style` and `aria-disabled`. The later passive counts alone do **not** explain the continued generation changes: the observer does not cover open/closed shadow trees or iframe documents, while the legacy instrumentation walks/discovers open shadow roots. Shadow/root-discovery attribution is a next experiment, **not an established cause**. The capture window did not isolate the causal record behind any particular earlier live refused control.

The raw DOM samples' later serialized sizes were ~2.84 MiB, below their 4 MiB bound; their refusal follows the node bound in this harness. The native reader's coarse `over-budget` reason does **not** identify its failing stage (metadata, node count, screenshot encoding/decoded size). Do not infer a screenshot cause for early samples or raise limits until this is measured safely.

Four later `snapshot` calls returned bounded receipts: 1,657 bytes initially and 472 bytes on each of the remaining three. None of the retained receipts' transient text matched `Reject`. **Successful return is not complete or usable perception:** metadata/refusal output can also return successfully. The summary did not retain their complete/truncation/refusal fields or body, so it cannot prove which fallback scope succeeded or failed. No raw page text was retained to repair that evidence gap afterward.

## Implications for active engineering

- This run rules out treating the entire problem as only harmless no-op writes: actual DOM changes and measurement-size refusals were observed. It does not prove every stale refusal is meaningful drift.
- The current native whole-document reader is unavailable on this observed loaded Bing state. Equality admission cannot work from twenty unknown samples.
- Next offline increment: precise per-stage budget diagnostics, bounded native/isolated-world coverage accounting (including shadow/frame boundaries), and explicit perception-completeness/refusal receipts. Design bounded representation/containment rather than indiscriminately increasing limits. Preserve whole-document freshness, single-use authority and no automatic replay.
- T18(b) remains active and required, **not qualified**. No production guard was relaxed and no action fallback was enabled.

## Cleanup and evidence

Native and diagnostic CDP sessions detached. **Supported stop and reset confirmed**, profile slot absent and isolated home removed. Post-run process inspection found no child associated with this slot. Eight production-source hashes match before/after. The temporary daemon-local harness file was removed from the repository. No copied credentials, raw DOM, screenshots, transcript or profile is retained.

Private bounded artifacts: `/tmp/baz069-bing-readonly-diag-retry-URmlTb/{summary.json,analysis-summary.json,harness.ts,source-before.sha256,run.log}`.

- Summary SHA-256: `706ff2565e17a5ee47ff439561dbe049565170bd038113fa5033c94b98419ce4`
- Executed harness SHA-256: `ea3a0de3a56855fa8372acf42ff83946316f32ba23b0e13316b36ceff92c2e81`
- Derived bounded analysis SHA-256: `cc83b23522938db43c12af20171eb3b837fad14dba17ca1b63e1c5adf9432256`

These are diagnostic evidence, not an independent review, human sign-off, arbitrary-JS behavior witness or live search-to-source acceptance. Authorization is consumed; no further public-site session or Agent turn is implied.
