import { DEFAULT_PAGE } from "../../navigation/pages";
import type { PersistedViewState, Snapshot } from "../types";

/** URL-safe navigation choices, without task content or unsent messages. */
export function persistView(
  state: Snapshot,
  browsing: boolean,
): PersistedViewState {
  return {
    ...(state.page !== DEFAULT_PAGE ? { page: state.page } : {}),
    ...(state.repository ? { repository: state.repository } : {}),
    ...(state.selected ? { selected: state.selected, tab: state.tab } : {}),
    ...(state.newTask ? { composing: true } : {}),
    ...(state.filter ? { filter: state.filter } : {}),
    ...(state.search ? { search: state.search } : {}),
    ...(browsing && !state.selected ? { browsing: true } : {}),
  };
}
