# Saved results

When an Agent delivers a file (`deliver_file`), generates an image
([`image_generate`](image-generation.md)), a video or a sound ([video and sound](video-and-sound.md)),
speech ([`speak`](speech.md)) or a page (`canvas`), the daemon saves a copy in its database. That copy is a
result: it stays downloadable after the turn, a reload or a restart, and changing or deleting the
workspace file does not change it.

## Find, preview and download

- **Chat:** the file appears where it was delivered: a picture as a picture, a video or a sound
  with a player, an HTML page or SVG drawing in a sealed frame (see below), anything else as a
  row with **Download** and, for text, a preview.
- **Web:** the **Files** tab of the side panel lists the Team's results, newest first, for the
  whole Team, the open Agent or the conversation on screen. The Files view is the gallery: filter
  by Agent and by kind (pictures, video, audio, documents), open a file for its details (who delivered it, when, its checksum), put
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

- **Telegram:** a bound Agent's files are sent to its topic: an MP4 as a video, speech as a voice
  note, an MP3 or M4A as audio, anything else as a document. A file over the 50 MB a bot may send
  is named in the topic and stays under Files.

Previews show text up to 256 KiB as text: a text type (Markdown, CSV, JSON, YAML, XML…), or a
file delivered without one whose name says text (`.py`, `.ts`, `.sh`, `.log`, `.toml` and the
like), as long as it is UTF-8. A text file's tile in the Files view shows its first lines. PNG,
JPEG, GIF and WebP images are shown up to 10 MiB. Sounds and videos play in the page, which asks
the daemon for parts of the file as you seek.

An HTML page or SVG drawing shows in a sealed frame, with a button for full size: it runs its own
scripts and styles but has no network, no forms or pop-ups, and no way to reach the page around it
or Bazilion (a sandbox without same-origin, under a policy of its own). A page that loads a
library from a CDN does not work there; it still downloads as it is.

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
| `GET /api/results/:id/media` | A sound or a video, inline, in parts with `Range` (415 for anything else) |
| `GET /api/results/:id/canvas` | An HTML page's or SVG drawing's text, for the sealed frame (415 for anything else) |
| `DELETE /api/results/:id` | Delete |
