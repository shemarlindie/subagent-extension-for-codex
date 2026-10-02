#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Match the data directory configured for the local Codex MCP test setup.
export CODEX_SUBAGENT_EXTENSION_DATA="${CODEX_SUBAGENT_EXTENSION_DATA:-$PWD/.codex-subagent-extension/live}"

npm run build

# With no arguments, approve both repositories used by the manual test checklist.
# Explicit arguments replace these defaults; existing environment overrides persist.
if [[ $# -eq 0 ]]; then
  set -- "$PWD" "$PWD/../ig-image-splitter"
fi
for repository in "$@"; do
  node dist/projects-cli.js register "$repository"
done

npm start
