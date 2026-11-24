# bazilion

## 0.58.1

### Patch Changes

- [#113](https://github.com/rullopat/bazilion/pull/113) [`4b3cd40`](https://github.com/rullopat/bazilion/commit/4b3cd4061cccda164e15d797eb34866c70be9552) Thanks [@rullopat](https://github.com/rullopat)! - **Going to another Agent and back keeps where you were in the conversation.** The router's own scroll restoration put the last conversation's scroll position on the next one, after Bazilion had restored the right place. So an Agent opened where the previous one had been scrolled to, and coming back opened where the other Agent had been left. Each conversation now keeps only its own place.

## 0.58.0

### Minor Changes

- [#112](https://github.com/rullopat/bazilion/pull/112) [`d5c60ed`](https://github.com/rullopat/bazilion/commit/d5c60edb5122d639010cb91b412747d6a57af40c) Thanks [@rullopat](https://github.com/rullopat)! - **Connections say what they do.** A Team's modes are now **Everyone** (everyone can message everyone) and **Connections only**, in the panel, the map, the template editor, Manage and the CLI. An open Team's panel says its members need no connections and how many saved connections would apply if you switched. Drawing a connection between teammates of an open Team asks whether to switch the Team to Connections only, since it would otherwise change nothing.

  **Give an Agent its job when you add it.** **Add an Agent** has a **What is it for?** field (`bazilion agent spawn --role`). With a role the Agent starts working straight away: the role goes on top of its AGENTS.md, and it skips the first-run ritual that asks its name and purpose.

  **One name per Agent.** The name an Agent gave itself in IDENTITY.md shows next to its own in the list, the conversation header and Jump to (`Sally · Sales Director`) and in Manage (`calls itself Sales Director`), and the Agent tab offers to make it its name. Teammates find each other by either name. Two Agents of one Team can no longer share a name, whatever its case: adding, renaming, moving or restoring one is refused with a clear message, and a Team template numbers a name that is taken.

  **A Team's day at a glance.** A Team's overview has **Today**: hand-offs and replies between its Agents, files delivered, conversations worked in, and the questions and approvals waiting, newest first. `bazilion team today <team>` prints the same.

  **Mail, calendars, chat and notes.** Setup → MCP has **Common connections** for Microsoft 365, Google Workspace, Slack and Notion, asking only for what each needs (`bazilion mcp presets`, `mcp add --preset`). A stdio server can have variables of its own, stored encrypted and given to that server only (**Variables** on its row, `--env`, `mcp set`). A tool whose name says it sends or changes something outside asks you first, like a risky command, in the chat, Telegram and Attention, and is refused in a turn nobody can answer. After **Test** you can tick or untick single tools (`mcp set --ask … --skip …`); every other tool keeps following the rule.

  **Smaller things.** **Changes** shows only for a Team whose folder is a Git repository, and the Team tab shows its folder behind **Show the folder**. Setup → System names a broken skill and where to fix it, and so does `bazilion doctor`. **Stop** says that it paused the follow-ups waiting behind the turn. Team templates say **Use**, not Spawn. The Mailbox's tool for trying a message from a teammate is folded at the bottom. A dialog that was just closed no longer takes the focus back from **Jump to** opened straight after it.

## 0.57.1

### Patch Changes

- [#108](https://github.com/rullopat/bazilion/pull/108) [`72cbd84`](https://github.com/rullopat/bazilion/commit/72cbd84c56cb9173ae6029ca16c35463c3e2f33e) Thanks [@rullopat](https://github.com/rullopat)! - A browser tab left open across an upgrade no longer shows "Could not load this page" with "Failed to fetch dynamically imported module" when it opens the Connections map or another part it had not loaded yet: it reloads itself once to get the new version, and otherwise says that Bazilion was updated and offers **Reload**. ⌘K or Ctrl+K pressed while a dialog is still closing opens **Jump to** again (0.57.0 ignored it then).

## 0.57.0

### Minor Changes

- [#106](https://github.com/rullopat/bazilion/pull/106) [`58663de`](https://github.com/rullopat/bazilion/commit/58663de774d0b6f94cee33f6c59eb97116dd4005) Thanks [@rullopat](https://github.com/rullopat)! - Polish and fixes. Agents know their teammates by name and id, and add teammates with `agent_create` when you ask; a new Agent's first-run ritual no longer answers a teammate's message. The conversation keeps its place and your unsent text when you go to another Agent and back, and Teams and Agents made from the CLI or by an Agent show up without a reload. Questions asked or answered elsewhere come and go in the open conversation, a finished turn no longer resets the view you are reading, long names no longer push the conversation bar's controls away, the side panel on a narrow screen closes with Escape, a stopped reply says so, and a Team whose folder is not a Git repository no longer logs a failed request.

## 0.56.0

### Minor Changes

- [#104](https://github.com/rullopat/bazilion/pull/104) [`bbc6a47`](https://github.com/rullopat/bazilion/commit/bbc6a477db82dc160f4aab40ff0e6290bf75295c) Thanks [@rullopat](https://github.com/rullopat)! - Usage and cost per day, Team, Agent, model and conversation; failed background turns in Attention; conversation search in Jump to and the CLI; when each schedule runs next; text previews for every kind of text file; and pictures and accessibility checks on CI.

## 0.55.0

### Minor Changes

- [#102](https://github.com/rullopat/bazilion/pull/102) [`8d4ce3a`](https://github.com/rullopat/bazilion/commit/8d4ce3a2363342bc2c2679b6bdbe7cd9f8463bbe) Thanks [@rullopat](https://github.com/rullopat)! - Live updates in the web UI, desktop notifications, commands to approve in Telegram, a waiting strip on a phone, browser tests, and Pi 1.6.0.

## 0.54.0

### Minor Changes

- [#100](https://github.com/rullopat/bazilion/pull/100) [`b6a189c`](https://github.com/rullopat/bazilion/commit/b6a189c19ed4c30bf986efc8fb4bc0659771438d) Thanks [@rullopat](https://github.com/rullopat)! - The changes picked in the UX walkthrough: one meaning of "needs you", an overview to open on, the workspace's sheets on the shared parts, one dropdown, a palette that acts, and keyboard shortcuts. No schema change; a 0.53 home opens as it is.

  - **Attention** lists an Agent's open question and command to approve first, with when each stops waiting, and **Answer** or **Decide** opens the conversation. The page keeps itself current, and so does the top bar's count, on every page. `bazilion attention list` shows them as `agent_question` and `command_approval`. They are never Telegram notifications.
  - **Waiting for you**: an Agent blocked on a question or a command reads `Waiting for you` in amber in the list, its step, the line under the conversation, Jump to and the Team; green `working` means it is working. `bazilion activity` says the same.
  - **The overview**: with nothing open, the workspace shows who is waiting for you, who is working, the Teams, the latest files and the Agents active last. The side panel stays closed until something is picked.
  - **The top bar**: Attention, Manage and Setup are three links; the theme and Log out are in the session menu at the end.
  - **Tab titles** name the page (`Mira · Launch — bazilion`) and count what waits for you (`(1) …`).
  - **Sheets**: schedules, learning, mailbox, skills, Telegram, browser, About you (USER.md), memory and a Team's settings are built from the Setup cards and fields. Schedules read as words (`Weekdays at 09:00`) and are added in a dialog with presets; learning has one switch, the model menu and one Save; the mailbox names Agents instead of showing ids; memory notes are listed by title and read formatted; skills switch on and off.
  - **USER.md**: a new Team's USER.md starts empty, and the Team tab invites you to write it; previews of USER.md and memory notes read as plain text. The About-you editor reads USER.md afresh when it opens, and a save made from text an Agent has since changed is refused (`PUT /api/teams/:id/user-md` takes an optional `expected`; 409 `user_md_changed`) instead of overwriting the Agent's lines. Its limit counts bytes, as the daemon does.
  - **One dropdown** everywhere, drawn like the model menu. The Agent tab saves a model or reasoning change at once, with **Undo**. The Files tab and gallery filter by kind and by whom in the same way.
  - **Jump to** lists Agents waiting for you first, then those working, then actions (a new conversation, add an Agent, switch the theme, the shortcuts), Agents by last activity, recent conversations, Teams, views and pages.
  - **Shortcuts**: `?` lists them; `/` writes to the open Agent; Alt+↑/↓ (⌥ on a Mac) opens the previous or next Agent; ⌘. or Ctrl+. shows or hides the side panel.
  - **Polish**: headings use the text face, except page titles and the Agent's name; one type scale; a new or deleted file opens in one column, and a new Markdown file has a Preview; the conversation header stays on one line; the panel's tabs scroll on a phone; **Edit** sits under your last message; a Team opened on its own does not list its members twice.
  - **Fixed**: Manage → Skills showed a skill with a scan finding one letter per line (0.53.0).

## 0.53.0

### Minor Changes

- [#98](https://github.com/rullopat/bazilion/pull/98) [`9ffef28`](https://github.com/rullopat/bazilion/commit/9ffef2855f8b2512dd7c636d53152587582e3179) Thanks [@rullopat](https://github.com/rullopat)! - Manage is redone on the shared parts: Agents, Teams, Agent templates, Team templates and Skills under one tab bar, each with its list first and creation in a dialog. No daemon, CLI or database change; a 0.52 home opens as it is.

  - **One section:** a Manage tab bar replaces the separate pages and the Templates sub-tabs. The Manage menu and Jump to name the five pages.
  - **Agents:** grouped by Team; find by name, creature or vibe; Current / Archived / All; each row says its template and the model it answers with (and when that model is not in Chat). Archive, Move to another Team and Delete are in the row's **⋯** menu; an archived Agent has **Restore**, and archiving shows a notice with Restore.
  - **Teams:** **Create a Team** asks for a name, makes the ID from it, and asks where the files are: a new folder, or a project folder to link to. Rows show the members; **Remove** is disabled, with the reason, while a Team has Agents.
  - **Agent templates:** **New Agent template** creates from the built-in files and opens the template. Its page has a **Settings** card (name, default model, skills) and a **Files** card (SOUL, IDENTITY, BOOTSTRAP, AGENTS, TOOLS, one at a time; one Save for every changed file; a missing optional file can be added). A banner says when the default model is not in Chat. Rows say who uses a template; **Delete** is disabled while an Agent or a Team template uses it, which the daemon refused before.
  - **Team templates:** a roster preview per row, **Spawn** from the list and **Spawn this Team** from the page; the spawn dialog asks for a new Team or one that exists. The roster editor uses the shared parts and says Agents and connections, not slots and allow edges.
  - **Skills:** **Import skills** opens a dialog (OpenClaw, a folder, a ZIP file); a risky finding or an unreadable SKILL.md is shown under the skill and in a banner; rows say which templates chose the skill.
  - **Attention:** a summary line and one row of filters (state, kind, severity); times are relative.
  - **Shared parts:** `components/ui/` (moved from `components/setup/`) gains a row menu, empty states, group headers, choice cards and a filter select. The spawn dialogs and the Team form use them, in the workspace too.
  - **Telegram pairing** is noticed by itself: while a code waits, the Owner pairing card checks every few seconds, and the allowed users can be added as soon as the owner is paired.
  - **Keyboard:** row menus, the template's file tabs (arrow keys, Home, End) and the controls that replace each other keep focus where it belongs; a menu item that cannot be used is still reached, so its reason is read.
  - **Fixed:** Skills and Attention threw a hydration error (React [#418](https://github.com/rullopat/bazilion/issues/418)) because dates were formatted in the server's and then the browser's locale.

### Patch Changes

- [#98](https://github.com/rullopat/bazilion/pull/98) [`67bd791`](https://github.com/rullopat/bazilion/commit/67bd7915042717e579e0ff68aedb68b84cd8399e) Thanks [@rullopat](https://github.com/rullopat)! - The six Setup pages are built from one set of cards: the look, the widths and the wording of Models, Tools, MCP, Telegram, Access and System now agree. No setting, route or command changes.

  - **Telegram:** the bot, the preflight checks, owner pairing, Attention notifications and the allowed users are one card each, as wide as the other Setup pages, with the card's state in its corner (`Running`, `All passed`, `Paired`, `On`, `3 people`). A saved bot token is shown as saved and replaced from there. The form says what it needs before it can be saved: both the token and the group, a numeric group id, and the token again when the group changes (the daemon stores the two together), instead of the daemon refusing it afterwards. The **Bot** card says whether the bot runs from what the daemon knows, and from the last preflight once one was run. Others can be added to the allowed users once an owner is paired; before that the card says so instead of offering a form that was always refused. Buttons are named like the rest of Setup: **Run preflight**, **Restart bot**, **Generate pairing code**, **Reset owner**, **Disconnect Telegram**.
  - **System:** Health, Agent runtime and Backup are the same cards. The runtime card shows the state the **Commands** card under Tools shows, and links to where it is set.
  - **MCP:** **Add a server** and **Servers** are the same cards. The Servers card says how many are switched on, and a test's result stays under its server. The form says what the daemon would refuse (a name with other characters than letters, digits and underscores; an address that is not `http://` or `https://`, or that carries a user name, a password or a `#` part) and what is still missing, and **Add server** stays off until it can be sent.
  - **Access:** **Mint a new token**, **Tokens** and **Browser sessions** are the same cards; the browser you are looking at is marked **This browser**. A number of days that is not a whole number of 1 or more is said under the field.
  - **Shared parts:** `apps/web/src/components/setup/parts.tsx` and `form.tsx` hold the card, its rows and lists, notices, facts, fields, the saved-key row and the Save bar; the Models and Tools pages use the same ones and render as before.
  - **Fixed:** resetting the Telegram owner says that it also removes everyone else from the allowed users; the **Replace** button of a saved key is announced as "Replace" instead of by the field's name, and puts the cursor in the field it opens; a preflight that could not be asked for is reported as that, not as a rejected token; the buttons of a list say which server, token or session they are for.

## 0.52.0

### Minor Changes

- [#96](https://github.com/rullopat/bazilion/pull/96) [`2b22b6d`](https://github.com/rullopat/bazilion/commit/2b22b6dbe6739c968d9c2d8a08dcc22995f88d42) Thanks [@rullopat](https://github.com/rullopat)! - Setup → Tools replaces Services with one card per tool and settings that are checked before they are stored; model menus show names. A 0.51 home opens as it is.

  - **Setup → Tools (`/config/tools`):** Web search, Web pages, Browser, Commands and Messages between Agents are one card each, in place of 18 text boxes with a save button each. A setting is entered as what it is: a choice with what each option means, a switch, a number in the unit people use (minutes, not milliseconds), a key shown as saved. A card says what is in effect now (`Using Brave`, `On: a browser per Agent`, `Runs in Docker, asks first`) and what a choice would meet on this machine before it is saved: a key that is missing, or whether Docker has the image. A setting that only matters with another choice appears with it.
  - **One Save per card:** every value is checked first, and when one is refused nothing of the card is stored. A key is replaced or removed with the same Save.
  - **Settings are checked:** `bazilion config set` and `PUT /api/config/fields/:name` run the same checks as the page. A choice must be one of its values, a switch `true` or `false` (`yes`, `no`, `on`, `off`, `1`, `0` are stored as `true` or `false`), a number whole and in range, an address `http://` or `https://`. A mistyped `BAZILION_BASH_APPROVAL` used to be stored and then failed every turn.
  - **CLI:** `bazilion config set NAME=value NAME=value` saves several settings together or none; `config list` shows defaults, what is in effect for each tool, and what each setting takes.
  - **Model names in the menus:** the Agent tab, **Spawn an agent** and Agent templates choose a model from a menu with names by provider (`Claude Fable 5.2` under Anthropic, `GPT-6.1 Sol` under ChatGPT), how much each reads and whether it sees images, and a provider that is not working marked as such. The CLI and the API keep `provider:model`.
  - **Setup tabs renamed:** Services is Tools (`/config/tools`), Integrations is Telegram (`/config/telegram`), Tokens is Access (`/config/access`). The old addresses are not redirected.
  - **Fixed:** the Changes view and a review missed a file that was rewritten, at the same size, in the same second it was staged (the review reads a copy of the Git index, and the copy's new timestamp hid such a change); the browser's first start has 60 s instead of 15, which a cold disk on a small machine could exceed; a tool call cut short by a lost MCP session says "MCP session expired" whichever request noticed first, where it could say "MCP connection closed"; a conversation renamed in the same millisecond it was created keeps its name when the first message arrives.
  - **HTTP:** `GET /api/config/tools` and `PUT /api/config/fields` (`{ values: { NAME: value } }`, all or nothing) are new. `GET /api/config/services` and `GET /api/config/available-models` are gone: use `GET /api/config/tools` and the `chat` list of `GET /api/config/models`. The setting groups `shell-security`, `brave-search`, `searxng` and `firecrawl` are now `commands`, `agent-messages`, `web-search` and `web-pages`; setting names are unchanged.

## 0.51.0

### Minor Changes

- [#92](https://github.com/rullopat/bazilion/pull/92) [`af9d3e9`](https://github.com/rullopat/bazilion/commit/af9d3e9986df30d24485e6454144b7a736f9e738) Thanks [@rullopat](https://github.com/rullopat)! - Setup is sorted by what a model does, and a provider is connected in one step that ends in a checked state. A 0.50 home opens as it is.

  - **Setup → Models (`/config`):** Chat (the models Agents think with), Images (the model they draw with, or off) and Providers (the accounts and local servers behind them) on one page. Only the providers in use are listed; the others are behind **Add a provider**. Each chat model shows its name, how much it can read, whether it takes images, its list price per million tokens and who uses it; these facts come from the catalog bundled with Pi.
  - **Connect in one step:** paste the key (or sign in with ChatGPT, or give a local server's address), keep the suggested models or choose others, and press **Connect and test**. The cheapest chosen model is asked for a short reply; only when it answers are the key and the models saved and the provider switched on. A key that does not work is never stored, and a model the provider refuses for the account is left out.
  - **A state that was checked:** a provider is "Working", "Key rejected", "Not answering", "Model unavailable", "Limit reached", "Not tested yet", "Needs a key" or "Turned off". A failed test says what happened and what to do, with the provider's own message beside it. A line above the cards names the provider that does not answer and how many Agents depend on it.
  - **Model picker:** search across every connected provider, filter by image input or reasoning, with dated copies of a model folded away. Removing a model that Agents use says so first.
  - **First run on one screen:** `/welcome` is choose, connect, start chatting. **On this computer** finds LM Studio, Ollama and llama.cpp at their usual addresses; **Start chatting** opens the first Agent.
  - **System tab:** installation health, the runtime summary and the backup download moved from the top of the providers page to `/config/system`.
  - **CLI:** `bazilion provider connect <id> [--key …] [--url …] [--set NAME=value] [--models a,b] [--no-test]`, `bazilion provider disconnect <id>` and `bazilion provider test <id>`. `provider list` shows each provider's state and only the providers in use (`--all` for every one); `provider models <id>` lists names, sizes and prices.
  - **HTTP:** `POST /api/config/providers/:id/connect`, `POST …/test`, `DELETE /api/config/providers/:id`, `GET|POST …/catalog`, `GET /api/config/providers/local` and `GET /api/config/models`.
  - **Changed:** `GET /api/config/providers` returns each provider's `state`, `check`, `models`, `suggested` and `listed` and no longer asks any provider for its model list, so the page opens at once whatever a local server is doing; `GET /api/config/providers/:id/models` is gone; `GET /api/config/services` lists image generation under `functions`; `PUT /api/config/providers/:id/enabled` refuses to switch on a provider that has no credentials. The Services page no longer has an Image generation card.
  - **Renamed:** the ChatGPT provider is shown as "ChatGPT" and Google as "Google Gemini"; a local server's "Endpoint URL" is its "Address". Provider ids and setting names are unchanged.

## 0.50.0

### Minor Changes

- [#90](https://github.com/rullopat/bazilion/pull/90) [`3602132`](https://github.com/rullopat/bazilion/commit/3602132c7c6dde7b6820ab1e6f3627ca687e7f2c) Thanks [@rullopat](https://github.com/rullopat)! - The web UI is one workspace: the conversation, the Team, who may message whom, the diff of what was written and the delivered files are on one screen, and the list of Agents says what each one is doing. The version jumps from 0.27 to 0.50 to mark the rework; a 0.27 home opens as it is.

  - **One workspace on `/`:** Teams and their Agents on the left, the open Agent's conversation in the middle, and a side panel with five tabs: Agent, Team, Connections, Changes and Files. The address holds what is on screen (`?agent=…&panel=changes&file=…`), so links and the back button work. The panel remembers its last tab.
  - **What each Agent is doing:** every Agent has a line of its own: `Needs you: 1 question`, `Working: writing theme.js`, `Follow-ups paused`, `2 new files` or `Idle`. Before, the list showed the lifecycle status, which read `IDLE` for an Agent in the middle of a turn. A Team's header sums its Agents up.
  - **A transcript that reads:** tool calls are steps in words (`Ran`, `Read`, `Wrote` with the lines added and removed) instead of escaped JSON; a message to a teammate is a hand-off card with what that teammate is doing now; delivered pictures show as pictures; a turn that wrote files links to their diff; a question has one button per choice; a very long message of yours starts folded.
  - **Connections:** the Team as a map, with one line per pair of Agents, an arrowhead for each allowed direction and the number of recent messages on it. Select an Agent or a line to switch each direction and to read what they said to each other. The table view stays.
  - **Changes:** changed files with the Agent that wrote each, the diff in one column or with the old and the new file side by side, comments on a line or a file, and all comments sent to one Agent as one review.
  - **Files:** a gallery of everything a Team's Agents delivered, by Agent and by kind, with details, two files side by side, and one zip of the lot.
  - **Conversations:** an earlier conversation can be continued, not only read, and a conversation is named after the first message you send in it.
  - **Jump to (Ctrl+K):** opens any Agent, Team, view or page by name.
  - **CLI:** `bazilion activity`, `bazilion team messages <team>`, `bazilion conversation select`, `bazilion result archive`, `bazilion result list --conversation` and `bazilion team review feedback --line`; `team review show` names who wrote each file.
  - **HTTP:** `GET /api/activity`, `GET /api/teams/:id/messages`, `POST /api/agents/:id/conversations/:conversationId/select`, `GET /api/results/archive`, `sessionId` on `GET /api/results`, and `authors=1` on `GET /api/teams/:id/review`.
  - **Removed:** the Agent pages (`/agents/<id>` and its Inbox, Triggers, Learning and Settings tabs) and the Team pages (`/teams/<id>` and its Members, Policy, Memory, Review and Results tabs). Their content is in the side panel and in sheets that open over the workspace; the old addresses are not redirected. Attention items link into the workspace.
  - **Changed:** `POST /api/teams/:id/review/feedback` takes `{ agentId, comments: [{ path, line?, note? }], note?, base? }`; the body with a single `path` is refused.

## 0.27.0

### Minor Changes

- [#88](https://github.com/rullopat/bazilion/pull/88) [`98c7bb8`](https://github.com/rullopat/bazilion/commit/98c7bb87b252db0262e30b3ba0c6e1d625799a1a) Thanks [@rullopat](https://github.com/rullopat)! - The managed browser works from the first start on Linux and macOS, and Agents can work in the browser you already have open.

  - **Browser lookup on macOS:** Chrome, Brave, Edge and Chromium are found in `/Applications` and `~/Applications`, and Playwright's Chromium in `~/Library/Caches/ms-playwright`. Before, only Linux paths were checked and a Mac found no browser.
  - **Chromium is downloaded when none is installed:** the daemon runs Playwright's installer itself, at startup or at the first browser action. The `@playwright/browser-chromium` dependency is gone: its download ran in an install script, which current npm and pnpm skip. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` turns the download off. The Agent page shows a download in progress or why it failed.
  - **A browser left by a crashed daemon is killed on macOS too**, where the check read `/proc` and found nothing.
  - **`BROWSER_ATTACH` and `BROWSER_ATTACH_URL`:** with `BROWSER_ATTACH=true`, Agents work in your running Chrome or Chromium, signed in as you, after you allow remote debugging at `chrome://inspect/#remote-debugging` (Chrome 144 or later). Each Agent sees and drives only the tabs it opened; yours are never listed, read or closed. The SSRF proxy cannot cover this mode: requests of the Agent's tabs are checked one by one instead, which is weaker, and downloads are refused in those tabs. Agents are told they act as you. The browser status reports the mode as `attached`.

## 0.26.1

### Patch Changes

- [#85](https://github.com/rullopat/bazilion/pull/85) [`4aa289d`](https://github.com/rullopat/bazilion/commit/4aa289d7b7e6f9ac9ee9313914709e72bb146fad) Thanks [@rullopat](https://github.com/rullopat)! - Fix Agent templates keeping a model removed from a provider's list, and embed Pi 1.5.2.

  - Saving a provider's model list on `/config` or with `bazilion provider models-set` without a model
    that an Agent template defaults to now moves the template to the provider's first remaining
    model (or to the first available model of another provider when none remains), and reports the
    move. Before, the default template kept the model it was first given, so correcting a mistyped
    model id left new Agents on the old one. Templates on a model that was never listed and per-Agent
    model overrides are not changed.
  - The embedded Pi packages (`pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-mcp`) move from 1.4.0
    to 1.5.2. The model catalogs on `/config` follow: GPT-6.1 Terra, Claude Fable 5.2 and Kimi K3.1
    Pro are among the additions, and ids Pi dropped are no longer offered.
  - New provider: Qwen Token Plan (Individual, CN), `qwen-token-plan-individual-cn`, which uses
    `QWEN_TOKEN_PLAN_CN_API_KEY`.
  - On macOS, Connect ChatGPT on `/config` opens the sign-in page with `/usr/bin/open` instead of
    whichever `open` is first on the daemon's `PATH`. A terminal app that puts its own `open` there
    could keep the page in its built-in browser, leaving the web UI waiting on "opening browser…".

  The database schema is unchanged: a 0.26.0 home opens as it is.

## 0.26.0

### Minor Changes

- [`232f151`](https://github.com/rullopat/bazilion/commit/232f151524b51abda66078ecd0ff083e38e1f4e9) Thanks [@rullopat](https://github.com/rullopat)! - Simplify Bazilion for a single local operator.

  - Removed features: review packets, specialist verification, publication to a code host, the
    communication approval queue, Team Policy lineage and denial history, the workspace lease and its
    recovery commands, the coding evidence layer (coding tools, receipts, retained command logs and
    source snapshots), device pairing codes and token scopes, and the native Bubblewrap sandbox.
  - Docker is the only sandbox. `BAZILION_BASH_SANDBOX` is `off` or `docker` and applies the same way
    to every kind of turn.
  - The database schema was reset to a single clean-install schema. An existing home is refused at
    startup: back up the whole home directory, run `bazilion uninstall --yes`, then start Bazilion
    again to bootstrap a fresh home.
  - macOS runs commands on the host and is untested. Windows is not supported.
  - `@bazilion/client` and `@bazilion/api-types` are no longer published to npm.
  - CLI flags renamed: `token create --expires-days` and `login --skip-verify`.
  - Team memory keys must end in `.md`.
  - A chat sent while its Agent is compacting, resetting or archiving is refused as busy instead of
    waiting. Scheduled triggers and learning reviews run once per occurrence, without retries.

## 0.25.0

### Minor Changes

- Add trusted, explicitly unisolated Apple Silicon Mac coding with hardened private-worktree Git,
  native-owned daemon MCP stdio, private-keychain managed browsing and conservative worker recovery.
  Genuine installed CLI/API/web and non-GUI/main-process lifecycle trials pass on macOS 27.0.1
  arm64 / Node 26.12.1. Mac desktop/headed qualification is deferred to a later version; generic
  native Mac isolation stays deferred/unqualified. Mac Docker/VM execution is removed. Unsupported
  native/Docker selections and isolation-required Mac coding refuse without host fallback.

  Add Linux unprivileged Bubblewrap/mandatory-seccomp native execution, protected worker ownership,
  bounded native command/verification evidence and actual runtime readiness while retaining Linux
  Docker and independent policy/approval/security guards. Unknown cleanup retains resources.

  Require Node ^26.12.1 and retire Node 24; pin development/CI to Node 26.12.1 / pnpm 12.15.0.
  The alpha schema requires clean rebootstrap: genuine 0.24.0 and older homes refuse unchanged,
  without in-place migrations or old-backup import. Preserve the entire old home/auth pair first.

  This is alpha software for operator testing, not full platform parity or production readiness.
  Synthetic providers, public-page reading and browser PNGs do not qualify unobserved live-model,
  generated-image or arbitrary-site capabilities. Embedded Pi remains explicitly admitted 1.4.0.

## 0.24.0

### Minor Changes

- Enable ordinary interactive Agent chat on macOS with guarded repository-context capture and live child-process ownership, while retaining Linux descriptor-relative reads. Fresh installed CLI/API/browser turns with empty and instructed Teams are qualified on macOS arm64 / Node 24.22.0. Guarded reads are change detectors, not atomic filesystem snapshots or a general sandbox; hardened Git inspection and MCP stdio remain Linux-only, and unknown cleanup remains blocked.

  Upgrade the embedded Pi AI/agent/coding-agent/MCP family to 1.4.0. Preserve stored provider IDs, map Azure catalog/auth/refresh through the canonical SDK name, and retain explicit admission, daemon-owned credentials/resources and no uncertain-call replay. Codemode, Durable, ambient discovery and automatic MCP OAuth remain excluded.

  Separate installation health, static platform support and protected unattended readiness in CLI/web diagnostics. **Doctor exit status now covers structural installation health only**; automation requiring protected work must inspect authenticated health's `protectedWorkBaselineReady` separately. Ordinary chat execution is labelled Not checked, never inferred from configuration or platform support.

  The canonical 0.23 schema is unchanged. A genuine 0.23.0 home retains its Team sentinel and paired auth.json across two candidate starts; all eight older incompatible fixtures still refuse unchanged. Preserve the entire home before upgrading. Windows, broader macOS/provider/image qualification and arbitrary detached-writer recovery are not implied. Node support remains ^24.22.0 || ^26.4.0.

## 0.23.0

### Minor Changes

- Add source-grounded native OpenAI/ChatGPT research with guarded page reading and explicit provenance,
  while retaining managed browsing as an optional separate capability. API-key native search remains
  experimental/live-unqualified; configuration readiness is not entitlement or successful execution.

  Add operator CLI/API/web workspace blocker reporting and limited recorded-cleanup attempts. Unknown
  ownership remains blocked; this does not guarantee recovery of abnormal host commands. Preserve
  occurrence-specific communication approvals, restricted scheduled/inbox posture and policy-import
  postures. The accepted scheduler/process slice does not qualify composed content-Team journeys.

  Harden image provenance and completed-stream capture/rework handling, browser profile/backup lifecycle,
  worker output draining and packaged web runtime dependencies. Required ChatGPT-only image samples
  are qualified under the recorded limited scope; other paid image routes remain live-unqualified.

  Upgrade embedded Pi and daemon-owned standalone MCP to 1.0.0, retire legacy MCP SSE, and align the
  repository package manager with mise-selected pnpm 12.14.0. Streamable HTTP remains portable;
  stdio execution requires Linux's owned process-tree retirement and refuses before spawn elsewhere.
  No automatic MCP OAuth, ambient discovery or uncertain tool-call replay is added.

  **Runtime:** require Node 24.22.0+ within 24.x or 26.4.0+ within 26.x, which include the upstream
  native cleanup-hook fix. Source and packed CLI/daemon launchers refuse unsupported releases before
  linking application payloads or opening state; there is no automatic runtime fallback.

  **Compatibility:** this alpha candidate uses the canonical clean-install schema. Prior SSE-capable
  homes, including 0.22.0, require fail-closed refusal and operator-controlled reset/rebootstrap, not an
  in-place migration or compatibility importer. Preserve the entire old home with paired DB/auth and
  any external Team work before an explicitly authorized reset; use the matching old binary/schema
  for old backups. No prior-home upgrade/refusal matrix result or final release approval is implied.

## 0.22.0

### Minor Changes

- [#69](https://github.com/rullopat/bazilion/pull/69) [`f365601`](https://github.com/rullopat/bazilion/commit/f36560173e2eadc50e30a55b0421f796880f71f7) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-059: opt-in image generation through direct OpenAI API-key access, ChatGPT/Codex login, or Pi's OpenRouter image API. Automatic mode follows enabled OpenAI text providers, with the Agent's own route resolving dual enablement; explicit image choices remain available. Stored credentials alone, errors and quota failures never cause credential/billing fallback. Normal Agents save generated images as durable, policy-authorized Results; rework preserves previous versions. Daemon-bound IPC, response limits, cancellation and durable receipts prevent automatic retries of uncertain operations. Restricted reviewers and verification specialists remain denied. Account-dependent live acceptance and social publishing move to 0.23.0. The image schema upgrades existing beta homes forward without resetting Results.

- [#69](https://github.com/rullopat/bazilion/pull/69) [`242f239`](https://github.com/rullopat/bazilion/commit/242f23951dbf0a9800148d36f066aff78eef2ddd) Thanks [@rullopat](https://github.com/rullopat)! - Refresh the bundled Pi engine to 0.87.1 (BAZ-067 companion). The model catalog gains the current
  upstream families (latest OpenAI gpt-5.x/5.6/6 families, GLM 5.3, and more across the existing
  providers), and two new Pi providers get Bazilion surfaces: **Meta** (`META_API_KEY`, api.meta.ai)
  and **Radius** (`RADIUS_API_KEY`, radius.pi.dev gateway), both admitted for protected turns with
  catalog-backed model lists. The zai-coding-cn example moves from the retired glm-5.2 to glm-5.3.
  No `/compat` dependency was introduced.

- [#69](https://github.com/rullopat/bazilion/pull/69) [`cd1d303`](https://github.com/rullopat/bazilion/commit/cd1d3031831b7ddb1af881ba96ca89301fa90dca) Thanks [@rullopat](https://github.com/rullopat)! - Bounded public-web discovery for protected Agent turns (BAZ-067). Scheduled and inbox turns previously
  had `web_fetch` but no discovery: configuring a search backend did nothing there. A protected turn now
  includes `web_search` when the operator configures `BAZILION_WEB_SEARCH_URL` (a self-hosted SearXNG
  base URL, https or loopback). The backend URL stays daemon-side — the worker sees only bounded,
  untrusted titles/URLs/snippets (max 8 results, capped fields), one request per invocation, no retry,
  no fallback, and a hard deadline. Configuration is re-validated per request, so drift between claim
  and dispatch is refused. Restricted review/verification workers never receive the capability, and
  fetching a returned URL still goes through the SSRF-guarded `web_fetch`.

### Patch Changes

- [#69](https://github.com/rullopat/bazilion/pull/69) [`1da65c8`](https://github.com/rullopat/bazilion/commit/1da65c81415ef1fbd109433b97baf5d85322404b) Thanks [@rullopat](https://github.com/rullopat)! - Worker turns exit immediately when their work is done. A lingering post-turn handle kept the worker
  process alive for about thirty seconds, so a scheduled or inbox wake held its Team's exclusive
  workspace lease long after finishing and every interleaved turn on that Team failed with
  `workspace_busy` until the process finally exited. Found by the content-Team acceptance harness
  (BAZ-064); the success path now exits explicitly once the session is disposed and IPC is disconnected,
  matching the error path.

## 0.21.0

Identical to 0.21.0-beta.5. The beta suffix is retired (2026-09-21): Bazilion remains alpha, and feature checkpoints ship as plain `0.N.0` versions.

## 0.21.0-beta.5

### Patch Changes

- [`195dc04`](https://github.com/rullopat/bazilion/commit/195dc04a72ce3d940a1eb4d3bbb93aff7476766a) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-050: UI consistency sweep of the post-hardening coding surfaces. Router-level defaults: every route now degrades to a calm recovery fallback (named failure, retry, safe exit — nothing substituted) on loader errors, and shows a marked loading state during navigation, instead of TanStack's default error screen and a blank area. Surface-named error components on the 18 coding-sequence routes that lacked them. Cancel-verification now requires a confirmation stating the consequence. apps/web is now typechecked by the root typecheck (it was excluded — a pre-existing type error sat in main). New browser-acceptance walk (scripts/check-coding-surfaces-ui.mjs) covers desktop/narrow overflow, empty states, and a real daemon-kill error-state walk with evidence screenshots.

## 0.21.0-beta.4

### Patch Changes

- [`455c92c`](https://github.com/rullopat/bazilion/commit/455c92cfc68d5ce2c975ad584a88e2efe70c17e1) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-052: beta supportability. The BAZ-032 adversarial security gate (153 required cases) now runs as a CI job on every PR — the script fails closed on a missing, duplicate or renamed required case, so a security regression or a quietly deleted case cannot merge. New operator doc `docs/growth-and-retention.md` states the per-artifact growth model: coding evidence is bounded by design (7-day TTLs, 256 MB home-wide budget, content-addressed snapshots), messages and sessions grow with use (that is the record), pre-migration snapshots are safe to delete once an upgrade is confirmed good, and `logs/` is intentionally empty — the daemon writes no log files.

## 0.21.0-beta.3

### Patch Changes

- [`ddafd9f`](https://github.com/rullopat/bazilion/commit/ddafd9f6d282c6b66bf882e76efb0ae0f0307c8c) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-051: failure-mode visibility audit — no recoverable failure may stay silent. New Attention kind `queue_interrupted`: after a daemon restart interrupts queue processing, the affected Agent's paused queue now appears in the Attention Center (action required, naming the uncertain count) instead of silently buffering messages until someone noticed. A failed OpenAI ChatGPT OAuth refresh now surfaces an actionable re-login error instead of the raw upstream failure. The remaining failure modes (provider outage mid-turn, bounded trigger retries, Telegram delivery failures, loop breaches, failed backups) are pinned by deterministic fault-injection tests asserting the operator-visible surface.

## 0.21.0-beta.2

### Patch Changes

- [`9c2dae4`](https://github.com/rullopat/bazilion/commit/9c2dae41e9dcac0198ed2d2e8518986321ef21bb) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-049: cross-platform hardening from the new macOS/Windows CI matrix and the fresh-machine installer E2E. Fixes that Windows/macOS users hit: directory fsync on Windows failed every conversation write (chat was broken); fsync on a read-only handle failed bootstrap rotation; symlinked session files were followed on Windows despite the no-follow boundary (now rejected explicitly); the root build's `'./packages/*'` pnpm filters matched nothing on Windows, so `pnpm pack` silently produced an empty tarball; symlinked `BAZILION_HOME` roots broke uninstall's keep-the-root semantics. The workspace-claim identity is now portable off-Linux (same dev/ino semantics without the fd-pinned ancestry window), and the off-Linux turn refusal names its boundary (`safe_reads_unavailable`) as a structured 422 instead of a plain-text 500. Agent turns still require Linux — content-read portability is BAZ-057.

## 0.21.0-beta.1

### Minor Changes

- [`0dd314d`](https://github.com/rullopat/bazilion/commit/0dd314dd9ee3f51e5f6c00acc3feff87ca23a9a5) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-047: stable schema contract — homes upgrade in place. Forward-only prefix migrations with a receipt ledger, numeric refuse-newer (`PRAGMA user_version`), automatic verified pre-migration snapshots beside the database, and a CI release-upgrade matrix proven against real prior releases. Retires the alpha clean-install (wipe-on-change) contract.

- [`0dd314d`](https://github.com/rullopat/bazilion/commit/0dd314dd9ee3f51e5f6c00acc3feff87ca23a9a5) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-053: the Expo mobile app is removed. Mobile is responsive web over the private gateway with named device credentials — the auth path future native clients will use.

- [`0dd314d`](https://github.com/rullopat/bazilion/commit/0dd314dd9ee3f51e5f6c00acc3feff87ca23a9a5) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-055: per-device scopes on web tokens (`read`/`write`/`approvals`/`admin`, enforced in the auth middleware with structured 403s; bootstrap keeps implicit full access; sessions inherit device scopes), one-paste `bazilion-pair://` pairing setup codes (10-minute, single-use, scoped), and an auth-posture probe on `GET /api/health`. Token minting accepts optional scope subsets; existing credentials keep full access.

- [`0dd314d`](https://github.com/rullopat/bazilion/commit/0dd314dd9ee3f51e5f6c00acc3feff87ca23a9a5) Thanks [@rullopat](https://github.com/rullopat)! - BAZ-056: the interactive chat REPL is removed from `bazilion agent chat`; one-shot mode (`--message`, `--image`, `--file`), piped stdin (fail-closed `auto_deny`), and the chat management commands remain.

## 0.20.0

### Minor Changes

- [`ad3b780`](https://github.com/rullopat/bazilion/commit/ad3b780db700c6ed7a180a6cbdd9215cde0e1705) Thanks [@rullopat](https://github.com/rullopat)! - Publish a reviewed revision to a code host, and observe the boundary claims where they are claimed.

  **Publication to a code host.** An operator publishes a **reviewed** packet's revision: the daemon commits it
  to a new branch and opens a pull request. It is a decision, not a workflow — nothing an Agent does causes a
  publication, and there is no publication tool, worker or capability, because publishing is deterministic and
  no model needs to be in the path at all.

  - **Content is the reviewed revision, or nothing.** A snapshot stores digests, never bytes, so every path is
    read from the working tree and checked against the digest the capture recorded. A mismatch refuses and says
    which path; current bytes are never committed under a reviewed packet's name.
  - **A refusal sends nothing.** `refused` means no commit, no push, no pull request, and it is the only state
    the schema allows to carry a reason. No host configured, no credential, a protected head branch, a branch
    name that is not a valid ref, an incomplete or unreproducible revision: each is a reason, not an error.
  - **Never a force push.** A head branch that already exists on the remote is refused before the commit is
    built, and protected branches are never the head branch.
  - **Signed is stated, not assumed.** Commits are unsigned, the record says `signed: false`, and the schema
    refuses to store anything else.
  - **The credential is never an argument or a URL** — it travels in the environment as a Git `http.extraheader`
    — and **the remote comes from configuration**, never from the Team repository's own `origin`.
  - **The outcome is what the host said.** A pull request is recorded only when the host returned one. A push
    that succeeded without one is a published branch with a note. An interrupted attempt becomes `uncertain`
    and is never replayed, because a push may already have landed.
  - Nothing is merged or deployed, and the record never claims otherwise.

  Surfaces: `/api/teams/:id/publications`, `bazilion team publish create|list|show`, and a **Publications**
  panel on the Team Review page. Configure with `PUBLICATION_HOST` (`github`, or `local` for a bare repository
  path), `PUBLICATION_REPOSITORY`, `PUBLICATION_BASE_BRANCH` and the `GITHUB_TOKEN` secret. See
  `docs/publication.md`.

  **Boundary claims observed where they are claimed.** Three guards existed and were asserted; none was observed
  where the product claims it.

  - A check's working directory was scoped only in the executor, so a `cwd` outside the workspace was accepted,
    had rows written, and surfaced later as a check that mysteriously did not execute. It is refused at capture
    now, naming the value, before any row exists.
  - The rule that an unverified finding cannot be resolved held for Agents and not for the operator: the
    operator route stored every finding as `open`, so a finding about a revision nobody could read was
    resolvable. Both entry points now ask one shared question.
  - The web verification panel stated none of the limits the result message states, so "all inside the declared
    paths" read as confinement and a completed request as an approval. One shared definition now renders on both
    surfaces, always rather than only after a check has run.
  - A review turn is observed to run nothing with isolation switched on, with a control proving the "no
    container" measurement is not simply always true.
  - Every declaration-refusal branch is covered on both producers, with zero rows written.

  **Also fixed:** recording a conclusion now settles an `open` packet to `reviewed`, whichever entry point
  recorded it. Before, an operator could conclude a packet and it stayed `open` while the same report's
  `facts.reviewed` said otherwise — one report, two answers, found by building the feature that first consumes
  the state.

  **Schema change: 0.19.x homes cannot be upgraded in place.** This release adds the `publications` table and
  three indexes; the alpha contract remains clean-install only. Take a `bazilion backup` if you need the state.

## 0.19.1

### Patch Changes

- [`70df0da`](https://github.com/rullopat/bazilion/commit/70df0da244405a8e6509cabfba14a509011dfa15) Thanks [@rullopat](https://github.com/rullopat)! - Fix the endpoint used for a model newer than the bundled catalogue.

  Two defects, both introduced with the Fireworks endpoint in 0.19.0:

  - An uncatalogued model id is built for the OpenAI-compatible adapter, and the OpenAI SDK appends only
    `/chat/completions` to the base URL it is given. The pinned endpoint was the provider's catalogue base
    (`…/inference`, correct for its `anthropic-messages` entries), so the fallback called
    `…/inference/chat/completions` and got a **404** instead of `…/inference/v1/chat/completions`. The
    translation is now applied only to the fallback, explicitly per provider, and catalogued models keep
    their own endpoint and API type.
  - The provider registry carried only the API key, so `bazilion provider test` and any other registry
    consumer failed closed with "configure an endpoint for a custom one" for exactly the models that
    endpoint was meant to admit. The default endpoint now travels in the provider config from the same
    single source, and an explicit `FIREWORKS_BASE_URL` still wins.

  Verified against your own model (`accounts/fireworks/models/deepseek-v4p1-flash`, newer than this build's
  catalogue): `provider test` answers, a real turn produces a visible reply, and both live loops — specialist
  verification and specialist review — complete on it, with the reviewer stating in its own words that it has
  no shell and cannot run anything.

  No schema change: a 0.19.0 home upgrades in place. Both live-run harnesses additionally assert that a turn
  actually put an assistant message in the transcript, so a turn that does nothing can no longer read as one
  that succeeded.

## 0.19.0

### Minor Changes

- [`478f6b9`](https://github.com/rullopat/bazilion/commit/478f6b9eee21ce8345839041c30255efb16c1030) Thanks [@rullopat](https://github.com/rullopat)! - Revision-bound coding review and handoff (BAZ-043).

  A coder can ask an existing same-Team member to read one captured change and say what they think of
  it, and get the findings back — with the reviewer unable to run, change or publish anything.

  - One packet binds one captured change. Editing the repository afterwards does not rewrite it; it
    makes the packet **stale** for the current code, which is shown as a fact rather than smoothed over.
  - A coder asks from inside its turn with `request_review`, naming a teammate by name or id. The daemon
    captures the revision at that moment and binds the requester from the turn.
  - The reviewer's whole capability is four read-only tools — read the packet, read a changed path's
    patch, record a finding, record a conclusion. There is no shell, editor, browser, network or
    publication verb, and the daemon refuses each of them rather than trusting a prompt.
  - A patch is offered only while the tree still matches the capture, because a snapshot stores paths and
    digests, never bytes. Once it has moved, the reviewer is told the content is not reproducible and a
    finding recorded then is `unverified` and cannot be resolved.
  - Findings are append-only and about `(packet, path, revision)`. Resolution requires an explicit
    decision or a named later revision — a moved line proves nothing.
  - Completion is a set of separate facts. Committed, pushed, pull request, merged, deployed and
    production accepted are **operator-reported and never verified**: there is no code-host integration.
  - Exports are publications, not downloads: the bytes are held in the durable results store until the
    shipped egress authorizer releases them, so an export cannot bypass an approval-held delivery.
  - File links name the daemon host, offer a copyable location, distinguish the reviewed revision from the
    live file, and run a configured editor as argv without a shell.

  Also closes three gaps in the previous release's specialist verification: a container check now runs
  with the posture its receipt claims (read-only Team memory, recovery-registered container); declared
  output paths are **checked** rather than trusted; and — the substantive one — a coding Agent can ask
  for verification at all, which is what makes the result delivery reachable in production.

  This release changes the alpha schema: four review tables, and result provenance widened so an artifact
  can come from a review packet as well as a turn's tool call. A 0.18.x home cannot be upgraded in place.

## 0.18.0

### Minor Changes

- [`ada3154`](https://github.com/rullopat/bazilion/commit/ada31548592b4aede043fcffb865046827848508) Thanks [@rullopat](https://github.com/rullopat)! - Specialist verification of a captured code change (BAZ-044).

  A coder can hand one captured change — a BAZ-042 snapshot of a dirty tree — to an existing
  same-Team specialist with up to eight exact, task-selected commands, and get back executor-owned
  evidence identifying the code, commands, environment and outcomes it was verified against.

  - One typed request per verification, bound to an immutable captured contract. The specialist's
    capability is two tools: read the request, and run one declared check once. No command, cwd,
    timeout or environment argument exists to pass.
  - Admission revalidates membership, the evidence window and directed policy on every attempt,
    reserves the workspace exclusively, and refuses drift with a fresh capture as the remedy.
  - Checks run through the same shell posture, redaction and BAZ-041 receipt path as a coding turn,
    never with the daemon's ambient environment. A check needing an approval an unattended turn
    cannot obtain is blocked, not auto-approved.
  - A non-zero exit is a result about the commands that ran, reported per check; settling reports
    evidence availability rather than a verdict, and an interrupted attempt is `uncertain` and never
    replayed.
  - The result returns to the requester through the canonical messenger, carrying receipt references
    that grant exactly that peer read access.
  - Surfaces: `/api/teams/:id/verifications[/:requestId[/cancel]]`, `bazilion team verify
create|list|show|cancel`, and a Team **Verifications** section.

  This release changes the alpha schema: four new tables. A 0.17.x home cannot be upgraded in place.

## 0.17.0

### Minor Changes

- [`1d5ac1f`](https://github.com/rullopat/bazilion/commit/1d5ac1f0e6a077a700e5f1f2322ca954086d163e) Thanks [@rullopat](https://github.com/rullopat)! - Live coding progress and retained diagnostics (BAZ-041), and read-only Git change review with bounded
  source snapshots (BAZ-042).

  - Coding commands stream bounded live progress, and their diagnostics are retained for seven days with
    explicit truncation, expiry and disclosure states. Released output can be reopened after navigation
    or a daemon restart.
  - Git change review: list changes since a pinned baseline, read one file's bounded diff, and capture
    source snapshots — HEAD, the index and digests of changed files, never file content. Feedback is
    tied to the snapshot it was written against and is marked stale when that source moves.
  - Coding receipts record the source state at their execution boundary, and a receipt's applicability is
    shown on the chat card as unchanged, changed or unknown — never as a pass.
  - Model resolution fails closed: an unknown model id is refused instead of being sent to a provider
    default carrying another provider's credential.
  - CLI: `team review show|capture|snapshots|snapshot`; repeated flags such as `agent chat --image` and
    `team review capture --include` now honour every occurrence instead of only the last.

## 0.16.0

### Minor Changes

- [#46](https://github.com/rullopat/bazilion/pull/46) [`81aaa31`](https://github.com/rullopat/bazilion/commit/81aaa31d115b777c948473de35aac5564a596c78) Thanks [@rullopat](https://github.com/rullopat)! - Let Agents inspect their admitted runtime, prepare local prerequisites and run scoped coding commands
  during ordinary tasks. Bounded command results appear in chat, and policy-authorized teammates can
  share receipts through existing messages. Team runtime defaults are optional; there is no operator
  check dashboard.

  Coordinate overlapping Agent workspaces through cancellation and restart recovery. Restored active work
  is interrupted, and copied resource identities cannot terminate the original home's workers. This
  changes the canonical alpha database schema and requires the existing clean-install/reset workflow for
  older homes.

- [#46](https://github.com/rullopat/bazilion/pull/46) [`0832ce9`](https://github.com/rullopat/bazilion/commit/0832ce9b2ddd78d9c30d9ad9195775d6ec0971a3) Thanks [@rullopat](https://github.com/rullopat)! - Add Team repository inspection, scoped AGENTS.md context for coding Agents, and passive command
  suggestions with source provenance. Inspect and refresh through the Team page,
  `bazilion team context`, or the authenticated client/API. Repository discovery remains
  daemon-owned, bounded, and separate from execution permission.

## 0.15.0

### Minor Changes

- [#44](https://github.com/rullopat/bazilion/pull/44) [`624b731`](https://github.com/rullopat/bazilion/commit/624b7318babf8bba4fc68a132983f1c831dfd0b1) Thanks [@rullopat](https://github.com/rullopat)! - Save explicitly delivered Agent files as immutable Team-owned results. Chat cards survive completion,
  reload and restart; the Team Results view and `bazilion result` commands provide authenticated lookup,
  safe previews, downloads and explicit deletion. Native chat preserves the browser handoff, and Telegram
  sends the captured bytes through existing communication authorization and approvals.

  Results retain source provenance and verified hashes in backup/restore. Released bytes remain until
  explicit deletion, within a 25 MiB per-file and 1 GiB retained-byte limit. This changes the canonical alpha
  database schema and requires the existing clean-install/reset workflow for older homes.

- [#44](https://github.com/rullopat/bazilion/pull/44) [`fa126ac`](https://github.com/rullopat/bazilion/commit/fa126acbdd315ccb6208da0bee7b69be1bd6ab3b) Thanks [@rullopat](https://github.com/rullopat)! - Queue follow-up instructions while an Agent works, with durable input and original attachment
  bytes shared across web, CLI and Telegram. Inspect, edit or remove pending input; pause, resume,
  or stop without losing the remaining queue. Stable request identities reconcile lost acknowledgements.
  Interrupted and restored work remains visibly uncertain until reviewed, with no automatic replay.
  The canonical alpha schema changes require the documented clean-install workflow for older homes.

- [#44](https://github.com/rullopat/bazilion/pull/44) [`0af1061`](https://github.com/rullopat/bazilion/commit/0af106176d01ecb958162e5bd81aec879ebaca13) Thanks [@rullopat](https://github.com/rullopat)! - Retain Agent conversations with list, read, rename and New conversation controls in web and CLI.
  Daemon-owned selection and explicit foreground/background targets prevent stale clients or file
  activity from redirecting work. Saved results keep their original conversation links. Missing history
  has an explicit recovery path; ordinary destructive chat reset is removed. The canonical alpha
  schema changes and older homes require the documented clean-install workflow.

- [#44](https://github.com/rullopat/bazilion/pull/44) [`6e37e77`](https://github.com/rullopat/bazilion/commit/6e37e77f4a9340253ef911b2803a9e33277e52f7) Thanks [@rullopat](https://github.com/rullopat)! - Let eligible interactive Agents ask a bounded question with choices, Other and Skip across web,
  terminal and paired-owner Telegram. Recover live cards after reload, reconcile exact answer retries,
  and distinguish accepted answers from verified consumption in the original conversation. Existing
  communication approvals remain authoritative; expired, interrupted and restored questions never
  restart a turn. Native mobile shows an explicit web handoff. The canonical alpha schema changes
  require the documented clean-install workflow for older homes.

- [#44](https://github.com/rullopat/bazilion/pull/44) [`4f34efc`](https://github.com/rullopat/bazilion/commit/4f34efce254b3daa6744aae6b54209c5b683367d) Thanks [@rullopat](https://github.com/rullopat)! - Add opt-in Telegram notifications for existing Attention items, with explicit service-topic
  selection, quiet hours, old-item previews and shared web/CLI controls. Durable receipts distinguish
  confirmed, failed and uncertain sends; explicit retries acknowledge possible duplication. Current
  source, pairing and egress policy remain authoritative, and restored backups pause notifications
  for reconciliation. The canonical alpha schema changes require the documented clean-install workflow.

### Patch Changes

- [#44](https://github.com/rullopat/bazilion/pull/44) [`b213880`](https://github.com/rullopat/bazilion/commit/b213880b04079c956a20735ac23edbd2105443e2) Thanks [@rullopat](https://github.com/rullopat)! - Polish conversation, follow-up queue, live question and notification layouts across desktop and
  narrow screens. Align form controls, improve card spacing and choice selection, remove nested queue
  scrolling, and explain notification destinations and uncertain delivery while keeping technical
  identifiers available in expandable details.

## 0.14.2

### Patch Changes

- Upgrade the bundled Pi packages from 0.84.3 to 0.85.1, making GPT-6 Astra (`gpt-6-astra`) available in the OpenAI and OpenAI Codex catalogs. Refresh setup examples and verify catalog coverage for both API-key and ChatGPT OAuth selection.

## 0.14.1

### Patch Changes

- Fail fast with actionable recovery for incompatible alpha databases and mismatched bootstrap
  identity, keep database and auth resets paired across interruption, make ChatGPT OAuth callback
  cancellation and device-code fallback reliable, propagate abandoned gateway requests, and surface
  sanitized native-module ABI recovery guidance across chat and memory.

## 0.14.0

### Minor Changes

- Overhaul the web and mobile operator experience with secure first-run browser bootstrap, correct
  native chat streaming and pairing, safer durable edits and destructive actions, searchable provider
  setup, responsive management surfaces, accessible navigation and dialogs, and clearer information
  architecture.

## 0.13.0

### Minor Changes

- Add credential-minimal protected execution for Telegram and autonomous Agent work, including
  fail-closed Docker isolation, trusted invocation identity, guarded web fetching, and restricted
  review workers. Replace Telegram first-sender ownership with authenticated one-time owner pairing
  and add privacy, membership, identity, and secret-safe diagnostic checks.

- Add a loopback-only private web gateway profile with Tailscale Serve preflight, expiring device
  credentials, bounded hashed browser sessions, session-bound CSRF, strict origin/header policy,
  protected identity, and CLI, web, mobile, backup, and restore parity.

- Add recipient-encrypted age backups, authenticated staged restore, secret-name-only inventories,
  crash-safe bootstrap rotation, non-bootstrap token revocation, and explicit credential recovery
  guidance. Plaintext backups now require `--plaintext`.

- Add a deterministic 60-case adversarial security acceptance gate covering the composed private
  gateway, credential recovery, Telegram ingress, protected workers, SSRF, and Docker boundaries.

- Extend protected and restricted-review workers across the complete pinned Pi provider catalog
  with exhaustive drift checks and fail-closed provider-specific credential projections.

- Update the bundled Pi agent engine to 0.84.3, add Baseten and Qwen Token Plan Individual, adapt
  OAuth cancellation and prompt normalization, and refresh curated model examples.

## 0.12.2

### Patch Changes

- Update the bundled Pi agent engine to 0.83.0, adapt OAuth and session runtime integration to its
  public provider APIs, add Qwen Token Plan providers, and refresh curated model examples.

## 0.12.1

### Patch Changes

- Pin the Pi dependency family to the tested 0.80.6 release so clean npm installs cannot resolve a
  newer incompatible OAuth API and crash the Bazilion CLI at startup.

## 0.12.0

### Minor Changes

- Add the Operator Attention Center: one source-owned queue and navigation badge for pending
  communication approvals, reviewed-learning proposals, terminal review and trigger failures, and
  Agent message loop breaks. Operators can filter the queue, navigate to canonical decision screens,
  and acknowledge or restore informational failures through authenticated HTTP, CLI, and responsive
  web surfaces without copying payloads into a second audit store.

- [`6991fde`](https://github.com/rullopat/bazilion/commit/6991fdebd44cca2b7bd82079dd418fa75c20d2aa) Thanks [@rullopat](https://github.com/rullopat)! - Add an opt-in reviewed learning loop for long-lived Agents. Successful user turns can enqueue
  durable, restricted background reviews that produce evidence-backed private or shared lesson
  proposals. Operators can configure cadence/model/reasoning, inspect and edit proposals, approve or
  reject them, and later revoke approved lessons through authenticated HTTP, CLI, and the Agent
  Learning web tab. Approved private lessons enter only that Agent's prompt; shared lessons become
  deterministic Team-memory notes.

- [`f0395a7`](https://github.com/rullopat/bazilion/commit/f0395a7df7388ef8ca19ebda51053c0fc90e11ad) Thanks [@rullopat](https://github.com/rullopat)! - Add a durable agent-message loop circuit breaker. Messages now retain causal
  chain and hop metadata, inbox wake turns propagate that ancestry even when an
  Agent omits `reply_to`, and the daemon rejects over-budget sends before they can
  wake another LLM turn. Configure the ceiling with
  `BAZILION_AGENT_LOOP_MAX_HOPS`; inspect payload-free stop events through the
  Agent API, `bazilion inbox loop-breaks`, or the web inbox.

## 0.11.0

### Minor Changes

- [`e63f48a`](https://github.com/rullopat/bazilion/commit/e63f48a9c15e12f3dc7e5f204fc060abb0f2aa7e) Thanks [@rullopat](https://github.com/rullopat)! - Add opt-in Docker isolation and dangerous-command approval for agent shell commands. Docker mode runs a same-name Pi
  `bash` replacement with scrubbed image and worker environments, no network, a read-only root, one
  writable team workspace, and non-recursive bounded read-only memory, skill, and attachment mounts;
  host-backed coding tools are hidden so absolute paths cannot bypass the container boundary. Reject
  remote Docker contexts and implicit image volumes, surface the posture through shared service
  configuration and `bazilion doctor`, and harden host-side memory and file delivery against symlink
  escapes. Dangerous mode gates classified commands through turn-scoped daemon IPC, inline web and
  TTY CLI decisions, timeout/cancellation cleanup, and non-interactive auto-denial.

- [`675200b`](https://github.com/rullopat/bazilion/commit/675200b019957f3406820aa47976f6b3633c3777) Thanks [@rullopat](https://github.com/rullopat)! - Make scheduled triggers durable across agent contention, retries, and daemon restarts. Add
  coalesced dispatch persistence, bounded retry with lease recovery, API and CLI diagnostics, and
  recent dispatch status in the web UI. Provider errors now enter the retry state machine, while
  approval-gated occurrences remain pending until a durable grant is executed by the scheduler.

- [`1dc56d0`](https://github.com/rullopat/bazilion/commit/1dc56d01522bbacb5212a0d9f30fa00403667552) Thanks [@rullopat](https://github.com/rullopat)! - Make online backups use a verified SQLite snapshot instead of archiving live WAL state, and harden
  restore with archive/link validation, auth-to-database checks, offline-daemon detection, staged
  atomic installation, exact-schema verification, destination path rebasing, exclusive
  daemon/restore ownership, crash-phase recovery markers, rollback, and failed-download cleanup.
  Contained relative symlinks in work product are preserved while escaping targets remain rejected.

### Patch Changes

- [`1dc56d0`](https://github.com/rullopat/bazilion/commit/1dc56d01522bbacb5212a0d9f30fa00403667552) Thanks [@rullopat](https://github.com/rullopat)! - Refresh expiring ChatGPT OAuth access tokens during worker turns through provider-, Agent-, and
  turn-bound daemon IPC. Keep refresh credentials DB-owned, redact upstream failures, clean pending
  IPC calls on cancellation or disconnect, and single-flight concurrent rotating-token refreshes.

## 0.10.0

### Minor Changes

- [`b4c5b07`](https://github.com/rullopat/bazilion/commit/b4c5b0790153c33d81b2a532e8451902d0f86b3c) Thanks [@rullopat](https://github.com/rullopat)! - Refresh the web application shell and responsive management surfaces, strengthen Team Policy
  lifecycle handling, and replace the optional `HEARTBEAT.md` profile convention with explicit
  interval and cron trigger instructions.

## 0.9.0

### Breaking Changes

- Replace Group, Profile Group, and Harness commands/routes with canonical `team`,
  `team-template`, and `team policy` surfaces. Remove compatibility aliases and require a fresh
  alpha data bootstrap for the consolidated `0001_init.sql` schema.

### Minor Changes

- [#37](https://github.com/rullopat/bazilion/pull/37) [`6e65d3e`](https://github.com/rullopat/bazilion/commit/6e65d3e97ceb0c4bfdbf996eda3ae194ddc4890a) Thanks [@rullopat](https://github.com/rullopat)! - Update the bundled Pi agent packages to 0.80.6 and refresh provider examples for the GPT-5.6
  Luna, Terra, and Sol model family.

### Patch Changes

- [#26](https://github.com/rullopat/bazilion/pull/26) [`1989c29`](https://github.com/rullopat/bazilion/commit/1989c29feaa60a3f4f26e2e640ca04507664fe0f) Thanks [@rullopat](https://github.com/rullopat)! - Complete the breaking alpha cleanup to canonical Teams, Team Templates, and Team Policy. Remove
  Group, Profile Group, Harness prototype, compatibility API/URL, and incremental migration
  surfaces; consolidate fresh installs into the final `0001_init.sql` schema.

## 0.8.0

### Minor Changes

- Add static skill content scanning for prompt-injection, credential access, exfiltration wording, and stealth Unicode. Risky skills now require explicit confirmation on import and per-agent attach, with findings surfaced in CLI, API, and web UI.

## 0.7.0

### Minor Changes

- Update pi agent packages to 0.79.10 and refresh provider/model setup.

  Adds Bazilion config support for the new pi-ai providers, refreshes model catalog examples, and improves first-run setup guidance for enabling providers and saving curated models.

## 0.6.0

### Minor Changes

- Bundle the production web UI into the published CLI package and add `bazilion dashboard` to start or reuse the local daemon, run the bundled web server, and open the dashboard.

## 0.5.1

### Patch Changes

- [#22](https://github.com/rullopat/bazilion/pull/22) [`8099ddb`](https://github.com/rullopat/bazilion/commit/8099ddbb4d500b16da1cec8ae25a3a6256b3e2a4) Thanks [@rullopat](https://github.com/rullopat)! - Telegram now renders agent replies with the same Markdown formatting as the Web UI.

  Replies previously arrived as plain text (no `parse_mode`), so `**bold**`, `# headings`, and `` `code` `` showed up as literal syntax, and long replies were truncated. A new converter reuses `marked`'s lexer (the same parse the Web UI uses) and walks the tokens into Telegram's supported HTML entity set (`<b>`/`<i>`/`<s>`/`<code>`/`<pre>`/`<a>`/`<blockquote>`), approximating the features Telegram has no entity for: headings → emoji-prefixed bold (`▎`/`▸`/`·` by level, since Telegram has no font sizing), tables → aligned monospace `<pre>` block, lists → `•`/`1.` bullets with indent and `☐`/`☑` task items, `---` → a box-char rule. A tag-aware splitter replaces truncation, chunking long replies under Telegram's 4096-char limit while keeping every entity balanced across the cut; if Telegram rejects a chunk's entities the mirror retries it once as plain text so a reply is never dropped. Error and verbose tool-trace lines stay plain text.

## 0.5.0

### Minor Changes

- [#9](https://github.com/rullopat/bazilion/pull/9) [`2ab6537`](https://github.com/rullopat/bazilion/commit/2ab6537a227422c7e3fb063458b75a7ac72faf82) Thanks [@rullopat](https://github.com/rullopat)! - Agent templates refresh: a two-sided bootstrap, a seeded USER.md, a richer workspace manual, and agent identity (avatar + creature) in the web UI.

  **Two-phase bootstrap + seeded USER.md.** The first-run ritual now asks about _you_ as well as the agent. Phase 1 fills IDENTITY.md (name, creature, vibe, emoji, optional avatar); phase 2 reads `user_md_get` → writes USER.md → `bootstrap_done`. New teams are seeded with a starter `USER.md` instead of an empty string, and a one-shot migration backfills existing teams whose `user_md` is still empty.

  **Richer default templates.** SOUL.md, AGENTS.md (now a full workspace operating manual — memory discipline, red lines, and external-channel etiquette for Telegram + future channels), and TOOLS.md are substantially expanded. IDENTITY.md gains **Creature** and **Avatar** fields.

  **Default-on templates, HEARTBEAT opt-in.** AGENTS.md and TOOLS.md now ship with every profile by default (previously opt-in); HEARTBEAT.md stays opt-in. Pass `null` to opt any of them out. The bazilion-managed `default` profile is brought in sync with the shipped templates on boot (operator edits to custom profiles are never touched).

  **Agent identity in the web UI.** Agents now expose a parsed `identity` (name, creature, vibe, avatar) read from their own IDENTITY.md. The agent list and detail pages render an avatar (http(s):// or data: URIs only) and creature, falling back to the emoji.

  **Profile create form redesign.** The two collapsible template teams are replaced by a tab per template plus a "templates to include" checklist — SOUL/IDENTITY are always included; BOOTSTRAP/AGENTS/TOOLS default on; HEARTBEAT defaults off. Disabling a template greys out its tab. The profile-team create form now prefills the starter USER.md.

  Strictly additive: existing endpoints, profiles, and agents behave unchanged. `Agent`/`ResolvedAgent` gain an optional `identity`, and `CreateProfileRequest` accepts `null` for `agents`/`tools`/`heartbeat` to skip those files.

## 0.4.0

### Minor Changes

- [#19](https://github.com/rullopat/bazilion/pull/19) [`a9715c2`](https://github.com/rullopat/bazilion/commit/a9715c2b90aba9933affc9e77b19495791f93694) Thanks [@rullopat](https://github.com/rullopat)! - Add Playwright browser automation and MCP client support.

  **Browser automation** — agents get a `browser_*` tool suite (navigate, snapshot, click, type, hover, select, fill_form, press_key, go_back, tabs, take_screenshot, console, network) backed by a persistent per-agent Playwright session that survives across turns. Perception is accessibility-tree-first (`browser_snapshot` returns an aria tree with `[ref=eN]` element refs — no vision model needed); screenshots are a secondary, multimodal escape hatch rendered inline in chat. A network-layer SSRF guard blocks loopback/private targets (override with `BROWSER_ALLOW_PRIVATE_NETWORK` for local dev). Configure on `/config` (Browser Automation) or via env. Run `pnpm exec playwright install chromium` once.

  **MCP client** — connect the daemon to Model Context Protocol servers over stdio (local subprocess), Streamable-HTTP, or SSE (with optional bearer auth). Each enabled server's tools are discovered and injected into every agent turn, namespaced `mcp__<server>__<tool>`. Manage with `bazilion mcp add|list|show|rm|enable|disable|test` or the `/config/mcp` page.

  Both run as long-lived daemon-side resources (idle-reaped, closed on shutdown) reached from the stateless per-turn worker over IPC. Tool results are now multimodal (text + images).

  **Bidirectional attachments across all clients** — send any file _in_ and receive any file _out_, on web, Telegram, and CLI. Inbound files travel as one generic `Attachment {name?, mimeType, data}`; the daemon classifies each at turn assembly: `image/*` goes to the model as **vision** (pi `prompt({images})`), everything else is **stored under the agent's home and referenced by path** so the agent opens/processes it with its tools. Attach via the web composer (📎 / paste / **drag-and-drop**), a Telegram photo/document/voice/etc., or `bazilion agent chat <id> --image <path>` / `--file <path>`.

  Outbound: tool-produced images (browser screenshots, MCP image results) surface as first-class deliverables — a standalone image block in the web chat (not buried in the tool call) and a photo on Telegram (regardless of mirror mode). Agents send arbitrary files back with a new **`deliver_file`** tool — a download link in the web chat, a document on Telegram, saved to disk on the CLI.

  Audio and video are intentionally deferred: pi and every wired provider are text+image only, so the model can't perceive non-image media as input yet (it gets a stored file + path) — revisit when a provider exposes those modalities. 25 MB per file.

### Patch Changes

- [#19](https://github.com/rullopat/bazilion/pull/19) [`a9715c2`](https://github.com/rullopat/bazilion/commit/a9715c2b90aba9933affc9e77b19495791f93694) Thanks [@rullopat](https://github.com/rullopat)! - Upgrade dependencies and refresh the model catalog examples.

  **pi 0.75.4 → 0.77.0** — bump `@earendil-works/pi-agent-core`, `pi-ai`, and `pi-coding-agent`, which ships an expanded built-in LLM model catalog. The `/config` provider catalog is already data-driven off pi's `getModels()`, so the new models surface automatically; the hardcoded per-provider example hints (`exampleModelFor` on `/config`, plus the `welcome` page and the `profile`/`provider`/`auth` CLI help) were refreshed to mirror the 0.77 catalog (e.g. `claude-opus-4-8`, `gpt-5.5`, `gemini-3-pro-preview`) and drop entries pi no longer lists.

  Also picked up in-range patch/minor updates across the tree (`@tobilu/qmd`, `hono`, `@hono/node-server`, `playwright`, `typebox`, `@biomejs/biome`, `tsup`, and the web/mobile toolchains). Mobile's Expo-pinned native modules (`react-native-reanimated`, `react-native-gesture-handler`, `react-native-worklets`) were intentionally held at the versions Expo SDK 56 blesses.

## 0.3.0

### Minor Changes

- **Telegram integration.** Agents can now live in a Telegram forum supergroup — one topic per agent, two-way chat, and a ⚙ bazilion control-plane topic.

  - **Connect** a bot + forum supergroup via the web (`/config/integrations/telegram`) or CLI (`bazilion telegram config set`), with a preflight health check (bot identity, supergroup reachable, forum topics enabled, Manage Topics permission, Privacy Mode off).
  - **Spawn and bind** agents from Telegram (`/spawn`, `/spawn_team`, `/talk`), the web agent page, or `bazilion telegram bind`. Each agent gets its own named topic with a profile-derived icon; per-team templates control topic naming and rename propagation.
  - **Two-way chat:** type in an agent's topic to run a turn; replies mirror back with a typing indicator and a 👀 reaction. Messages sent while the agent is busy are queued and answered together. Inbound photos/documents/voice are downloaded (≤20 MB) and referenced for the agent.
  - **Access control** with trust-on-first-use: the first user to message the bot becomes owner; owners manage members with `/allow` / `/deny` (also the web Access control card and `bazilion telegram allow`).
  - **Resilience:** per-agent inbound/outbound rate budgets, an outbound send queue, a polling stall-watchdog auto-restart, supergroup-migration reconnect, and lazy reconciliation when a topic is deleted in Telegram.

  New Telegram wire types in `@bazilion/api-types`; `@bazilion/client` and `bazilion` bump in lockstep (fixed team).

## 0.2.1

### Patch Changes

- [#5](https://github.com/rullopat/bazilion/pull/5) [`9707acc`](https://github.com/rullopat/bazilion/commit/9707acceb58983b6fc83be2accba1312d5ac00f3) Thanks [@rullopat](https://github.com/rullopat)! - **Fix `bazilion@0.2.0` crash on `serve`** — the npm package was broken; `npx bazilion serve` exited with `ERR_MODULE_NOT_FOUND: Cannot find package 'sqlite'` before the daemon could bind a port.

  Two build-pipeline bugs in `apps/cli/tsup.config.ts`:

  - esbuild's hardcoded known-builtins list predates `node:sqlite` (Node 22+). It auto-externalizes `node:` imports before plugin `onResolve` hooks can intercept them, then strips the `node:` prefix at print time — so `from 'node:sqlite'` shipped as `from "sqlite"` in the bundle, which Node tried to resolve from `node_modules` and failed. There's no esbuild flag to force-keep the prefix; the fix is a post-build string replace in tsup's `onSuccess` hook.
  - SQL migration files weren't being staged into `dist/`. `migrate.ts` reads them relative to `import.meta.url` (i.e. `dist/migrations/`), but tsup only emits JS. The published 0.2.0 has this bug too — the sqlite crash just masked it. The same `onSuccess` hook now copies `apps/daemon/src/core/db/migrations/*.sql` into `dist/migrations/`.

  Verified with a clean `BAZILION_HOME`: `node dist/cli.js serve` boots, auto-bootstraps `~/.bazilion`, writes `auth.json`, listens on the port, and `/api/health` returns 200.

  No source changes; no API or wire-shape changes. The `@bazilion/client` and `@bazilion/api-types` bumps are lockstep-fixed by `.changeset/config.json`.

## 0.2.0

### Minor Changes

- [#1](https://github.com/rullopat/bazilion/pull/1) [`27a0456`](https://github.com/rullopat/bazilion/commit/27a0456d244361fbab9c79a61491b00c23727cfb) Thanks [@rullopat](https://github.com/rullopat)! - **Profile Teams (BAZ-002)** — preconfigured team templates that spawn N agents into a target team in one atomic call.

  - New `profile_groups` + `profile_group_members` schema; CRUD via `GET|POST|PATCH|DELETE /api/profile-teams` and `PUT /api/profile-teams/:id/members`.
  - `POST /api/profile-teams/:id/spawn` resolves member name collisions with `-2`, `-3`, … suffixes, auto-creates the target team when its slug doesn't exist, and rolls back the whole batch on any failure (with retry-with-backoff cleanup of orphan agent dirs).
  - CLI: `bazilion profile-team create/list/show/update/edit/delete/spawn`.
  - Web UI: `/profile-teams` list + detail pages under a new "templates" tab that shares space with profiles; the sidebar `+ new ▾` menu has two sections (spawn agent from template / spawn team from template); empty teams show a "spawn team from template" CTA.
  - Wire types: `ProfileGroup`, `ProfileGroupMember`, `ProfileTeamDetail`, `ProfileGroupWithCount`, plus `Create|Update|PutMembers|SpawnProfileGroupRequest` and `SpawnProfileGroupResponse` in `@bazilion/api-types`.

  **Other fixes shipped with this release**

  - Friendly error when deleting a profile that's still referenced by a profile team (was a raw SQLite FK error).
  - Web UI now surfaces daemon errors on profile delete (was silently swallowed).
  - New shared `<Button variant="primary|ghost|danger">` component + `.danger-btn` CSS class — prevents the "bare `<button type='button'>` lost all styling" class of bug.
  - Theme flash on navigation fixed (root layout now uses `data-layout` instead of `className` so the pre-paint `.dark` class survives reconciliation).

## 0.1.1

### Patch Changes

- Release v0.1.1.

  - **Shared USER.md editing for agents.** New `user_md_get` / `user_md_write` tools let any agent in a team update the shared USER.md with optimistic-etag concurrency control. Previously agents could only read it. USER.md is capped at 12 KB (it's inlined into every system prompt).
  - **Provider expansion.** Switched the underlying pi-ai package from `@mariozechner/pi-ai` to `@earendil-works/pi-ai`. New providers wired through `loadProviderConfigFromEnv`: DeepSeek, Fireworks, Together, Moonshot AI, Kimi Coding, MiniMax, Xiaomi MiMo, OpenCode, GitHub Copilot, Cloudflare AI Gateway, Cloudflare Workers AI, llama.cpp.
  - **Web fetch tool hardened.** Readability extraction + markdown output, SSRF guard with DNS-rebinding re-validation, 15-min LRU per `${mode}|${url}`. UA spoofs desktop Safari.
  - **Worker IPC protocol extended.** `UserMdHost` joins `MessagingHost` as a daemon-side RPC surface; the worker no longer needs a SQLite handle to touch shared state.
  - **Web UI polish.** Services config page, root chat layout, theme tokens, FieldRow component.
  - **Backlog system grows.** BAZ-002 (Profile Teams — preconfigured team templates) and BAZ-003 (Hermes-style self-learning loop) added as drafts under `docs/backlog/draft/`.
