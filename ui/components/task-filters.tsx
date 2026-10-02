import type { Filter } from "../core/types";
import { useController, useSnapshot } from "./controller-context";
export function TaskFilters() {
  const controller = useController(),
    state = useSnapshot();
  const filters: [Filter, string][] = [
    ["all", "All"],
    ["active", "Active"],
    ...(state.mode === "panel"
      ? [["attention", "Needs input"] as [Filter, string]]
      : []),
    ["completed", "Done"],
  ];
  return (
    <>
      <input
        id="search"
        className="search"
        type="search"
        placeholder="Search tasks"
        aria-label="Search tasks"
        value={state.search}
        onChange={(event) => controller.setSearch(event.target.value)}
      />
      <div className="filters" aria-label="Filter tasks">
        {filters.map(([filter, label]) => (
          <button
            key={filter}
            data-filter={filter}
            aria-pressed={filter === state.filter}
            onClick={() => controller.setFilter(filter)}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
