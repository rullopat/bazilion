---
"bazilion": patch
---

**No credentials in a long output's file.** When a command's output is too long to show whole, Pi writes all of it to a file in the system's temporary folder, and until now that file kept any credential the command printed. A command's output now loses the turn's credentials as it arrives, before anything sees it, so the model, the live output and that file all hold `[REDACTED]` instead; a script's long output file is cleaned the same way when the script returns.
