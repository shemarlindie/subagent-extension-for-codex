# Contributing

## Report a problem

Open an issue with the bug report template. Include the versions it asks for and
relevant logs. [Diagnose a problem](docs/logging.md#diagnose-a-problem) explains
which logs to check. Remove anything private first, and never paste the
`admin-token` file or its contents.

For security reports and fixes, see the [security policy](SECURITY.md).

## Propose a change

Open an issue before starting a large change, so we can agree on the approach
first. Small fixes and documentation corrections can go straight to a pull
request.

1. Read the guides in the [documentation reading order](README.md#documentation).
2. Follow [Setup](docs/development.md#setup) and make your change on a branch.
3. Follow [Choosing test coverage](docs/development.md#choosing-test-coverage)
   when adding or changing tests.
4. Run the relevant [checks](docs/development.md#checks), including browser
   checks when needed.
5. Update the documentation the change affects.
6. Open a pull request that says what changed and why, and how you checked it.

[Agent instructions](AGENTS.md) hold the project's code, test and writing
conventions.

## Commits

Use a short imperative commit subject, such as `Show the port in the startup
error`. Explain the reason in the body when it isn't obvious.

## Claude model calls

`npm test` makes no model calls. The opt-in scenarios in
[Claude execution verification](docs/claude-verification.md) run real Claude
tasks and can incur costs, so run them only when your change needs them.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
