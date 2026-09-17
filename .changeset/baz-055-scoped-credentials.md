---
'bazilion': minor
---

BAZ-055: per-device scopes on web tokens (`read`/`write`/`approvals`/`admin`, enforced in the auth middleware with structured 403s; bootstrap keeps implicit full access; sessions inherit device scopes), one-paste `bazilion-pair://` pairing setup codes (10-minute, single-use, scoped), and an auth-posture probe on `GET /api/health`. Token minting accepts optional scope subsets; existing credentials keep full access.
