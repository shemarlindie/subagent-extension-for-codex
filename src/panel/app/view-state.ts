import { DEFAULT_PAGE, parsePage } from "./navigation/pages";
import {
  parsePersistedDialogs,
  type PersistedDialogId,
  persistedDialogId,
  persistedDialogIds,
} from "./state/persistence/dialog-persistence";
import type {
  Filter,
  PersistedDialog,
  PersistedViewState,
  Tab,
  UiStatePersistence,
} from "./state/types";

const keys = {
  page: "dw_page",
  project: "dw_project",
  task: "dw_task",
  browsing: "dw_browse",
  filter: "dw_filter",
  search: "dw_search",
  tab: "dw_tab",
} as const;

const DIALOG_STORAGE_KEY = "codex-subagent-extension.dialog.v1";

const SETTINGS_SECTION_STORAGE_KEY =
  "codex-subagent-extension.settings-section.v1";

const INPUT_PERSISTENCE_DEBOUNCE_MS = 250;

const filters: Filter[] = [
  "all",
  "active",
  "attention",
  "completed",
  "failed",
  "unseen",
];

const tabs: Tab[] = ["chat", "changes", "activity", "details"];

const dialogKey = (id: PersistedDialogId) => `dw_dlg_${id}`;

type DevHostWindow = Window & {
  __CODEX_SUBAGENT_DEV_UI_STATE__?: UiStatePersistence;
};

function read(url: URL): PersistedViewState {
  const state: PersistedViewState = {};
  const params = url.searchParams;

  const page = parsePage(params.get(keys.page));
  if (page && page !== DEFAULT_PAGE) state.page = page;

  if (params.has(keys.project)) {
    const repository = params.get(keys.project);
    if (repository) state.repository = repository;
  }

  const task = params.get(keys.task);
  if (task) state.selected = task;

  const filter = params.get(keys.filter);

  if (filter && filters.includes(filter as Filter)) {
    state.filter = filter as Filter;
  }

  if (params.has(keys.search)) state.search = params.get(keys.search) ?? "";

  const tab = params.get(keys.tab);
  if (tab && tabs.includes(tab as Tab)) state.tab = tab as Tab;

  if (!state.selected && params.get(keys.browsing) === "1") {
    state.browsing = true;
  }

  return state;
}

function write(
  url: URL,
  state: PersistedViewState,
  dialogs: PersistedDialog[],
  search = state.search,
) {
  const params = url.searchParams;
  Object.values(keys).forEach((key) => params.delete(key));
  persistedDialogIds.forEach((id) => params.delete(dialogKey(id)));

  if (state.page && state.page !== DEFAULT_PAGE) {
    params.set(keys.page, state.page);
  }

  if (state.repository) params.set(keys.project, state.repository);
  if (state.selected) params.set(keys.task, state.selected);
  else if (state.browsing) params.set(keys.browsing, "1");
  if (state.filter) params.set(keys.filter, state.filter);
  if (search) params.set(keys.search, search);
  if (state.selected && state.tab) params.set(keys.tab, state.tab);

  dialogs.forEach((dialog) =>
    params.set(dialogKey(persistedDialogId(dialog)), "1"),
  );

  return url;
}

function replaceUrl(win: Window, url: URL) {
  if (url.href !== win.location.href) {
    win.history.replaceState(win.history.state, "", url);
  }
}

function dialogStorage(win: Window): Storage | undefined {
  try {
    return win.localStorage;
  } catch {
    try {
      return win.sessionStorage;
    } catch {
      return undefined;
    }
  }
}

function readDialogs(storage?: Storage): PersistedDialog[] {
  if (!storage) return [];

  try {
    const value = storage.getItem(DIALOG_STORAGE_KEY);

    return value ? parsePersistedDialogs(JSON.parse(value)) : [];
  } catch {
    return [];
  }
}

function writeDialogs(
  storage: Storage | undefined,
  dialogs: PersistedDialog[],
) {
  if (!storage) return;

  try {
    if (dialogs.length) {
      storage.setItem(DIALOG_STORAGE_KEY, JSON.stringify(dialogs));
    } else {
      storage.removeItem(DIALOG_STORAGE_KEY);
    }
  } catch {
    // Storage can be disabled or full; persistence must not break the UI.
  }
}

function readLastSettingsSection(storage?: Storage) {
  if (!storage) return undefined;

  try {
    const section = storage.getItem(SETTINGS_SECTION_STORAGE_KEY);

    return section && section.length <= 100 ? section : undefined;
  } catch {
    return undefined;
  }
}

