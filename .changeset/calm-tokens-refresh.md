---
'bazilion': patch
---

Refresh expiring ChatGPT OAuth access tokens during worker turns through provider-, Agent-, and
turn-bound daemon IPC. Keep refresh credentials DB-owned, redact upstream failures, clean pending
IPC calls on cancellation or disconnect, and single-flight concurrent rotating-token refreshes.
