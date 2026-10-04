import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
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
      <ToggleGroup
        className="filters"
        aria-label="Filter tasks"
        value={[state.filter]}
        onValueChange={(value) => {
          // Base UI emits an empty value when the active toggle is clicked again; ignore it.
          if (value[0]) controller.setFilter(value[0] as Filter);
        }}
      >
        {filters.map(([filter, label]) => (
          <Toggle key={filter} value={filter} data-filter={filter}>
            {label}
          </Toggle>
        ))}
      </ToggleGroup>
    </>
  );
}
