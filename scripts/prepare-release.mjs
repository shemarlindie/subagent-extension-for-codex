// Opens the release pull request from an up-to-date main:
//   npm run release:prepare [-- [--yes] [<version>]]
// Without a version, it picks the next one from the conventional commits since
// the last release. Without a CHANGELOG.md section for the version, it drafts
// one from the feat and fix commits. It makes the changes locally and asks to
// confirm before committing and pushing, so the notes can be edited first.
// --yes skips the confirmation. The pull request starts as a draft and stays
// one until the Release workflow publishes and merges it. See
// docs/releasing.md.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8" }).trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (run("git", ["branch", "--show-current"]) !== "main") {
  fail("Run this on main");
}

run("git", ["fetch", "--quiet", "--tags", "origin", "main"]);

if (
  run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])
) {
  fail("main must match origin/main");
}

const changed = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .map((line) => line.slice(3));

const manifest = JSON.parse(readFileSync("package.json", "utf8"));

// The last release is the newest final tag. Prerelease tags don't count, since
// their pull requests close without merging. main must contain the tag, or list
// its version when a squashed release pull request left the tag off main.
const since = run("git", ["tag", "--list", "v*", "--sort=-v:refname"])
  .split("\n")
  .find((tag) => tag && !tag.includes("-"));

const onMain =
  since && run("git", ["tag", "--merged", "HEAD", "--list", since]) === since;

// Reports what it found, and a fix only for a cause it confirms.
if (since && !onMain && since !== `v${manifest.version}`) {
  const detected = `${since} is the newest release tag, but main doesn't contain it and lists ${manifest.version}.`;

  if (!run("git", ["ls-remote", "--tags", "origin", `refs/tags/${since}`])) {
    fail(
      `${detected}\nThe tag is only local. Delete it with: git tag -d ${since}`,
    );
  }

  const open = run("gh", [
    "pr",
    "list",
    "--base",
    "main",
    "--head",
    `chore/release-${since}`,
    "--json",
    "number",
    "--jq",
    ".[0].number",
  ]);

  if (open) {
    fail(
      `${detected}\nIts release pull request #${open} is still open. Finish its release as docs/releasing.md describes, then run this again.`,
    );
  }

  fail(
    `${detected}\nCheck whether its release pull request was squashed and main was then rolled back, or whether it was released from another branch.`,
  );
}

if (since && !onMain) {
  console.warn(
    `main lists ${manifest.version}, but ${since} isn't in main's history. Counting from ${since}.`,
  );
}

const messages = run("git", [
  "log",
  "--format=%B%x00",
  since ? `${since}..HEAD` : "HEAD",
])
  .split("\0")
  .map((message) => message.trim())
  .filter(Boolean);

const subjects = messages.map((message) => message.split("\n")[0]);

