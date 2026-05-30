---
'bazilion': patch
---

Telegram now renders agent replies with the same Markdown formatting as the Web UI.

Replies previously arrived as plain text (no `parse_mode`), so `**bold**`, `# headings`, and `` `code` `` showed up as literal syntax, and long replies were truncated. A new converter reuses `marked`'s lexer (the same parse the Web UI uses) and walks the tokens into Telegram's supported HTML entity set (`<b>`/`<i>`/`<s>`/`<code>`/`<pre>`/`<a>`/`<blockquote>`), approximating the features Telegram has no entity for: headings → emoji-prefixed bold (`▎`/`▸`/`·` by level, since Telegram has no font sizing), tables → aligned monospace `<pre>` block, lists → `•`/`1.` bullets with indent and `☐`/`☑` task items, `---` → a box-char rule. A tag-aware splitter replaces truncation, chunking long replies under Telegram's 4096-char limit while keeping every entity balanced across the cut; if Telegram rejects a chunk's entities the mirror retries it once as plain text so a reply is never dropped. Error and verbose tool-trace lines stay plain text.
