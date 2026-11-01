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
2. Follow [Setup](docs/development.md#setup) and make your change on a
   [named branch](#commits-pull-requests-and-branches).
3. Follow [Choosing test coverage](docs/development.md#choosing-test-coverage)
   when adding or changing tests.
4. Run the relevant [checks](docs/development.md#checks), including browser
   checks when needed.
5. Update the documentation the change affects.
6. Open a pull request and fill in its template.

[Agent instructions](AGENTS.md) hold the project's code, test and writing
conventions.

## Commits, pull requests and branches

Commit subjects and pull request titles follow
[Conventional Commits](https://www.conventionalcommits.org/):

```text
type(scope): description
```

- **Type** is one of `feat`, `fix`, `perf`, `refactor`, `test`, `docs`,
  `build`, `ci` or `chore`.
- **Scope** is optional and names the affected area in one word, such as
  `panel`, `settings`, `tasks`, `claude`, `mcp` or `dev`. Leave it out when a
  change spans several areas.
- **Description** is lowercase and imperative, with no trailing period. Keep the
  whole subject within about 72 characters.
- Mark a breaking change with `!` after the type or scope, such as
  `feat(settings)!: rename the task budget keys`, and describe it in the body.

For example, `fix(panel): restore new task view after reload`. Explain the
reason in the body when it isn't obvious.

A squash merge can use the pull request title as the commit subject, so give
the title the same form.

Name branches `type/short-description` in kebab case with the same types, such
as `feat/undo-redo` or `fix/composer-reload-text`. Add the issue number when
there is one, such as `fix/123-composer-reload-text`.

## Claude model calls

`npm test` makes no model calls. The opt-in scenarios in
[Claude execution verification](docs/claude-verification.md) run real Claude
tasks and can incur costs, so run them only when your change needs them.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
