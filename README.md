# pi-agents — custom agents and the harness that wires them

The custom-defined agents for your `pi` instances, the supporting tool
extensions, and the scripts that keep them all in sync. Versioned, portable,
deployable with one command on a new device.

This is the **agent layer** of the harness. It depends on the engine
layer ([`arendon1/pi-soul-engine`](https://github.com/arendon1/pi-soul-engine))
and one tool extension ([`arendon1/pi-web-search`](https://github.com/arendon1/pi-web-search)).

## Why this repo exists

`pi` ships with default agents. They are generic. This repo holds the
customized versions of three of them — bound to souls, tuned with specific
models, with explicit read-only enforcement and grounding instructions —
and the supporting files that make them work. Without it, every new
device is a manual copy-paste of these files from somewhere you don't
remember.

## What's in here

```
pi-agents/
├── agents/                   # the three custom subagent definitions
│   ├── explore.md            #   fast read-only search, deepseek-flash
│   ├── plan.md               #   software architect, glm-flash
│   └── researcher.md         #   web-search-grounded, inherits parent model
├── extensions/
│   └── grounding.ts          #   time / location / network-trust tool
├── scripts/
│   ├── create-souls.sh       #   creates the four subagent soul instances
│   └── bindings.json         #   agent-type → soul-name mapping
├── install.sh                #   one-command install onto a pi instance
├── uninstall.sh              #   reversible removal
├── CHANGELOG.md
└── LICENSE
```

## Architecture (three layers)

```
┌────────────────────────────────────────────────────────────┐
│ Agent (agents/*.md)                                        │
│   - what the agent IS: tools, model, prompt, soul binding  │
│   - lives in ~/.pi/agent/agents/                           │
├────────────────────────────────────────────────────────────┤
│ Soul (~/.pi/agent/souls/<name>.soul/)                      │
│   - who the agent IS: identity, memory, mood, bond         │
│   - created by scripts/create-souls.sh                     │
├────────────────────────────────────────────────────────────┤
│ Tool (extensions/grounding.ts, web_search)                 │
│   - what the agent can DO: time, location, web, etc.       │
│   - ground-truth, vendor-first-party research sources      │
└────────────────────────────────────────────────────────────┘
```

The agent `.md` frontmatter declares a `soul:` field. The
[`pi-soul-engine`](https://github.com/arendon1/pi-soul-engine) resolves
this at dispatch time, swapping in the named soul's identity and memory
for the duration of the subagent call.

### Soul-binding resolution order

When a subagent is dispatched, the engine picks a soul in this order:

1. **Frontmatter `soul:`** in the agent's `.md` (e.g. `soul: explorer`)
2. **`scripts/bindings.json`** lookup by agent type (e.g. `Plan → planner`)
3. **Default `$session`** — agent inherits the active session soul (e.g. Odin)

## The three agents

| Agent | Model | Tools | Soul | Read-only? | When to use |
|---|---|---|---|---|---|
| `Explore` | `openrouter/~deepseek/deepseek-flash-latest` | read, bash, grep, find, ls, grounding | `explorer` (Cartographer) | yes | Fast codebase search; "where is X", "what changed recently" |
| `Plan` | `openrouter/~z-ai/glm-flash-latest` | read, bash, grep, find, ls | `planner` (Architect) | yes | Design an implementation; "how should I do X" |
| `researcher` | inherits parent | read, bash, grep, find, ls, **web_search**, grounding | `researcher` | no (research needs to write notes) | Vendor-grounded research on time-sensitive topics |

The model choices are deliberate:

- **Explorer & Planner use cheap fast models** because their tasks are
  mostly navigation and synthesis. A 7B model handles it.
- **Researcher inherits the session's model** because research is the
  expensive one — web search is the bandwidth bottleneck, the model
  should not be.

## Install

On a new device, after `pi` is installed and the engine is set up:

```bash
git clone https://github.com/arendon1/pi-agents.git
cd pi-agents
bash install.sh --apply --with-souls --with-bindings
```

The `--with-souls` flag runs `scripts/create-souls.sh` to create the
explorer / planner / researcher / default soul instances. The
`--with-bindings` flag installs `scripts/bindings.json` to
`~/.pi/agent/souls/agent-soul-bindings.json` so the engine knows the
agent-type → soul-name mapping.

Without those flags, only the agent `.md` files and the grounding
extension are installed — useful if you're only iterating on the agent
prompts and don't want to re-create souls.

The script is idempotent: running it twice changes nothing the second
time. It is also dry-run by default; pass `--apply` to actually write.

### Dependencies

`install.sh` does **not** install dependencies. It assumes the
following are already present on the device:

| Dependency | Why | Where |
|---|---|---|
| `pi-coding-agent` | the host | `npm i -g @earendil-works/pi-coding-agent` |
| `pi-soul-engine` | the soul engine, must be running | [`arendon1/pi-soul-engine`](https://github.com/arendon1/pi-soul-engine) (clone, deploy via its own `install.sh --apply --with-npm`) |
| `pi-web-search` | the `web_search` tool used by `researcher` | [`arendon1/pi-web-search`](https://github.com/arendon1/pi-web-search) (clone, `npm i`, register in `settings.json#packages`) |
| `EXA_API_KEY` / `TAVILY_API_KEY` | the `web_search` backend keys | in `~/.pi/agent/.env` |

If you have all four, `bash install.sh --apply --with-souls --with-bindings`
is the only command you need on a new device.

## Uninstall

```bash
bash uninstall.sh --apply            # remove agent files, grounding, create-souls.sh
bash uninstall.sh --apply --purge-souls   # also remove the four subagent soul instances
```

The uninstall script is conservative by default: it does **not** touch
soul data directories unless you pass `--purge-souls`. Soul data is
precious; you almost never want to delete it.

## Adding a new agent

1. **Create the agent `.md`** in `agents/<name>.md`. Start from
   `agents/explore.md` as a template. Frontmatter fields:
   - `name:` — the agent type identifier (used in dispatch)
   - `display_name:` — shown in UI
   - `description:` — one-line purpose
   - `soul:` — name of the soul to bind (must exist or be added in step 2)
   - `model:` — model ID or `inherit` to use the session model
   - `tools:` — comma-separated list from the available tool set
   - `extensions: true` and `skills: true` — almost always want these
   - `prompt_mode: replace` — agents in this repo replace the default prompt

2. **Add a soul instance** if it doesn't exist yet. Edit
   `scripts/create-souls.sh` and append a `create_soul` call at the
   bottom. Then re-run `install.sh --with-souls` on the device.

3. **Add a binding** in `scripts/bindings.json` if you want the
   `name:` (or `display_name:`) to map to the soul even if the
   frontmatter is missing. Order: frontmatter > bindings.json > $session.

4. **Add the soul-binding marker** — at the very top of the prompt
   body (after the frontmatter), put a comment like
   `<!-- soul-binding: <name> -->`. The engine fingerprints this to
   identify the agent when no agent-type field is in the dispatch event.

5. **Commit and push.** Then on every target device, `git pull` and
   re-run `install.sh --apply`.

### Custom agent design rules

These are conventions observed by the three agents in this repo:

- **Read-only agents never have `write` or `edit` in `tools:`** and
  their prompt restates the read-only rule explicitly. The Explorer and
  Planner prompts do this in their `CRITICAL: READ-ONLY MODE` section.
- **Agents that need time/location context include `grounding` in
  `tools:`** and a "Temporal awareness" section telling the model when
  to call it.
- **Research agents need `web_search`** and a "search-first, not
  memory-first" rule, plus a "Source weighting" hierarchy (vendor
  first-party > canonical platform > independent editorial > aggregator
  > SEO blog).
- **Models are picked by role, not by preference** — cheap fast models
  for navigation, inherits for expensive reasoning.

## Customising without forking

You can override any of the agent files on a per-device basis **after**
`install.sh` runs. `install.sh` is idempotent: re-running it will
overwrite your local customisations with the repo's version. If you
want device-only changes that survive reinstalls, keep them in a
device-specific overlay that `install.sh` knows about — for now, the
simplest way is to not re-run `install.sh` after manual edits, or to
edit the files in this repo and re-run.

## License

MIT. See [LICENSE](LICENSE).

## Related repos

- [`arendon1/pi-soul-engine`](https://github.com/arendon1/pi-soul-engine) — the engine that runs the souls
- [`arendon1/pi-web-search`](https://github.com/arendon1/pi-web-search) — the `web_search` tool
- [`qbtrix/soul-protocol`](https://github.com/qbtrix/soul-protocol) — the Soul Protocol spec
