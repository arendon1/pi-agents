#!/usr/bin/env bash
#
# uninstall.sh — remove what install.sh put there.
#
# Conservative by default: only deletes the files that install.sh manages.
# Will not touch the soul data directories in ~/.pi/agent/souls/ — those
# hold memory and are precious. Pass --purge-souls to remove the four
# subagent soul instances created by create-souls.sh.
#
# Usage:
#   bash uninstall.sh                     # dry run (default)
#   bash uninstall.sh --apply             # actually delete
#   bash uninstall.sh --purge-souls       # also remove explorer/planner/researcher/default .soul dirs
#   bash uninstall.sh --target DIR        # target a different pi-agent dir
#   bash uninstall.sh --keep-bindings     # do not remove agent-soul-bindings.json

set -euo pipefail

APPLY=0
PURGE_SOULS=0
KEEP_BINDINGS=0
TARGET=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--apply) APPLY=1; shift ;;
		--dry-run) APPLY=0; shift ;;
		--purge-souls) PURGE_SOULS=1; shift ;;
		--keep-bindings) KEEP_BINDINGS=1; shift ;;
		--target)
			[[ $# -ge 2 ]] || { echo "--target needs a directory" >&2; exit 2; }
			TARGET="$2"; shift 2 ;;
		-h|--help) sed -n '2,12p' "$0"; exit 0 ;;
		*) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
	esac
done

TARGET="${TARGET:-$HOME/.pi/agent}"

declare -a TO_REMOVE=(
	"$TARGET/agents/explore.md"
	"$TARGET/agents/plan.md"
	"$TARGET/agents/researcher.md"
	"$TARGET/extensions/grounding.ts"
	"$HOME/create-souls.sh"
)

if [[ "$KEEP_BINDINGS" != "1" ]]; then
	TO_REMOVE+=("$TARGET/souls/agent-soul-bindings.json")
fi

if [[ "$PURGE_SOULS" == "1" ]]; then
	TO_REMOVE+=(
		"$TARGET/souls/explorer.soul"
		"$TARGET/souls/planner.soul"
		"$TARGET/souls/researcher.soul"
	)
fi

echo "==> uninstalling pi-agents from $TARGET"
echo "    mode:   $([[ "$APPLY" == "1" ]] && echo APPLY || echo 'DRY RUN (pass --apply to delete)')"
echo "    extras: purge-souls=$PURGE_SOULS keep-bindings=$KEEP_BINDINGS"
echo

declare -a CHANGES=()
for f in "${TO_REMOVE[@]}"; do
	if [[ -e "$f" ]]; then
		CHANGES+=("DEL   $f")
	else
		CHANGES+=("absent $f")
	fi
done

printf '%s\n' "${CHANGES[@]}"

del_count=$(printf '%s\n' "${CHANGES[@]}" | grep -c '^DEL' || true)
echo
echo "==> summary: would delete $del_count files/dirs"

if [[ "$APPLY" != "1" ]]; then
	echo "==> dry run complete; nothing was deleted (pass --apply to remove)"
	exit 0
fi

for f in "${TO_REMOVE[@]}"; do
	if [[ -e "$f" ]]; then
		rm -rf "$f"
	fi
done

echo "==> removed $del_count files/dirs"
