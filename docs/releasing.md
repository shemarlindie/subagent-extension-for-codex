# Releasing and CI

Maintainers use this guide to publish versions and keep CI running.
[Build](development.md#build) covers the release package, and
[Install a local build](development.md#install-a-local-build) covers testing it
in Codex.

## Release a version

Users add `main`'s marketplace, `.agents/plugins/marketplace.json`, which
installs the plugin from npm at the exact version it lists. Codex refreshes it
on startup, so a version reaches users when `main` lists it. Each release has
its own branch:

1. On an up-to-date `main`, run `npm run release:prepare`. Pass a version to
   choose it yourself, which a prerelease needs:
   `npm run release:prepare -- 1.2.0-beta.1`.
2. When it asks to confirm, check the version and review the drafted notes in
   `CHANGELOG.md`, which become the GitHub release notes. Rewrite them for users
   where needed: what changed, and anything they must do by hand. Then confirm,
   and keep the pull request it opens a draft. Pass `--yes` to skip the
   confirmation, then review the notes on the branch.
3. Run the **Release** workflow on the branch in GitHub Actions. It publishes
   the version and merges the pull request with a merge commit, which keeps the
   tagged commit in `main`'s history. Don't merge release pull requests by hand.

`release:prepare` picks the next version from the conventional commits since the
last release: major for a breaking change, minor for a `feat` and patch
otherwise. Before 1.0, a breaking change bumps the minor version. It sets the
version in `package.json`, `package-lock.json`, `plugin.json` and the
marketplace. Unless `CHANGELOG.md` already has a `## <version>` section, it
drafts one with Features and Fixes sections from the `feat` and `fix` commits,
writing `None` in an empty section. After you confirm, it creates
`chore/release-v<version>`, commits, pushes and opens a draft pull request to
`main` that links to the notes. If you decline, it restores the version files
and keeps `CHANGELOG.md`, so the next run uses your notes. It needs the `gh`
CLI, signed in.

When `main` already lists an unreleased version, as with the first release, run
the **Release** workflow on `main`, with no branch or pull request.

The merge must follow the publish. If `main` lists an unpublished version,
Codex's refresh fails and keeps the installed version, and it doesn't retry once
the version is published, so users stay behind until `main`'s marketplace
changes again. The workflow merges only after the publish and installs pass, and
the **Listed version published** check guards against other merges. When a pull
request raises the listed version, the check fails until `v<version>` points at
the pull request's head commit. When it lowers the version, as a rollback does,
the tag only has to exist. The workflow re-runs the check before merging.

A version with a prerelease suffix, such as `1.2.0-beta.1`, makes a prerelease.
It follows the same steps and publishes under the npm `next` tag. The workflow
doesn't merge its pull request, so close it without merging. Testers add the
marketplace at its tag, and a later release replaces its running service through
[updates and service handoff](task-continuation.md#updates-and-service-handoff).

To roll back, open a pull request that sets only the marketplace `version` to an
earlier release. That version is already on npm, so it can merge at once.

The workflow stops before publishing when the branch has no open pull request
into `main`, the pull request's head isn't the commit the run is for, the pull
request conflicts with `main` or one of its required checks failed.

If the workflow fails before its npm publish step, fix the problem on the branch
and run it again. After that step, the version is spent, because npm versions
can't be republished. If only the GitHub release and its tag are missing, create
the release by hand on the branch's head, which also creates the tag. Otherwise,
close the pull request without merging and release the next version.

If the merge job fails after publishing, `main` keeps listing the previous
version, so users stay on it. Re-run the job, which covers a flaky check or a
slow re-run. If a new conflict with `main` blocks the merge, merge `main` into
the branch, then merge the pull request yourself with a merge commit. Its head
has moved past the tag, so **Listed version published** now fails. Disable the
**Listed version published** ruleset for the merge and enable it again right
after. The tagged commit stays in `main`'s history through the merge.

Any other push to the branch after publishing also moves its head past the tag,
and the merge job refuses to merge it. Drop the push and re-run the job, or
release a new version.

The workflow (`.github/workflows/release.yml`):

1. Runs the CI checks and installs the packed release with Codex. Checks the
   release pull request and waits for its required checks. It fails if the
   marketplace and `package.json` versions differ or the tag exists.
2. Publishes `release/` to npm with provenance, under `next` for a prerelease.
3. Tags the published commit, the branch's head, as `v<version>` and creates its
   GitHub release with an attested zip, marked as a prerelease when the version
   has a suffix.
4. Installs `<owner>/<repo>@v<version>` with Codex on Linux, macOS and Windows,
   once npm serves the version.
5. For a final release, re-runs the pull request's **Listed version published**
   check, marks the pull request ready, merges it with a merge commit, deletes
   the release branch and starts CI on `main`. GitHub doesn't start CI for
   merges made by the workflow.

The workflows pin the Codex CLI to the minimum version the README lists, so
change them together.

## npm publishing

The publish job uses npm trusted publishing, configured on npmjs.com for
workflow `release.yml` with direct `npm publish` allowed. If a prerelease fails
to set the `next` tag, also allow `npm dist-tag`. The job installs npm 11.21.0,
because Node 24's bundled npm can't set dist-tags through OIDC. The publish step
also passes the `NPM_TOKEN` secret, which isn't configured, so it has no effect.

## Repository settings

The workflow relies on these settings:

- **Enable release immutability** under **Settings → General → Releases** locks
  each published release's tag and assets.
- A tag ruleset for `v*` has **Restrict updates** and **Restrict deletions** and
  an empty bypass list. It covers tags without a published release. Creations
  stay unrestricted, because GitHub Actions can't be a bypass actor and the
  workflow creates the tags.
- A branch ruleset on `main` requires the **Listed version published** check
  with no bypass actors, so a release pull request can't merge before its
  publish. It must allow merge commits, which the Release workflow uses.

## CI

`.github/workflows/ci.yml` runs the checks on Linux and macOS for pushes to
`main` and pull requests. Windows runs the build, package tests and focused
settings file and project file read tests. Other parts of the suite use POSIX
shell fakes. All jobs run on GitHub-hosted runners, and release runs reuse these
checks. The self-hosted runner scripts in `dev/ci-runner` and the `MACOS_RUNNER`
routing in `ci.yml` are unused.
