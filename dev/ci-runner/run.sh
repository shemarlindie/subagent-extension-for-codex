#!/bin/zsh
# Runs GitHub Actions jobs for this repository in throwaway Tart VMs, one job
# per VM. While it runs, the MACOS_RUNNER repository variable routes the macOS
# CI checks here. See docs/releasing.md#ci-runner.
set -euo pipefail

source "${0:A:h}/config.sh"

runner_id=""
job_pid=""
cleaned_up=""

log() { print -r -- "$(date '+%F %T') $*" }

route_here() { gh variable set MACOS_RUNNER --repo "$REPO" --body "$LABEL" }
route_hosted() { gh variable delete MACOS_RUNNER --repo "$REPO" 2>/dev/null || true }

discard_vm() {
  tart stop --timeout 5 "$VM" >/dev/null 2>&1 || true
  tart delete "$VM" >/dev/null 2>&1 || true
}

# An unused just-in-time runner stays registered until GitHub expires it, so
# remove it when the job never started.
unregister_runner() {
  [[ -n $runner_id ]] || return 0
  gh api -X DELETE "repos/$REPO/actions/runners/$runner_id" >/dev/null 2>&1 || true
  runner_id=""
}

cleanup() {
  [[ -n $cleaned_up ]] && return
  cleaned_up=1
  log "Stopping"
  route_hosted
  rm -f "$STATE_DIR/pid"
  [[ -n $job_pid ]] && kill $job_pid 2>/dev/null
  unregister_runner
  discard_vm
}

# Callers test the result, which turns off errexit here, so each step returns
# its own failure.
run_one_job() {
  local response jit_config
  response=$(gh api -X POST "repos/$REPO/actions/runners/generate-jitconfig" \
    -f name="$VM-$(date +%s)" -F runner_group_id=1 \
    -f "labels[]=$LABEL" -f work_folder=_work) || return 1
  runner_id=$(print -r -- "$response" | jq -r .runner.id) || return 1
  jit_config=$(print -r -- "$response" | jq -r .encoded_jit_config) || return 1

  discard_vm
  tart clone "$IMAGE" "$VM" || return 1
  tart set "$VM" --cpu "$CPUS" --memory "$MEMORY_MB" || return 1
  tart run --no-graphics "$VM" &
  local vm_pid=$!

  local attempt
  for attempt in {1..60}; do
    tart exec "$VM" true >/dev/null 2>&1 && break
    (( attempt == 60 )) && { log "VM did not start"; kill $vm_pid 2>/dev/null; return 1 }
    sleep 2
  done

  log "Runner $runner_id waiting for a job"
  # A login shell loads the image's Homebrew and Node paths. The config goes
  # through stdin to keep the runner credential out of host process listings.
  # Waiting on a background job lets a stop signal run cleanup right away.
  print -r -- "$jit_config" | tart exec -i "$VM" zsh -lc \
    'read -r config && cd ~/actions-runner && ./run.sh --jitconfig "$config"' &
  job_pid=$!
  local started=$SECONDS
  wait $job_pid || true
  job_pid=""

  discard_vm
  wait $vm_pid 2>/dev/null || true

  # A working runner waits for a job and then runs it, which takes minutes. A
  # quick exit means it failed to start, so the caller backs off.
  if (( SECONDS - started < 60 )); then
    log "Runner exited after $(( SECONDS - started ))s"
    return 1
  fi
  runner_id=""
  log "Job finished"
}

mkdir -p "$STATE_DIR"
print -r -- $$ > "$STATE_DIR/pid"
trap cleanup EXIT
# zsh skips the EXIT trap when a signal trap exits inside a function, so the
# signal trap cleans up itself.
trap 'cleanup; exit 0' INT TERM

if ! tart list --quiet | grep -qx "$IMAGE"; then
  log "Pulling $IMAGE"
  tart pull "$IMAGE"
fi

route_here
log "Routing macOS checks to $LABEL"

while true; do
  if ! run_one_job; then
    unregister_runner
    # A background sleep lets a stop signal interrupt the wait.
    sleep 30 & wait $!
  fi
done
