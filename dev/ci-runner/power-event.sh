#!/bin/zsh
# sleepwatcher calls this with "sleep" or "wake". Sleep routes the macOS CI
# checks back to GitHub-hosted runners, and wake routes them here again while
# run.sh is running.
set -uo pipefail

source "${0:A:h}/config.sh"

runner_running() {
  local pid
  pid=$(cat "$STATE_DIR/pid" 2>/dev/null) && kill -0 "$pid" 2>/dev/null
}

case ${1:-} in
  sleep) gh variable delete MACOS_RUNNER --repo "$REPO" 2>/dev/null || true ;;
  wake)
    # The network can take a moment to return after wake.
    for attempt in {1..10}; do
      runner_running || exit 0
      gh variable set MACOS_RUNNER --repo "$REPO" --body "$LABEL" && exit 0
      sleep 3
    done
    ;;
  *) print -u2 "usage: $0 sleep|wake"; exit 64 ;;
esac
