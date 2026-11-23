// The name of a new memory note, as the daemon stores it: a path under the Team's memory folder
// that ends in `.md`. What is typed is made into one, or said why it cannot be.

export function noteKey(typed: string): { key: string } | { error: string } {
  let key = typed.trim().replace(/^(\.\/)+/, '')
  if (!key) return { error: 'Give the note a name.' }
  if (key.startsWith('/') || key.includes('\\'))
    return { error: 'A name is a path inside the memory folder, such as people/sam.md.' }
  const segments = key.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
    return { error: 'A name cannot have empty parts, “.” or “..” in its path.' }
  // The daemon stores and finds `.md` notes only, in lowercase.
  key = `${key.replace(/\.md$/i, '')}.md`
  return { key }
}
