# Saved results

When an Agent delivers a file (`deliver_file`) or generates an image
([`image_generate`](image-generation.md)), the daemon saves a copy in its database. That copy is a
result: it stays downloadable after the turn, a reload or a restart, and changing or deleting the
workspace file does not change it.

## Find, preview and download

- **Chat:** a card appears where the file was delivered, with **Download** and, for text and
  images, a preview. Generated images show inline.
- **Web:** **Team → Results** lists the Team's results, newest first, filterable by Agent. Each entry
  can be deleted and, while its Agent exists, links to the conversation it was delivered in.
- **CLI:** `bazilion agent chat` saves delivered files into the current directory, never over an
  existing file. Otherwise:

  ```sh
  bazilion result list --team my-team [--agent <agent-id>] [--json]
  bazilion result show <result-id>
  bazilion result download <result-id> --output ./report.pdf   # never overwrites
  bazilion result rm <result-id> --yes
  ```

- **Telegram:** a bound Agent's delivered files are sent to its topic as documents.

Previews show plain text and Markdown up to 256 KiB as text, and PNG, JPEG, GIF and WebP images up
to 10 MiB. Everything else, HTML and SVG included, is download-only.

## Limits and lifetime

- 25 MiB per file and 1 GiB for all results of a home; at the limit, delivery fails until you
  delete results.
- Results do not expire. Deleting a result removes it for good. A result outlives the Agent that
  made it and is removed with its Team; uninstall removes them with the database. Backups include
  them.

## API

| Route | |
| --- | --- |
| `GET /api/results?teamId=…&agentId=…&limit=…&offset=…` | List, newest first |
| `GET /api/results/:id` | Metadata |
| `GET /api/results/:id/download` | The file, as an attachment |
| `GET /api/results/:id/preview` | Text or image preview (415 when not previewable) |
| `DELETE /api/results/:id` | Delete |
