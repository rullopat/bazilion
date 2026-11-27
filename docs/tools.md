# Tools

**Setup → Tools** (`/config/tools`) holds what Agents can do besides thinking. Every setting
applies to all Agents, in every kind of turn (chat, Telegram, follow-ups, schedules, inbox wakes),
from the next turn on.

| Card | Sets | Guide |
| --- | --- | --- |
| Web search | Where searches go: Brave, SearXNG, the model's own search, or off | [web research](web-research.md) |
| Web pages | The optional Firecrawl fallback of the page reader | [web research](web-research.md) |
| Browser | Whether Agents get a browser, and whose | [managed browser](browser-research.md) |
| Commands | Where shell commands run, and whether dangerous ones ask you, a review model, or nobody | [coding](coding-environments.md) |

Each card says what is in effect now (`Using Brave`, `On: a browser per Agent`,
`Runs in Docker, asks first`) and what a choice would meet on this machine before you save it:
a key that is missing, or whether Docker has the image. A setting that only matters with another
choice shows up when that choice is made: the Docker image under **More settings** once
commands run in Docker, the address of a running browser once Agents use yours.

## One Save per card

A card is saved whole. Every value is checked first, and when one is refused nothing of the card
is stored; the refusal is shown under its setting. A key is shown as saved, never in full, and is
replaced or removed with the same Save.

From a terminal, one setting or several together:

```sh
bazilion config list                                # every setting, and what is in effect
bazilion config set BAZILION_WEB_SEARCH_ROUTE brave
bazilion config set BROWSER_ATTACH=true BROWSER_ATTACH_URL=http://127.0.0.1:9222
bazilion config rm BROWSER_ATTACH_URL               # back to its default
```

`config set` runs the same checks: a choice must be one of its values, a switch `true` or `false`
(`yes`, `no`, `on`, `off`, `1` and `0` are accepted and stored as `true` or `false`), a number
whole and in range, an address `http://` or `https://`. With `NAME=value` pairs, either all are
stored or none.

## The daemon's environment

A setting that the daemon's own environment carries wins over the stored one. The card shows the
value in effect, says that it comes from the environment and leaves it alone.

## HTTP

| | |
| --- | --- |
| `GET /api/config/tools` | The cards with their settings, what is in effect, and the model functions |
| `PUT /api/config/fields` | `{ values: { NAME: value, … } }`: checked together, stored together |
| `PUT /api/config/fields/:name` | `{ value }`: one setting |
| `DELETE /api/config/fields/:name` | Back to its default |
