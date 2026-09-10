#!/usr/bin/env bash
# Copies the staged UI changes into frontend/src, then type-checks.
# Read pending-ui/APPLY.md first: this triggers Vite HMR, which can abort a
# running generation and make the backend delete its finished chunks.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
staged="$root/pending-ui/src"
target="$root/frontend/src"

files=(
  "App.tsx"
  "lib/bookStore.ts"
  "lib/autoDownload.ts"
  "hooks/useSSEProgress.ts"
  "hooks/useAudioGeneration.ts"
  "components/ControlsPanel.tsx"
)

if [ ! -d "$staged" ]; then
  echo "no staged changes at $staged" >&2
  exit 1
fi

echo "Backing up the files being replaced to pending-ui/backup/ ..."
for f in "${files[@]}"; do
  if [ -f "$target/$f" ]; then
    mkdir -p "$root/pending-ui/backup/$(dirname "$f")"
    cp "$target/$f" "$root/pending-ui/backup/$f"
  fi
done

for f in "${files[@]}"; do
  mkdir -p "$target/$(dirname "$f")"
  cp "$staged/$f" "$target/$f"
  echo "  applied $f"
done

echo
echo "Type-checking..."
cd "$root" && npm run lint

echo
echo "Done. Reload the app in the browser."
echo "To undo: cp -r pending-ui/backup/* frontend/src/"
