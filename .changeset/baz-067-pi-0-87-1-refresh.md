---
'bazilion': minor
---

Refresh the bundled Pi engine to 0.87.1 (BAZ-067 companion). The model catalog gains the current
upstream families (latest OpenAI gpt-5.x/5.6/6 families, GLM 5.3, and more across the existing
providers), and two new Pi providers get Bazilion surfaces: **Meta** (`META_API_KEY`, api.meta.ai)
and **Radius** (`RADIUS_API_KEY`, radius.pi.dev gateway), both admitted for protected turns with
catalog-backed model lists. The zai-coding-cn example moves from the retired glm-5.2 to glm-5.3.
No `/compat` dependency was introduced.
