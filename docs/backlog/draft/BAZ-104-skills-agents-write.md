---
id: BAZ-104
title: "Skills Agents write for themselves"
status: draft
created: 2026-11-28
release: v0.67.0
---

# BAZ-104 — Skills Agents write for themselves

## Outcome

The replacement for reviewed learning (BAZ-103), asked for on 2026-11-28: "a proper substitute,
probably a SKILL generator that will be automatically used by the agents at the next turn".
When an Agent works out how to do something that will come back (a deploy, a report, an API's
quirks), it writes that down as a skill, and its next turns have it, without a review to switch
on or a proposal to wait for.

## To decide

- When an Agent writes or updates a skill: on its own when a task went well after some trying,
  when you ask ("remember how to do this"), or both.
- Whose the skill is: the Agent's alone, or the Team's, and whether teammates pick it up.
- What you see: a skill an Agent wrote is listed with who wrote it and when, and you can read,
  edit, switch off or delete it; whether one needs your yes before it is used.
- What a skill holds: the `SKILL.md` format of installed skills, so it shows up like any other,
  and the content scan installed skills get.
- How "the next turn" gets it: attached on writing, so the prompt lists it from the next turn.

## Known

- Skills today are installed folders in the home, attached per Agent; the prompt lists the
  attached ones and Docker turns see them read-only under `/skills`.
- Approved lessons carried over by BAZ-103 are in each Agent's `AGENTS.md`; whether they become
  its first skills is part of this story.
