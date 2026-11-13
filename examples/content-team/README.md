# Content Team recipe

A four-Agent Team that prepares Mastodon posts for you to publish by hand: a coordinator you talk
to, plus a researcher, a writer and a designer. Nothing here posts anything or adds a trigger.

- `team-template.json`: a restricted Team template. The coordinator and each specialist can
  message each other; specialists cannot message each other or other Teams.
- `profiles/*.md`: the role instructions (each Agent's `SOUL.md`).
- `operating-rules.md`, `tools.md`: each Agent's `AGENTS.md` and `TOOLS.md`.
- `skills/content-preparation/`: the shared skill every role uses.
- `brief.md`: a worksheet to fill in with the coordinator at the start of a cycle.

Install it from the repository root (the daemon reads these paths, so use a local daemon). Pick
an enabled model for `CONTENT_MODEL`; from a source checkout use `pnpm tsx apps/cli/src/index.ts`
in place of `bazilion`:

```sh
recipe="$PWD/examples/content-team"
bazilion skill import --from "$recipe/skills"
for role in coordinator researcher writer designer; do
  bazilion profile create "content-$role" --model "$CONTENT_MODEL" \
    --skills-mode selected --skills content-preparation --skip-bootstrap \
    --soul-file "$recipe/profiles/$role.md" \
    --agents-file "$recipe/operating-rules.md" --tools-file "$recipe/tools.md"
done
bazilion team-template import "$recipe/team-template.json"
bazilion team-template spawn content-preparation content
```

In the web UI the last step is **Spawn team** on the `content-preparation` template. Then send the
coordinator the brief together with the specialists' Agent ids from the Team page (or
`bazilion team policy show content`): the coordinator addresses them by id. Research needs a
working `web_search` setup. `pnpm vitest run apps/cli/test/content-team-recipe.test.ts` checks
that the recipe still installs and wires its policy, without calling a model.
