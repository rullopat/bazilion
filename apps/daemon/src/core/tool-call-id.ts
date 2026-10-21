/** Opaque canonical Pi tool identity: a simple id or Responses call_id|item_id.
 * Preserve the whole value for transcript matching and replay/provenance keys.
 * This grammar does not authorize a call or apply to other resource identities.
 */
export function isToolCallId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 256 &&
    // A true end assertion also rejects a trailing newline (unlike JavaScript '$').
    /^[A-Za-z0-9._:-]+(?:\|[A-Za-z0-9._:-]+)?$(?![\s\S])/.test(value)
  )
}
