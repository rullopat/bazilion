import type { AgentQuestion, AgentQuestionAnswer } from '@bazilion/api-types'

export interface QuestionPrompt {
  question(text: string, signal: AbortSignal): Promise<string>
  write(text: string): void
}
function safe(text: string): string {
  return Array.from(text, (character) => {
    const code = character.charCodeAt(0)
    return (code < 32 && code !== 10) || (code >= 127 && code <= 159)
      ? `\\x${code.toString(16).padStart(2, '0')}`
      : character
  }).join('')
}
function hasAnswerControl(text: string): boolean {
  return Array.from(text).some((character) => {
    const code = character.charCodeAt(0)
    return (code < 32 && ![9, 10, 13].includes(code)) || (code >= 127 && code <= 159)
  })
}
/** Uses the chat's sole readline owner. Expiry/EOF never becomes an implicit answer. */
export async function promptForQuestion(
  item: AgentQuestion,
  prompt: QuestionPrompt,
): Promise<AgentQuestionAnswer | null> {
  if (item.status !== 'pending' || item.expiresAt <= Date.now()) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, item.expiresAt - Date.now()))
  timer.unref()
  try {
    prompt.write(`Question ${item.id} (conversation ${item.conversationId})`)
    prompt.write(safe(item.question.prompt))
    item.question.choices.forEach((choice, index) => {
      prompt.write(
        `${index + 1}. ${safe(choice.label)}${index === item.question.recommendedIndex ? ' (Recommended)' : ''}`,
      )
      if (choice.description) prompt.write(`   ${safe(choice.description)}`)
    })
    prompt.write('Choose a number, o for Other, or s to Skip. Answers do not grant permission.')
    while (!controller.signal.aborted) {
      const value = (await prompt.question('Answer: ', controller.signal)).trim()
      if (controller.signal.aborted) return null
      if (value.toLowerCase() === 's') return { kind: 'skip' }
      if (/^[1-4]$/.test(value) && Number(value) <= item.question.choices.length)
        return { kind: 'choice', index: Number(value) - 1 }
      if (value.toLowerCase() === 'o') {
        const text = await prompt.question('Your answer: ', controller.signal)
        if (controller.signal.aborted) return null
        if (text.trim() && Buffer.byteLength(text, 'utf8') <= 4096 && !hasAnswerControl(text))
          return { kind: 'text', text }
        prompt.write('Enter 1–4096 UTF-8 bytes without control characters.')
      } else prompt.write('Choose an explicit number, o, or s; no answer is selected by default.')
    }
    return null
  } catch {
    prompt.write('Question prompt closed or expired. No answer was submitted.')
    return null
  } finally {
    clearTimeout(timer)
  }
}
