// When a rule allows a dangerous command: the command is a single simple command (no ; & | < >,
// no substitution, no backslash or line break) whose words start with the rule's words. A rule
// for `git push` therefore allows `git push origin main`, but neither `git pushy` nor
// `git push && rm -rf ~`.

const NOT_SIMPLE = /[;&|<>()`$\\\n\r]/

export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

/** A command a rule may allow at all. */
export function isSimpleCommand(command: string): boolean {
  return command.trim() !== '' && !NOT_SIMPLE.test(command)
}

export function ruleAllows(prefix: string, command: string): boolean {
  if (!isSimpleCommand(command)) return false
  const want = words(prefix)
  const have = words(command)
  return want.length > 0 && want.length <= have.length && want.every((word, i) => have[i] === word)
}

/** The prefix "Always for this Agent" offers: the program, and its subcommand when it has one. */
export function suggestRule(command: string): string | undefined {
  if (!isSimpleCommand(command)) return undefined
  const [program, next] = words(command)
  if (!program) return undefined
  return next && /^[a-z][a-z0-9._-]*$/i.test(next) ? `${program} ${next}` : program
}

/** A prefix the owner may save for this command: simple, and the start of the command. */
export function checkRulePrefix(prefix: string, command: string): string {
  const clean = words(prefix).join(' ')
  if (!clean) throw new Error('the rule needs a beginning of the command, such as "git push"')
  if (NOT_SIMPLE.test(clean)) throw new Error('a rule cannot contain ; & | < > ( ) ` $ or \\')
  if (!ruleAllows(clean, command)) {
    throw new Error(`"${clean}" is not the beginning of this command, word for word`)
  }
  return clean
}
