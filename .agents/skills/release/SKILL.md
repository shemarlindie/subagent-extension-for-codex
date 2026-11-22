---
name: release
description: Prepare, publish and monitor a release of the extension. Use when asked to prepare or cut a release, write release notes, or run and watch the Release workflow.
---

# Release

Follow [Release a version](../../../docs/releasing.md#release-a-version). This
skill covers what an agent adds to it. If the release pull request is already
open, go to step 4 and use its branch.

## 1. Draft the notes

Run `echo n | npm run release:prepare`, adding `-- <version>` when the user
chose one. It drafts the notes, then exits with "Cancelled" and keeps them.
Check every commit since the last release and add user-visible changes the
draft misses.

## 2. Clean up the notes

Match the style of recent sections in `CHANGELOG.md`:

- Group entries under headings for the areas users see. Keep **Breaking
  changes** first and **Fixes** last.
- Give a feature and its follow-ups one entry that lists every pull request,
  such as `(#164, #166)`.
- Leave out changes users can't see, such as dev tooling, CI and tests.

Check each entry against its pull request.

## 3. Preview with the user

Show the user the section and what you merged or left out. Apply their edits
and wait for approval. Stop here if the user only asked for notes. Otherwise run
`npm run release:prepare -- --yes`, with the same version if the user chose one.

## 4. Publish and monitor

Ask the user whether to start the **Release** workflow, and start it only when
they agree. Watch the run in the background, handle failures as the guide
describes, and report when it finishes or needs input. After the merge and
`main` CI pass, switch the local checkout to `main` and pull.
