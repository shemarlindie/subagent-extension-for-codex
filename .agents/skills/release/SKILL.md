---
name: release
description: Prepare, publish and monitor a release of the extension. Use when asked to prepare or cut a release, write release notes, or run and watch the Release workflow.
---

# Release

Follow [Release a version](../../../docs/releasing.md#release-a-version). This
skill covers what an agent adds to it. Start and stop at the steps the user's
request covers.

## 1. Draft the notes

Run `echo n | npm run release:prepare`, adding `-- <version>` when the user
chose one. It drafts the notes, then exits with "Cancelled" and keeps them.

## 2. Clean up the notes

Check every commit since the last release against its pull request. Then
rewrite the section to match recent ones in `CHANGELOG.md`:

- Group entries under headings for the areas users see. Keep **Breaking
  changes** first and **Fixes** last.
- Give a feature and its follow-ups one entry that lists every pull request,
  such as `(#164, #166)`.
- Add user-visible changes the draft misses. Leave out changes users can't see,
  such as dev tooling, CI and tests.

## 3. Preview with the user

Show the user the section and what you added, merged or left out. Apply their
edits and wait for approval.

## 4. Open the pull request

Run `npm run release:prepare -- --yes`, with the same version if the user chose
one. When the release pull request is already open and its version isn't
published, commit and push the notes to its branch instead.

## 5. Publish and monitor

Ask the user whether to start the **Release** workflow, and start it only when
they agree. Watch the run in the background, handle failures as the guide
describes, and report when it finishes or needs input. After the merge and
`main` CI pass, switch the local checkout to `main`, pull and delete the local
release branch.
