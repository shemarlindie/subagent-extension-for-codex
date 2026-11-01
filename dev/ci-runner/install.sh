#!/bin/zsh
# Installs or removes the launchd agents that keep run.sh going and report
# sleep and wake. Usage: install.sh [--uninstall]
set -euo pipefail

SOURCE=${0:A:h}
source "$SOURCE/config.sh"
# The agents run copies, so switching branches in this checkout can't break them.
DIR="$STATE_DIR/bin"
AGENTS=$HOME/Library/LaunchAgents
LOGS=$HOME/Library/Logs/ci-runner
RUNNER=dev.subagent-extension-for-codex.ci-runner
WATCHER=dev.subagent-extension-for-codex.ci-runner-power
SLEEPWATCHER=$(brew --prefix)/opt/sleepwatcher/sbin/sleepwatcher
PATH_VALUE="$(brew --prefix)/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# bootout can return while the agent is still cleaning up, and loading it again
# before it is gone fails. ExitTimeOut bounds the wait.
stop_agent() {
  launchctl bootout "gui/$UID/$1" 2>/dev/null || true
  local attempt
  for attempt in {1..70}; do
    launchctl print "gui/$UID/$1" >/dev/null 2>&1 || return 0
    sleep 1
  done
  print -u2 "$1 did not stop"
  return 1
}

unload() {
  stop_agent $1
  rm -f "$AGENTS/$1.plist"
}

if [[ ${1:-} == --uninstall ]]; then
  unload $WATCHER
  unload $RUNNER
  rm -rf "$DIR"
  print "Removed the CI runner agents"
  exit 0
fi

for tool in tart gh jq "$SLEEPWATCHER"; do
  command -v "$tool" >/dev/null || { print -u2 "Missing $tool"; exit 1 }
done

mkdir -p "$AGENTS" "$LOGS" "$DIR"
cp "$SOURCE/config.sh" "$SOURCE/run.sh" "$SOURCE/power-event.sh" "$DIR/"

# Plist values are fixed here, so plain string interpolation is safe.
write_agent() {
  local label=$1 log=$2; shift 2
  local args=""
  for arg in "$@"; do args+="<string>$arg</string>"; done
  cat > "$AGENTS/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>$args</array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH_VALUE</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ExitTimeOut</key><integer>60</integer>
  <key>StandardOutPath</key><string>$LOGS/$log.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$log.log</string>
</dict>
</plist>
EOF
  stop_agent $label
  launchctl bootstrap "gui/$UID" "$AGENTS/$label.plist"
}

write_agent $RUNNER runner "$DIR/run.sh"
write_agent $WATCHER power "$SLEEPWATCHER" -V \
  -s "'$DIR/power-event.sh' sleep" -w "'$DIR/power-event.sh' wake"

print "Installed the CI runner agents. Logs are in $LOGS"
