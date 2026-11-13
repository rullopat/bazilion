# bazilion

A local multi-agent runtime for one person: Agents built on the
[Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding agent, organised in
Teams with shared workspaces and memory, reachable from a web UI, this CLI and Telegram. This
package contains the CLI, the daemon and the web UI.

[![npm](https://img.shields.io/npm/v/bazilion.svg)](https://www.npmjs.com/package/bazilion) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/rullopat/bazilion/blob/main/LICENSE)

Alpha: interfaces and the database schema change between 0.x releases.

## Install

Requires Node.js `^26.12.1`; the CLI refuses other versions. Developed on Linux; macOS is
untested and Windows is not supported.

```sh
npm install -g bazilion       # or run each command below as `npx bazilion …`
bazilion dashboard
```

## First run

`bazilion dashboard` starts the daemon on `127.0.0.1:4321` and the web UI on `127.0.0.1:4322`
and opens your browser. On first start the daemon creates `~/.bazilion` (or `$BAZILION_HOME`)
and a bootstrap token in `~/.bazilion/auth.json`; the CLI uses it automatically, and you paste it
into the web login (`bazilion token show-local` prints it).

Until one provider is enabled with a saved model, the web UI shows the setup page. Then a
`default` Profile and a `default` Team are created for you. The same from a terminal:

```sh
bazilion auth openai login                         # use your ChatGPT account, or store a key
bazilion config set ANTHROPIC_API_KEY sk-ant-…     # (encrypted; /config keeps it out of history)

bazilion provider enable anthropic
bazilion provider models-set anthropic claude-opus-5

bazilion agent spawn --profile default --name first
bazilion agent chat <agent-id> --message "say hi"   # one turn; the web UI is the chat client
```

`bazilion serve` starts the daemon alone; `bazilion doctor` checks the installation. Run
`bazilion --help` for every command and `bazilion <command> --help` for its options.

## Common commands

```sh
bazilion team add my-app --link ~/code/my-app   # a Team working in an existing project
bazilion agent move <agent-id> my-app
bazilion trigger add <agent-id> --cron "0 9 * * 1-5" --message "Plan the day"
bazilion mcp add files --command npx --args "-y @modelcontextprotocol/server-filesystem /tmp"
bazilion backup create --recipient age1…         # encrypted online backup
bazilion uninstall                               # reset the home (keeps skills)
```

Exit codes: `0` success, `1` failure, `2` invalid request, `3` conflict (for example a busy
Agent), `4` authentication failure.

## Upgrading

```sh
npm install -g bazilion@latest
```

There are no database migrations: when a release changes the schema, the daemon refuses the old
home and leaves it untouched. Back it up, run `bazilion uninstall --yes` and start again; see the
[upgrade guide](https://github.com/rullopat/bazilion/blob/main/docs/upgrades.md).

## Documentation

- [README and quickstart](https://github.com/rullopat/bazilion#readme)
- [Guides](https://github.com/rullopat/bazilion/blob/main/docs/README.md): coding and the Docker
  sandbox, Telegram, MCP, the managed browser, the private gateway, backup
- [Architecture](https://github.com/rullopat/bazilion/blob/main/docs/architecture.md)
- [Changelog](https://github.com/rullopat/bazilion/blob/main/apps/cli/CHANGELOG.md)
- [Issues](https://github.com/rullopat/bazilion/issues)

## License

[MIT](https://github.com/rullopat/bazilion/blob/main/LICENSE)
