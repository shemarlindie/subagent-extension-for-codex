import { createContext } from "react";

/** Opens a file a link names. Settles once the open ends, and reports its own errors. */
export type OpenFileLink = (path: string) => Promise<void>;

/**
 * Where file links open. Views whose links name files in a known folder
 * provide it, and elsewhere file links show as text.
 */
export const FileLinkContext = createContext<OpenFileLink | undefined>(
  undefined,
);
