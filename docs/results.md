# Saved results

When an Agent delivers a file (`deliver_file`) or generates an image
([`image_generate`](image-generation.md)), the daemon saves a copy in its database. That copy is a
result: it stays downloadable after the turn, a reload or a restart, and changing or deleting the
workspace file does not change it.

## Find, preview and download

- **Chat:** the file appears where it was delivered: a picture as a picture, anything else as a
  row with **Download** and, for text, a preview.
- **Web:** the **Files** tab of the side panel lists the Team's results, newest first, for the
  whole Team, the open Agent or the conversation on screen. The Files view is the gallery: filter
  by Agent and by kind, open a file for its details (who delivered it, when, its checksum), put
  two side by side, delete one, or open the conversation it came from. **Download all** saves the
  listed files as one zip.
- **CLI:** `bazilion agent chat` saves delivered files into the current directory, never over an
  existing file. Otherwise:

  ```sh
  bazilion result list --team my-team [--agent <agent-id>] [--conversation <id>] [--json]
  bazilion result show <result-id>
  bazilion result download <result-id> --output ./report.pdf   # never overwrites
  bazilion result archive --team my-team --output ./files.zip  # or --agent, --conversation
  bazilion result rm <result-id> --yes
  ```

- **Telegram:** a bound Agent's delivered files are sent to its topic as documents.

Previews show text up to 256 KiB as text: a text type (Markdown, CSV, JSON, YAML, XML…), or a
file delivered without one whose name says text (`.py`, `.ts`, `.sh`, `.log`, `.toml` and the
like), as long as it is UTF-8. A text file's tile in the Files view shows its first lines. PNG,
JPEG, GIF and WebP images are shown up to 10 MiB. Everything else, HTML and SVG included, is
download-only.

In a zip, files keep their names; a second file of the same name becomes `name (2).ext`. The zip
is not compressed.

## Limits and lifetime

- 25 MiB per file and 1 GiB for all results of a home; at the limit, delivery fails until you
  delete results.
- Results do not expire. Deleting a result removes it for good. A result outlives the Agent that
  made it and is removed with its Team; uninstall removes them with the database. Backups include
  them.

## API

| Route | |
| --- | --- |
| `GET /api/results?teamId=…&agentId=…&sessionId=…&limit=…&offset=…` | List, newest first |
| `GET /api/results/archive?teamId=…` (or `agentId`, `sessionId`) | The matching files as one zip (413 above 512 MiB together) |
| `GET /api/results/:id` | Metadata |
| `GET /api/results/:id/download` | The file, as an attachment |
| `GET /api/results/:id/preview[?bytes=N]` | Text or image preview (415 when not previewable); `bytes` keeps the start of a text file, on a whole character |
| `DELETE /api/results/:id` | Delete |
