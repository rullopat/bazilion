# Tool expectations, not additional capabilities

- `memory_*`: shared project notes and confirmed brief, not a second conversation record.
- `send_message`, `read_inbox`: bounded same-Team work using real recipient UUIDs and reply references.
- `web_search`: only if actually present and configured. Currently absent in protected peer/scheduled
  turns. Report that blocker; never import search credentials into that worker to bypass it.
- `web_fetch`: public-source retrieval with existing SSRF protections; not proof of web discovery.
- `image_generate`: coordinator only by convention, after current text/concept approval and within
  authorized usage. No custom route, credential, model, upload URL or automatic retry.
- `deliver_file`: coordinator handoff via the existing authorizer, exact captured bytes and Results.
- Workspace tools: use only the admitted tools/paths. Protected commands run inside the supported
  container; no host fallback, package installation or network expansion to unblock this recipe.

A tool mentioned here may be absent or denied. That is not an instruction to fabricate it. No social
publishing tool is part of this recipe. Returned errors/holds/uncertainty must be surfaced honestly.
