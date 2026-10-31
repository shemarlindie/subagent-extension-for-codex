# Settings shared by the CI runner scripts.
REPO=shemarlindie/codex-subagent-extension
IMAGE=ghcr.io/cirruslabs/macos-tahoe-base:latest
# ci.yml routes the macOS checks to this label through the MACOS_RUNNER variable.
LABEL=self-hosted-macos
VM=ci-runner
CPUS=6
MEMORY_MB=8192
STATE_DIR="$HOME/Library/Application Support/ci-runner"
