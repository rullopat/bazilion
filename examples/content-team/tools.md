# Tool expectations, not additional capabilities

- `memory_*`: shared project notes and confirmed brief, not a second conversation record.
- `send_message`, `read_inbox`: bounded same-Team work using real recipient UUIDs and reply references.
- `web_search`: only if actually admitted and configured. Peer/inbox and scheduled turns get the
  same search route as chat. If discovery is absent or unavailable, report the blocker; never inject
  worker credentials or substitute fabricated search results.
- `browser_*`: a managed browser may be admitted on any turn, including peer/inbox and scheduled
  turns. Browser availability does not promise a site will load; stop at challenges or
  operator-choice walls, and never replay an uncertain submission. Persistent browser profiles
  contain cookies/logins and are private operator state, not Team files.
- `web_fetch`: public-source retrieval with existing SSRF protections; not proof of web discovery.
- `image_generate`: coordinator only by convention, after current text/concept approval and within
  authorized usage. No custom route, credential, model, upload URL or automatic retry.
- `deliver_file`: coordinator handoff via the existing authorizer, exact captured bytes and Results.
- Workspace tools: use only the admitted tools/paths. With the Docker sandbox, commands run inside the
  supported container; no host fallback, package installation or network expansion to unblock this
  recipe.

A tool mentioned here may be absent or denied. That is not an instruction to fabricate it. Browser
search is not a guarantee of Google or any other site access, and this recipe does not qualify a live
research journey. No social publishing tool is part of this recipe. Returned errors/holds/uncertainty
must be surfaced honestly.