/** The next version after the last release, by semver from the commit types. */
function nextVersion() {
  if (!since) fail("There's no release tag yet, so pass a version");

  const [major, minor, patch] = since.slice(1).split(".").map(Number);

  const breaking = messages.some(
    (message) =>
      /^\w+(\(.+?\))?!:/.test(message) || /^BREAKING CHANGE:/m.test(message),
  );

  // Before 1.0, a breaking change bumps the minor version.
  if (breaking && major > 0) return `${major + 1}.0.0`;

  if (
    breaking ||
    subjects.some((subject) => /^feat(\(.+?\))?:/.test(subject))
  ) {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const [requested, ...extra] = args.filter((arg) => arg !== "--yes");
const version = requested ?? nextVersion();

if (extra.length || !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
  fail("Usage: npm run release:prepare [-- [--yes] [<version>]]");
}

if (version === manifest.version) {
  fail(`package.json is already at ${version}`);
}

if (run("git", ["tag", "--list", `v${version}`])) {
  fail(`v${version} is already released`);
}

/** The changelog with a draft section for the version, from conventional commits. */
function withDraft(changelog) {
  const groups = Object.entries({ feat: "Features", fix: "Fixes" }).map(
    ([type, heading]) => {
      const items = subjects.flatMap((subject) => {
        const [, description] =
          subject.match(new RegExp(`^${type}(?:\\(.+?\\))?!?: (.+)$`)) ?? [];

        return description
          ? [`- ${description[0].toUpperCase()}${description.slice(1)}`]
          : [];
      });

      return [`### ${heading}`, "", ...(items.length ? items : ["None"])].join(
        "\n",
      );
    },
  );

  const section = `## ${version}\n\n${groups.join("\n\n")}\n`;
  const next = changelog.indexOf("\n## ");

  return next === -1
    ? `${changelog.trimEnd()}\n\n${section}`
    : `${changelog.slice(0, next + 1)}${section}\n${changelog.slice(next + 1)}`;
}

const changelog = readFileSync("CHANGELOG.md", "utf8");
const written = changelog.split("\n").includes(`## ${version}`);

// Notes written by hand may be uncommitted. Nothing else may be.
if (changed.join() !== (written ? "CHANGELOG.md" : "")) {
  fail(
    "Commit or discard your changes, except the version's CHANGELOG.md notes",
  );
}

/** Replaces a JSON file's one version value in place, keeping its formatting. */
function setVersion(path, current) {
  const text = readFileSync(path, "utf8");
  const field = (value) => `"version": "${value}"`;

  if (text.split(field(current)).length !== 2) {
    fail(`${path} must hold version ${current} exactly once`);
  }

  writeFileSync(path, text.replace(field(current), field(version)));
}

const marketplace = ".agents/plugins/marketplace.json";
const plugin = JSON.parse(readFileSync("plugin.json", "utf8"));
const listed = JSON.parse(readFileSync(marketplace, "utf8")).plugins[0].source;

// Under npm, its own script runs through this Node, since Windows can't start
// the npm.cmd shim without a shell. tests/support/npm.ts does the same.
const npmCli = process.env.npm_execpath;
const npm = npmCli?.endsWith(".js") ? [process.execPath, npmCli] : ["npm"];
const branch = `chore/release-v${version}`;

const versioned = [
  "package.json",
  "package-lock.json",
  "plugin.json",
  marketplace,
];

if (!written) writeFileSync("CHANGELOG.md", withDraft(changelog));

// Updates package.json and package-lock.json.
run(npm[0], [
  ...npm.slice(1),
  "version",
  version,
  "--no-git-tag-version",
  "--ignore-scripts",
]);

setVersion("plugin.json", plugin.version);
setVersion(marketplace, listed.version);

if (!requested) console.log(`The next version after ${since} is ${version}.`);

if (!yes) {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Ctrl+C rejects the question, which counts as declining.
  const answer = await prompt
    .question(
      `Set the version to ${version}${written ? "" : " and drafted the notes in CHANGELOG.md"}. Edit the notes now if needed.\n` +
        "Commit, push and open the release pull request? [y/N] ",
    )
    .catch(() => "");

  prompt.close();

  // Keeps CHANGELOG.md, so edited notes survive for the next run.
  if (!/^y(es)?$/i.test(answer.trim())) {
    run("git", ["checkout", "--", ...versioned]);

    fail(
      written
        ? "Cancelled"
        : "Cancelled. CHANGELOG.md keeps the drafted notes for the next run. Discard them with: git checkout CHANGELOG.md",
    );
  }
}

run("git", ["switch", "--quiet", "--create", branch]);

run("git", [
  "commit",
  "--quiet",
  "-m",
  `chore(release): v${version}`,
  "--",
  "CHANGELOG.md",
  ...versioned,
]);

run("git", ["push", "--quiet", "--set-upstream", "origin", branch]);

const repository = manifest.repository.url
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");

// GitHub's heading anchor drops the dots, as in #120-beta1.
const notes = `${repository}/blob/${branch}/CHANGELOG.md#${version.replace(/[^\w-]/g, "")}`;

const next = version.includes("-")
  ? `Then run the Release workflow on \`${branch}\` and close this pull request without merging.`
  : `Keep this pull request a draft and run the Release workflow on \`${branch}\`, which publishes and merges it.`;

console.log(
  run("gh", [
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    branch,
    "--draft",
    "--title",
    `chore(release): v${version}`,
    "--body",
    `Release notes: ${notes}\n\nReview the notes and rewrite them for users where needed. ${next}`,
  ]),
);
