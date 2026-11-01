# Security policy

## Report a vulnerability

Security reports and fixes are welcome through
[issues](https://github.com/shemarlindie/subagent-extension-for-codex/issues) and
[pull requests](https://github.com/shemarlindie/subagent-extension-for-codex/pulls).
Include the extension version, the impact and steps to reproduce the problem.
Don't include your admin token or other credentials.

For sensitive details, use GitHub's
[private vulnerability reporting](https://github.com/shemarlindie/subagent-extension-for-codex/security/advisories/new)
when available. Keep those details out of public issues and pull requests.

## Scope

These are in scope:

- Reaching the service or its token from another user, another device, or a web
  page, when the service listens on loopback.
- Tasks gaining access to repositories or permissions the user didn't approve.
- Model calls raising their own approval authority or relaxing configured
  restrictions.

These are out of scope:

- What Claude Code does with the permissions you granted it. Worktrees aren't
  security sandboxes. See [Configuration](docs/configuration.md).
- Access by someone who already has your user account or your admin token.
- Services you exposed to the network with `--host`.
