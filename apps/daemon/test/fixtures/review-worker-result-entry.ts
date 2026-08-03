process.stdin.resume()
process.stdin.on('end', () => {
  process.stdout.write(
    `${JSON.stringify({
      kind: 'review_result',
      proposals: [
        {
          scope: 'private',
          text: 'Verify the result before reporting completion.',
          evidenceEntryIds: [{ sessionId: 'session-a', entryOrdinal: 3 }],
        },
      ],
    })}\n`,
  )
  process.disconnect?.()
})
