import type { PathSymlink } from "../filesystem/path-contract.js";

/** Files selected for removal from a verified provider session. @strict */
export type SessionDeletionResource = {
  path: string;
  kind: "file" | "directory";
  symlinks?: PathSymlink[];
};

/** @strict */
export type SessionDeletionStatus = {
  available: boolean;
  message?: string;
  resources?: SessionDeletionResource[];
  /** Changes when the verified resources are replaced. */
  version?: string;
};
