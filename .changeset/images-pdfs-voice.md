---
"bazilion": minor
---

**Pictures, PDFs and voice notes an Agent can read.** `view_image` shows the model several pictures at once: files in the workspace or uploads, pictures on the web (through the same guard as `web_fetch`) and the Agent's saved results, PNG, JPEG, GIF or WebP. `pdf_read` gives a PDF's text page by page (`pages` such as `2-5`), in parts for a long one, and marks a page without text, such as a scan. Both work in Docker as well as on the host. Voice notes on Telegram, and audio files you attach in a chat, are turned into words before the turn when you choose a model under the new **Transcription** card on **Setup → Models** (GPT Transcribe, through an OpenAI API key; `bazilion config set BAZILION_TRANSCRIPTION_MODEL openai:gpt-transcribe`): the Agent gets the words and the file. Transcription is off by default, and then the Agent gets the file as before.
