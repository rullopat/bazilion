import { defineCommand } from 'citty'

interface CommandNode {
  subCommands?: Record<string, CommandNode | Promise<CommandNode>>
  args?: Record<string, { type?: string; alias?: string | string[] }>
}

interface Flatten {
  /** full path e.g. ["agent", "chat"]; empty for the top-level root */
  path: string[]
  /** immediate subcommand names available at this path */
  subs: string[]
  /** flag tokens e.g. ["--profile", "--name", "--long", "-l"] */
  flags: string[]
}

async function walk(cmd: CommandNode, path: string[], out: Flatten[]): Promise<void> {
  const subsRaw = cmd.subCommands ?? {}
  const subNames = Object.keys(subsRaw)
  const flags = flagsOf(cmd.args ?? {})
  out.push({ path, subs: subNames, flags })
  for (const name of subNames) {
    const v = subsRaw[name]
    const sub = (await Promise.resolve(v)) as CommandNode
    await walk(sub, [...path, name], out)
  }
}

function flagsOf(args: Record<string, { type?: string; alias?: string | string[] }>): string[] {
  const out: string[] = []
  for (const [name, def] of Object.entries(args)) {
    // Positionals don't get completed as flags.
    if (def.type === 'positional') continue
    out.push(`--${name}`)
    const aliases = Array.isArray(def.alias) ? def.alias : def.alias ? [def.alias] : []
    for (const a of aliases) out.push(a.length === 1 ? `-${a}` : `--${a}`)
  }
  return out
}

function bashScript(flat: Flatten[]): string {
  const cases = flat
    .map((f) => {
      const key = f.path.length === 0 ? '""' : JSON.stringify(f.path.join(' '))
      const words = [...f.subs, ...f.flags].join(' ')
      return `    ${key})\n      COMPREPLY=($(compgen -W ${JSON.stringify(words)} -- "$cur"))\n      ;;`
    })
    .join('\n')
  return `# bazilion bash completion. Install with:
#   source <(bazilion completion bash)
# or append to ~/.bashrc / ~/.bash_profile.
_bazilion_completion() {
  local cur prev cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cword=$COMP_CWORD
  # Build the current subcommand path by walking words[1..cword-1], skipping
  # flags and their values. We don't try to parse flag arity — treating every
  # flag as standalone is a good-enough approximation for completion.
  local cmd=""
  local i
  for ((i=1; i<cword; i++)); do
    local w="\${COMP_WORDS[i]}"
    [[ "$w" == -* ]] && continue
    cmd+="\${cmd:+ }$w"
  done
  case "$cmd" in
${cases}
    *)
      COMPREPLY=()
      ;;
  esac
}
complete -F _bazilion_completion bazilion
`
}

function zshScript(flat: Flatten[]): string {
  // zsh bundles a bashcompinit shim; reusing the bash script sidesteps the
  // cost of a native _arguments/_describe implementation while still giving
  // users a working completion. Ships with a tiny preamble so zsh loads the
  // bash compat helpers first.
  const bash = bashScript(flat)
  return `# bazilion zsh completion. Install with:
#   source <(bazilion completion zsh)
# If you don't already have bashcompinit loaded, this does it for you.
autoload -U +X compinit && compinit
autoload -U +X bashcompinit && bashcompinit
${bash}`
}

function fishScript(flat: Flatten[]): string {
  const lines: string[] = [
    '# bazilion fish completion. Install with:',
    '#   bazilion completion fish | source',
    '# or write it to ~/.config/fish/completions/bazilion.fish',
    '',
    'complete -c bazilion -f',
  ]
  for (const f of flat) {
    if (f.path.length === 0) {
      for (const s of f.subs) lines.push(`complete -c bazilion -n '__fish_use_subcommand' -a ${s}`)
      for (const fl of f.flags) {
        const long = fl.startsWith('--') ? fl.slice(2) : ''
        const short = !fl.startsWith('--') ? fl.slice(1) : ''
        const parts: string[] = ["complete -c bazilion -n '__fish_use_subcommand'"]
        if (short) parts.push(`-s ${short}`)
        if (long) parts.push(`-l ${long}`)
        lines.push(parts.join(' '))
      }
    } else {
      // Guard this case on the joined path being the last N tokens in
      // COMP_CWORDS — fish's __fish_seen_subcommand_from handles each token
      // independently, so we require every path segment.
      const guard = f.path.map((p) => `__fish_seen_subcommand_from ${p}`).join('; and ')
      for (const s of f.subs) {
        lines.push(`complete -c bazilion -n '${guard}' -a ${s}`)
      }
      for (const fl of f.flags) {
        const long = fl.startsWith('--') ? fl.slice(2) : ''
        const short = !fl.startsWith('--') ? fl.slice(1) : ''
        const parts: string[] = [`complete -c bazilion -n '${guard}'`]
        if (short) parts.push(`-s ${short}`)
        if (long) parts.push(`-l ${long}`)
        lines.push(parts.join(' '))
      }
    }
  }
  return `${lines.join('\n')}\n`
}

export function completionCommand(main: CommandNode) {
  return defineCommand({
    meta: {
      name: 'completion',
      description: 'Print a shell completion script (bash, zsh, or fish)',
    },
    args: {
      shell: {
        type: 'positional',
        required: true,
        description: 'bash | zsh | fish',
      },
    },
    async run({ args }) {
      const flat: Flatten[] = []
      await walk(main, [], flat)
      const shell = String(args.shell).toLowerCase()
      if (shell === 'bash') console.log(bashScript(flat))
      else if (shell === 'zsh') console.log(zshScript(flat))
      else if (shell === 'fish') console.log(fishScript(flat))
      else throw new Error(`unsupported shell: ${args.shell} (want bash | zsh | fish)`)
    },
  })
}
