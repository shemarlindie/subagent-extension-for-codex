import type { SettingsPageDialog } from "../state/types";

/** Page identity, availability and lifetime belong to the application. */
export const PAGES = {
  tasks: {
    label: "Tasks",
    globalOnly: false,
    keepMounted: true,
    entryFocusId: "project-scope",
  },
  projects: {
    label: "Projects",
    globalOnly: true,
    keepMounted: false,
    entryFocusId: "projects-heading",
  },
  settings: {
    label: "Settings",
    globalOnly: false,
    keepMounted: false,
    entryFocusId: "settings-heading",
  },
} as const;

export type PageId = keyof typeof PAGES;
export const DEFAULT_PAGE: PageId = "tasks";

export function parsePage(value: string | null): PageId | undefined {
  return value && Object.hasOwn(PAGES, value) ? (value as PageId) : undefined;
}

type NavigationState = {
  page: PageId;
  conversation?: string;
  connected: boolean;
  scopeKnown: boolean;
  busy: boolean;
  dialog?: { kind: string };
};

/** Settings keeps its page form in dialog state, though it isn't a modal. */
export function isSettingsPageDialog(dialog?: {
  kind: string;
}): dialog is SettingsPageDialog {
  return dialog?.kind === "settings" || dialog?.kind === "settings-loading";
}

export function canNavigate(state: NavigationState, page: PageId): boolean {
  const settingsPageState =
    state.page === "settings" && isSettingsPageDialog(state.dialog);

  if (state.busy || (state.dialog && !settingsPageState)) return false;

  return (
    !PAGES[page].globalOnly ||
    (!state.conversation && state.connected && state.scopeKnown)
  );
}
