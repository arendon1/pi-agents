#!/usr/bin/env bash
#
# install.sh — install pi-agents harness files onto a pi instance.
#
# This is the entry point on a new device. It is the inverse of
# "I forgot what files I need to copy" — run it and the three custom
# agents, the grounding tool, the soul-binding config, and the
# create-souls.sh script are all in the right places.
#
# Usage:
#   bash install.sh                      # dry run (default — prints, writes nothing)
#   bash install.sh --apply              # perform the install
#   bash install.sh --with-souls         # also run scripts/create-souls.sh to create the soul instances
#   bash install.sh --with-bindings      # also install scripts/bindings.json to the souls dir
#   bash install.sh --target DIR         # install to DIR instead of $HOME/.pi/agent
#   bash install.sh --source DIR         # read from DIR instead of the repo root
#
# Properties:
#   * idempotent — running twice changes nothing the second time
#   * dry-run by default — pass --apply to make changes
#   * only managed files are touched; everything else is left alone
#   * each step prints OK / DIFF / NEW / FAIL

set -euo pipefail

APPLY=0
WITH_SOULS=0
WITH_BINDINGS=0
SOURCE=""
TARGET=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--apply) APPLY=1; shift ;;
		--dry-run) APPLY=0; shift ;;
		--with-souls) WITH_SOULS=1; shift ;;
		--with-bindings) WITH_BINDINGS=1; shift ;;
		--source)
			[[ $# -ge 2 ]] || { echo "--source needs a directory" >&2; exit 2; }
			SOURCE="$2"; shift 2 ;;
		--target)
			[[ $# -ge 2 ]] || { echo "--target needs a directory" >&2; exit 2; }
			TARGET="$2"; shift 2 ;;
		-h|--help) sed -n '2,18p' "$0"; exit 0 ;;
		*) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
	esac
done

# Source = repo root (parent of this script). Target = ~/.pi/agent.
SOURCE="${SOURCE:-$(cd "$(dirname "$0")" && pwd)}"
TARGET="${TARGET:-$HOME/.pi/agent}"

# Sanity: source must look like a pi-agents checkout.
for marker in agents extensions scripts; do
	[[ -d "$SOURCE/$marker" ]] || { echo "error: $SOURCE is missing $marker/ (not a pi-agents source?)" >&2; exit 1; }
done

# Managed file map: "source_path -> target_path" pairs.
# Order matters only for human readability; the install is order-independent.
declare -A FILES=(
	["$SOURCE/agents/explore.md"]="$TARGET/agents/explore.md"
	["$SOURCE/agents/plan.md"]="$TARGET/agents/plan.md"
	["$SOURCE/agents/researcher.md"]="$TARGET/agents/researcher.md"
	["$SOURCE/extensions/grounding.ts"]="$TARGET/extensions/grounding.ts"
)

if [[ "$WITH_SOULS" == "1" ]]; then
	FILES["$SOURCE/scripts/create-souls.sh"]="$HOME/create-souls.sh"
fi

if [[ "$WITH_BINDINGS" == "1" ]]; then
	FILES["$SOURCE/scripts/bindings.json"]="$TARGET/souls/agent-soul-bindings.json"
fi

echo "==> installing pi-agents"
echo "    source:  $SOURCE"
echo "    target:  $TARGET"
echo "    mode:    $([[ "$APPLY" == "1" ]] && echo APPLY || echo 'DRY RUN (pass --apply to write)')"
echo "    extras:  souls=$WITH_SOULS bindings=$WITH_BINDINGS"
echo

# Compute the diff table first so the dry-run output is the same as the
# apply output, and so we can show the user what would change.
declare -a CHANGES=()
for src in "${!FILES[@]}"; do
	dst="${FILES[$src]}"
	if [[ ! -f "$src" ]]; then
		CHANGES+=("FAIL  $src  (source missing)")
		continue
	fi
	if [[ ! -f "$dst" ]]; then
		CHANGES+=("NEW   $dst")
	elif diff -q "$src" "$dst" > /dev/null 2>&1; then
		CHANGES+=("OK    $dst  (no change)")
	else
		CHANGES+=("DIFF  $dst")
	fi
done

# Print changes.
printf '%s\n' "${CHANGES[@]}" | sort

# Counters.
new_count=$(printf '%s\n' "${CHANGES[@]}" | grep -c '^NEW' || true)
diff_count=$(printf '%s\n' "${CHANGES[@]}" | grep -c '^DIFF' || true)
fail_count=$(printf '%s\n' "${CHANGES[@]}" | grep -c '^FAIL' || true)

echo
echo "==> summary: new=$new_count diff=$diff_count fail=$fail_count"

if [[ "$fail_count" != "0" ]]; then
	echo "error: source files are missing; aborting" >&2
	exit 1
fi

if [[ "$APPLY" != "1" ]]; then
	echo "==> dry run complete; nothing was written (pass --apply to install)"
	exit 0
fi

# Apply.
for src in "${!FILES[@]}"; do
	dst="${FILES[$src]}"
	if [[ -f "$dst" ]] && diff -q "$src" "$dst" > /dev/null 2>&1; then
		continue  # OK, no change needed
	fi
	mkdir -p "$(dirname "$dst")"
	cp "$src" "$dst"
done

# Permissions: create-souls.sh must be executable.
[[ "$WITH_SOULS" == "1" ]] && chmod +x "$HOME/create-souls.sh"

# If --with-souls, run create-souls.sh to instantiate the four soul dirs.
if [[ "$WITH_SOULS" == "1" ]]; then
	echo
	echo "==> running create-souls.sh"
	bash "$HOME/create-souls.sh"
fi

echo
echo "==> installed $(printf '%s\n' "${FILES[@]}" | sort -u | wc -l) files"
echo "==> next: start a pi session; the agents and grounding tool should be live"
