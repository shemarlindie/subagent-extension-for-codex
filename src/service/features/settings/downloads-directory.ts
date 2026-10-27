import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

// Use the Known Folder API so redirected and localized Downloads folders work.
const windowsDownloads = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DownloadsFolder {
  [DllImport("shell32.dll")]
  public static extern int SHGetKnownFolderPath(
    [MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags,
    IntPtr token, out IntPtr path);
}
'@
$path = [IntPtr]::Zero
try {
  # KF_FLAG_DONT_VERIFY returns the configured path even before the folder exists.
  $result = [DownloadsFolder]::SHGetKnownFolderPath(
    [Guid]'374DE290-123F-4565-9164-39C4925E467B', 0x4000, [IntPtr]::Zero, [ref]$path)
  [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($result)
  [Runtime.InteropServices.Marshal]::PtrToStringUni($path)
} finally {
  [Runtime.InteropServices.Marshal]::FreeCoTaskMem($path)
}
`;

async function execute(command: string, args: string[]) {
  try {
    const { stdout } = await executeFile(command, args, {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 16_384,
      windowsHide: true,
    });

    return stdout;
  } catch (error) {
    throw new Error("The system couldn't locate the Downloads folder.", {
      cause: error,
    });
  }
}

type DownloadsOptions = {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  execute?: typeof execute;
};

/** Reads the XDG quoted path as data, without sourcing shell commands. */
function xdgDownloadPath(text: string, home: string) {
  const entry = text
    .split(/\r?\n/)
    .findLast((line) => /^\s*XDG_DOWNLOAD_DIR\s*=/.test(line));

  if (entry === undefined) return join(home, "Downloads");

  const match = /^\s*XDG_DOWNLOAD_DIR="((?:\\.|[^"\\])*)"\s*(?:#.*)?$/.exec(
    entry,
  );

  if (!match) throw new Error("The Downloads folder setting is invalid.");
  let raw = match[1]!,
    path = "";

  if (raw === "$HOME" || raw.startsWith("$HOME/")) {
    path = home;
    raw = raw.slice(5);
  }

  for (let index = 0; index < raw.length; index++) {
    const character = raw[index]!;

    if (character === "\\" && /[\\"$`]/.test(raw[index + 1] ?? "")) {
      path += raw[++index];
    } else if (character === "$" || character === "`") {
      throw new Error(
        "The Downloads folder setting uses an unsupported variable or command.",
      );
    } else {
      path += character;
    }
  }

  return path;
}

/** Resolves Downloads on the service computer, including OS folder redirects. */
export async function downloadsDirectory(options: DownloadsOptions = {}) {
  const {
    platform = process.platform,
    home = homedir(),
    env = process.env,
    execute: run = execute,
  } = options;

  let path: string;

  if (platform === "darwin") {
    path = await run("/usr/bin/osascript", [
      "-e",
      "POSIX path of (path to downloads folder)",
    ]);
  } else if (platform === "win32") {
    path = await run(
      win32.join(
        env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-Command", windowsDownloads],
    );
  } else if (platform === "linux") {
    const config =
      env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
        ? env.XDG_CONFIG_HOME
        : join(home, ".config");

    let text = "";

    try {
      text = await readFile(join(config, "user-dirs.dirs"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    path = xdgDownloadPath(text, home);
  } else {
    throw new Error(
      "Saving settings files is unavailable on this operating system.",
    );
  }

  // Command output has one trailing newline. Spaces may belong to the folder.
  if (platform !== "linux") path = path.replace(/\r?\n$/, "");

  const absolute =
    platform === "win32"
      ? /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(path)
      : isAbsolute(path);

  if (!absolute) {
    throw new Error("Downloads must be an absolute folder path.");
  }

  return path;
}
