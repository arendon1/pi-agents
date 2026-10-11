# Changelog

All notable changes to this repo. Dates are UTC.

## v0.1.0 — 2026-10-11

Initial public release.

### Added

- Three custom subagent definitions under `agents/`:
  - `explore.md` — fast read-only search (deepseek-flash, soul: explorer)
  - `plan.md` — software architect (glm-flash, soul: planner)
  - `researcher.md` — web-search-grounded research (inherits parent model, soul: researcher)
- `extensions/grounding.ts` — time / location / network-trust tool used by explorer and researcher
- `scripts/create-souls.sh` — creates the four subagent soul instances (explorer, planner, researcher, default). Now portable: respects `$SOULS_DIR` env var, defaults to `$HOME/.pi/agent/souls`
- `scripts/bindings.json` — agent-type → soul-name mapping
- `install.sh` — idempotent one-command install with `--apply`, `--with-souls`, `--with-bindings`, `--source`, `--target` flags. Dry-run by default
- `uninstall.sh` — conservative reverse; refuses to delete soul data without `--purge-souls`
- `README.md` — architecture, install, custom-agent design rules
- `LICENSE` — MIT

### Known limitations

- The `<!-- soul-binding: <name> -->` comment marker convention is
  honoured by the current `pi-soul-engine` but is not yet a stable
  contract; if the engine's fingerprinting strategy changes, the marker
  becomes purely informational.
- `create-souls.sh` always creates the *same* four souls. If a future
  custom agent needs a fifth soul, the script needs a new `create_soul`
  call — there's no dynamic registration yet.
