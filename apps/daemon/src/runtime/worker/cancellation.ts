/** Reporting only: a real worker cancellation signal plus a known provider abort message.
 * No signal, unknown errors, known outcomes and resource/cleanup failures are never reclassified.
 */
export function workerFailureMessage(message: string, cancellationSignalled: boolean): string {
  return cancellationSignalled &&
    [
      'aborted',
      'AbortError',
      'This operation was aborted',
      'The operation was aborted.',
      'The user aborted a request.',
      'Request was aborted',
      'Request was aborted.',
    ].includes(message)
    ? 'cancelled'
    : message
}