function writeLastSettingsSection(
  storage: Storage | undefined,
  section: string,
) {
  if (!storage) return;

  try {
    storage.setItem(SETTINGS_SECTION_STORAGE_KEY, section);
  } catch {
    // Storage can be disabled or full; persistence must not break the UI.
  }
}

function dialogStackIdentity(dialogs: PersistedDialog[]) {
  return JSON.stringify(dialogs.map(({ draft: _draft, ...dialog }) => dialog));
}

/** Keeps shareable view choices in the URL and private dialog drafts in local storage. */
export function browserUiState(win: Window = window): UiStatePersistence {
  const storage = dialogStorage(win);
  let persistedDialogs = readDialogs(storage),
    persistedSettingsSection = readLastSettingsSection(storage),
    pendingDialogs: PersistedDialog[] | undefined,
    pendingSearch: string | undefined,
    dialogTimer: ReturnType<typeof setTimeout> | undefined,
    searchTimer: ReturnType<typeof setTimeout> | undefined,
    persistedSearch =
      new URL(win.location.href).searchParams.get(keys.search) ?? "";

  const flushSearch = () => {
    clearTimeout(searchTimer);
    searchTimer = undefined;

    if (pendingSearch === undefined) return;

    const url = new URL(win.location.href);
    if (pendingSearch) url.searchParams.set(keys.search, pendingSearch);
    else url.searchParams.delete(keys.search);
    persistedSearch = pendingSearch;
    pendingSearch = undefined;
    replaceUrl(win, url);
  };

  const flushDialogs = () => {
    clearTimeout(dialogTimer);
    dialogTimer = undefined;

    if (!pendingDialogs) return;

    persistedDialogs = pendingDialogs;
    pendingDialogs = undefined;
    writeDialogs(storage, persistedDialogs);
  };

  const flush = () => {
    flushSearch();
    flushDialogs();
  };

  return {
    get initial() {
      const url = new URL(win.location.href),
        openIds = new Set(
          persistedDialogIds.filter(
            (id) => url.searchParams.get(dialogKey(id)) === "1",
          ),
        ),
        dialogs = readDialogs(storage).filter((dialog) =>
          openIds.has(persistedDialogId(dialog)),
        );

      return {
        view: read(url),
        ...(persistedSettingsSection
          ? { lastSettingsSection: persistedSettingsSection }
          : {}),
        ...(dialogs.length ? { dialogs } : {}),
      };
    },
    save: (state) => {
      const dialogs = state.dialogs ?? [],
        search = state.view.search ?? "";

      if (
        state.lastSettingsSection &&
        state.lastSettingsSection !== persistedSettingsSection
      ) {
        persistedSettingsSection = state.lastSettingsSection;
        writeLastSettingsSection(storage, persistedSettingsSection);
      }

      // Filtering stays live; only the URL write waits for typing to pause.
      if (search !== persistedSearch) {
        pendingSearch = search;
        clearTimeout(searchTimer);

        searchTimer = setTimeout(flushSearch, INPUT_PERSISTENCE_DEBOUNCE_MS);
      } else {
        clearTimeout(searchTimer);
        searchTimer = undefined;
        pendingSearch = undefined;
      }

      const url = write(
        new URL(win.location.href),
        state.view,
        dialogs,
        persistedSearch,
      );

      replaceUrl(win, url);

      const nextIdentity = dialogStackIdentity(dialogs),
        currentIdentity = dialogStackIdentity(persistedDialogs);

      if (nextIdentity !== currentIdentity) {
        clearTimeout(dialogTimer);
        dialogTimer = undefined;
        pendingDialogs = undefined;
        persistedDialogs = dialogs;
        writeDialogs(storage, persistedDialogs);

        return;
      }

      if (JSON.stringify(dialogs) === JSON.stringify(persistedDialogs)) {
        clearTimeout(dialogTimer);
        dialogTimer = undefined;
        pendingDialogs = undefined;

        return;
      }

      pendingDialogs = dialogs;
      clearTimeout(dialogTimer);
      dialogTimer = setTimeout(flushDialogs, INPUT_PERSISTENCE_DEBOUNCE_MS);
    },
    flush,
  };
}

/** Uses the mock host's outer URL when the panel is running in its iframe. */
export function embeddedDevHostUiState(
  win: Window = window,
): UiStatePersistence | undefined {
  try {
    if (win.parent === win) return undefined;

    return (win.parent as DevHostWindow).__CODEX_SUBAGENT_DEV_UI_STATE__;
  } catch {
    // Real MCP hosts are commonly cross-origin and do not expose this bridge.
    return undefined;
  }
}
