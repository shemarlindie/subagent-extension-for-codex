# Settings shared by the CI runner scripts.
REPO=shemarlindie/codex-subagent-extension
IMAGE=ghcr.io/cirruslabs/macos-tahoe-base:latest
# ci.yml routes the macOS checks to this label through the MACOS_RUNNER variable.
LABEL=self-hosted-macos
VM=ci-runner
# The checks peak near 4.5 GB in the guest and swap at 5 GB, so 6 GB leaves
# headroom while 3 CPUs keeps the host usable during a run.
CPUS=3
MEMORY_MB=6144
STATE_DIR="$HOME/Library/Application Support/ci-runner"
