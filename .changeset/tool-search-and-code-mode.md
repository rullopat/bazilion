---
"bazilion": minor
---

**Tool search and Code Mode.** Agents no longer get every MCP tool up front: the prompt lists each connection with how many tools it has, and the Agent loads the ones a task needs with `tool_search`; they stay loaded for the rest of the conversation. With `codemode` the Agent runs one short JavaScript script, in a sandbox with no network or files, that calls several of its tools (MCP tools included, loaded or not) and hands back only what matters. Both are Pi's own tools. The conversation shows **Ran a script** with the calls it made and their state, and the files they saved; a dangerous command or a tool that asks first still waits for you inside a script, and questions to you are never asked from one.
