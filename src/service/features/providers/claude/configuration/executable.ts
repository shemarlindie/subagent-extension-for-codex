import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, win32 } from "node:path";
import { promisify } from "node:util";

/**
 * Minimum Claude Code release qualified against the bundled Agent SDK.
 * Newer releases are accepted without an upper bound; re-qualify compatibility
 * whenever the SDK version changes.
 */
export const claudeCliSupport = {
  sdk: "0.3.296",
  minimum: "2.1.285",
} as const;

/** Names an explicit Claude Code executable, which replaces the PATH lookup. */
export const claudePathVariable = "CODEX_SUBAGENT_EXTENSION_CLAUDE_PATH";

const supportedRange = `${claudeCliSupport.minimum}+`;
const setupDocs = "https://code.claude.com/docs/en/setup";
/** How long a validated executable is trusted before `--version` runs again. */
const FRESH_MS = 5 * 60 * 1000;
/** A failed check, which may be transient like a timeout, is retried sooner. */
const FAILED_FRESH_MS = 30 * 1000;
const VERSION_TIMEOUT_MS = 10_000;
const VERSION_OUTPUT_BYTES = 4096;
const execFileAsync = promisify(execFile);

type ClaudeCliProblem =
  "missing" | "invalid_override" | "unlaunchable" | "unrecognized" | "too_old";

export type ClaudeCliStatus =
  | { ready: true; path: string; version: string; supported: string }
  | {
      ready: false;
      problem: ClaudeCliProblem;
      message: string;
      path?: string;
      version?: string;
      supported: string;
    };

/** Where the service looks for Claude Code. */
export type ClaudeCliEnvironment = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
};

type Located =
  | { path: string }
  | { problem: "missing" | "invalid_override"; message: string };

type CacheEntry = {
  identity: string;
  expires: number;
  status: Promise<ClaudeCliStatus>;
};

const failure = (
  problem: ClaudeCliProblem,
  message: string,
  facts: { path?: string; version?: string } = {},
): ClaudeCliStatus => ({
  ready: false,
  problem,
  message,
  ...facts,
  supported: supportedRange,
});

/** Whether a regular file (following symlinks) exists with the given access. */
async function isFile(path: string, mode = constants.F_OK) {
  try {
    await access(path, mode);

    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The PATH variable, whose name Windows treats case-insensitively. */
function pathVariable({ env, platform }: ClaudeCliEnvironment) {
  if (platform !== "win32") return env.PATH ?? "";
  const name = Object.keys(env).find((key) => key.toUpperCase() === "PATH");

  return name ? (env[name] ?? "") : "";
}

/**
 * The executable a PATH directory provides. npm on Windows installs
 * `claude.cmd`, `claude.ps1` and `claude` launchers that run the package's
 * `bin/claude.exe`; that binary runs without a shell.
 */
async function inDirectory(directory: string, platform: NodeJS.Platform) {
  if (platform !== "win32") {
    const candidate = join(directory, "claude");

    return (await isFile(candidate, constants.X_OK)) ? candidate : undefined;
  }

  const native = join(directory, "claude.exe");
  if (await isFile(native)) return native;

  for (const launcher of ["claude.cmd", "claude.ps1", "claude"]) {
    if (!(await isFile(join(directory, launcher)))) continue;

    const target = join(
      directory,
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );

    if (await isFile(target)) return target;
  }

  return undefined;
}

/**
 * The Claude Code executable to run: the override when set, otherwise the
 * first `claude` on the service's own PATH, resolved through symlinks. No
 * shell runs, so aliases and interactive shell init don't apply.
 */
export async function locateClaudeCli(
  environment: ClaudeCliEnvironment,
): Promise<Located> {
  const override = environment.env[claudePathVariable];

  const absolute =
    environment.platform === "win32" ? win32.isAbsolute : isAbsolute;

  if (override) {
    if (!absolute(override)) {
      return {
        problem: "invalid_override",
        message: `${claudePathVariable} must be an absolute path to the Claude Code executable; it is "${override}".`,
      };
    }

    try {
      return { path: await realpath(override) };
    } catch {
      return {
        problem: "invalid_override",
        message: `${claudePathVariable} points to ${override}, which does not exist. Fix or unset it; the service does not fall back to PATH while it is set.`,
      };
    }
  }

  const separator = environment.platform === "win32" ? ";" : ":";

  for (const directory of pathVariable(environment).split(separator)) {
    // Relative entries would resolve against the service's working directory.
    if (!directory || !absolute(directory)) continue;
    const found = await inDirectory(directory, environment.platform);
    if (!found) continue;

    try {
      return { path: await realpath(found) };
    } catch {}
  }

  return {
    problem: "missing",
    message: `Claude Code was not found on the service's PATH. Install a supported version (${supportedRange}) from ${setupDocs}: the stable channel is the Homebrew claude-code cask or npm's @anthropic-ai/claude-code@stable. Or set ${claudePathVariable} to its absolute path.`,
  };
}

/** A strict `X.Y.Z (Claude Code)` version line; prereleases don't match. */
export function parseClaudeVersion(output: string) {
  return /^(\d+\.\d+\.\d+) \(Claude Code\)$/.exec(output.trim())?.[1];
}

/** Compares two X.Y.Z versions numerically. */
export function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }

  return 0;
}

