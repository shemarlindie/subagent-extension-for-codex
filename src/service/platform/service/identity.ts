import { installRoot, packageVersion } from "./runtime.js";

/**
 * The proxy-to-service HTTP API version. Bump it when a change breaks a
 * proxy of the previous version, so the launcher won't forward to a service
 * it can't talk to.
 */
const serviceApiVersion = 1;

/** Set by the stdio launcher on the services it starts. */
export const launcherEnv = "CODEX_SUBAGENT_EXTENSION_LAUNCHER";

/**
 * Who started a service. Only `stdio` services are replaced after an
 * update; a `foreground` service (npm run dev, npm start, a supervisor) is
 * never stopped by a launcher.
 */
type ServiceLauncher = "stdio" | "foreground";

export type ServiceIdentity = {
  version: string;
  apiVersion: number;
  launcher: ServiceLauncher;
  installRoot: string;
};

export function serviceIdentity(env = process.env): ServiceIdentity {
  return {
    version: packageVersion,
    apiVersion: serviceApiVersion,
    launcher: env[launcherEnv] === "stdio" ? "stdio" : "foreground",
    installRoot,
  };
}

/** Compares release versions by their numeric parts; a prerelease suffix is ignored. */
export function compareVersions(a: string, b: string) {
  const parts = (version: string) =>
    version
      .replace(/-.*/, "")
      .split(".")
      .map((part) => Number(part) || 0);

  const [left, right] = [parts(a), parts(b)];

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return Math.sign(difference);
  }

  return 0;
}

/** What a launcher knows about a running service; older services omit fields. */
export type RunningService = Partial<Omit<ServiceIdentity, "installRoot">> & {
  /** Whether the service's install root still exists, or isn't known. */
  installed: boolean;
};

export type Handoff =
  | { action: "use" }
  | { action: "replace"; forward: boolean }
  | { action: "refuse"; message: string };

/**
 * Whether a launcher uses a running service, replaces it with its own
 * version, or must refuse it. Replacement applies only to services a stdio
 * launcher started that are older or whose installation was removed; a
 * replaced service that speaks the same API keeps serving (`forward`) while
 * its running turns finish.
 */
export function handoff(
  running: RunningService,
  own: Pick<ServiceIdentity, "version" | "apiVersion">,
  origin: string,
): Handoff {
  const compatible = running.apiVersion === own.apiVersion;
  const described = `version ${running.version ?? "unknown"}`;

  if (running.launcher !== "stdio") {
    return compatible
      ? { action: "use" }
      : {
          action: "refuse",
          message: `A different extension service (${described}, not started by the plugin) is running at ${origin}. Stop it, or give development its own CODEX_SUBAGENT_EXTENSION_DATA and PORT.`,
        };
  }

  const order = running.version
    ? compareVersions(running.version, own.version)
    : -1;

  if (order > 0) {
    return compatible
      ? { action: "use" }
      : {
          action: "refuse",
          message: `A newer extension service (${described}) is running at ${origin}; update the plugin to ${running.version} or later.`,
        };
  }

  if (order < 0 || !running.installed) {
    return { action: "replace", forward: compatible };
  }

  return { action: "use" };
}
