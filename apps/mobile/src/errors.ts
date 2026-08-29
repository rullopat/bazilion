/** Turn opaque native fetch failures into an actionable private-gateway check. */
export function mobileErrorMessage(error: unknown, server: string): string {
  if (error instanceof SyntaxError) return 'Bazilion returned an unreadable response.'
  const message = error instanceof Error ? error.message : String(error)
  if (
    error instanceof TypeError ||
    /network request failed|failed to fetch|network error|load failed/i.test(message)
  ) {
    return (
      `Can’t reach ${server}. Check that Tailscale is connected and ` +
      'the private HTTPS gateway is running.'
    )
  }
  return message || 'Unknown Bazilion error'
}