/** The update step for how this copy of Claude Code was installed. */
function updateStep(path: string) {
  if (/[\\/]Caskroom[\\/]/.test(path)) {
    return "brew upgrade --cask claude-code (Homebrew installs don't update themselves)";
  }

  if (/[\\/]node_modules[\\/]/.test(path)) {
    return "npm install -g @anthropic-ai/claude-code@stable";
  }

  return "claude update";
}

/** The version line `--version` prints, read without a shell and within bounds. */
async function versionOutput(path: string, timeout: number) {
  const { stdout } = await execFileAsync(path, ["--version"], {
    timeout,
    maxBuffer: VERSION_OUTPUT_BYTES,
    windowsHide: true,
  });

  return stdout;
}

/** Explains why `--version` could not run: a timeout, or the error it raised. */
function unlaunchableReason(error: unknown, timeout: number) {
  if ((error as { killed?: boolean }).killed) {
    return `\`--version\` did not finish within ${timeout / 1000} seconds`;
  }

  return error instanceof Error ? error.message : String(error);
}

/** Runs `--version` and checks the release against the supported range. */
export async function validateClaudeCli(
  path: string,
  timeout = VERSION_TIMEOUT_MS,
): Promise<ClaudeCliStatus> {
  let output: string;

  try {
    output = await versionOutput(path, timeout);
  } catch (error) {
    const reason = unlaunchableReason(error, timeout);

    return failure(
      "unlaunchable",
      `Claude Code at ${path} could not be run: ${reason}. Reinstall it from ${setupDocs}, or set ${claudePathVariable} to a working copy.`,
      { path },
    );
  }

  const version = parseClaudeVersion(output);

  if (!version) {
    return failure(
      "unrecognized",
      `${path} --version printed "${output.trim().slice(0, 200)}", not a Claude Code release version. Install a supported release (${supportedRange}); prereleases aren't supported.`,
      { path },
    );
  }

  if (compareVersions(version, claudeCliSupport.minimum) < 0) {
    return failure(
      "too_old",
      `Claude Code ${version} at ${path} is older than the supported ${supportedRange}. Update it with ${updateStep(path)}, or set ${claudePathVariable} to a supported copy.`,
      { path, version },
    );
  }

  return { ready: true, path, version, supported: supportedRange };
}

/**
 * The installed Claude Code CLI, validated before each new session. The
 * result is reused while the resolved file is unchanged and fresh; an update
 * that replaces the binary is validated again. Running sessions keep their
 * subprocess.
 */
export class ClaudeCli {
  private cache?: CacheEntry;

  constructor(
    private environment: () => ClaudeCliEnvironment = () => ({
      env: process.env,
      platform: process.platform,
    }),
    private validate: (
      path: string,
    ) => Promise<ClaudeCliStatus> = validateClaudeCli,
  ) {}

  async status(): Promise<ClaudeCliStatus> {
    const located = await locateClaudeCli(this.environment());

    if (!("path" in located)) return failure(located.problem, located.message);

    let identity: string;

    try {
      const file = await stat(located.path);
      identity = [located.path, file.dev, file.ino, file.mtimeMs].join("\0");
    } catch (error) {
      return failure(
        "unlaunchable",
        `Claude Code at ${located.path} could not be read: ${error instanceof Error ? error.message : String(error)}.`,
        { path: located.path },
      );
    }

    const now = Date.now();

    if (this.cache?.identity === identity && this.cache.expires > now) {
      return this.cache.status;
    }

    const status = this.validate(located.path);
    const entry = { identity, expires: now + FRESH_MS, status };
    this.cache = entry;

    // Shorten a failure's lifetime once it is known.
    const shorten = () => {
      entry.expires = now + FAILED_FRESH_MS;
    };

    status.then((result) => !result.ready && shorten(), shorten);

    return status;
  }

  /** The validated executable's path; throws the readiness message when unsupported. */
  async executable(): Promise<string> {
    const status = await this.status();
    if (!status.ready) throw new Error(status.message);

    return status.path;
  }
}
