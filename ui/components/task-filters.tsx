import { useEffect, useRef } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { Filter } from "../core/types";
import { FILTER_LABELS, filterCounts } from "../core/selectors";
import { useController, useSnapshot } from "./controller-context";
import { Icon } from "./icons";
import { Button } from "./button";
import { scrollChildIntoView } from "./scroll-into-view";

const FILTER_EDGE_GAP = 16;

// Typing a "/" into a text field or a dialog must not be hijacked by the shortcut.
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
    target.closest('[role="dialog"]') !== null);

export function TaskFilters() {
  const controller = useController(),
    state = useSnapshot(),
    counts = filterCounts(state),
    searchRef = useRef<HTMLInputElement>(null),
    groupRef = useRef<HTMLDivElement>(null);

  const filters = (Object.entries(FILTER_LABELS) as [Filter, string][]).filter(
    ([filter]) => filter !== "attention" || state.mode === "panel",
  );

  // "/" jumps to search from anywhere outside a text field or dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        typing(event.target)
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Keep the selected filter visible when the group scrolls sideways.
  useEffect(() => {
    const group = groupRef.current,
      selected = group?.querySelector<HTMLElement>(
        `[data-filter="${state.filter}"]`,
      );

    if (group && selected)
      scrollChildIntoView(group, selected, FILTER_EDGE_GAP);
  }, [state.filter]);

  return (
    <>
      <div className="search-box">
        <Icon name="search" className="search-icon" />
        <input
          id="search"
          ref={searchRef}
          className="search"
          type="search"
          placeholder="Search tasks"
          aria-label="Search tasks"
          aria-keyshortcuts="/"
          value={state.search}
          onChange={(event) => controller.setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            if (state.search) controller.setSearch("");
            else event.currentTarget.blur();
          }}
        />
        {/* The native clear button is hidden; this one also restores focus to the input. */}
        {state.search && (
          <Button
            variant="text"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => {
              controller.setSearch("");
              searchRef.current?.focus();
            }}
          >
            <Icon name="close" size={12} />
          </Button>
        )}
      </div>
      <RadioGroup
        ref={groupRef}
        className="filters"
        aria-label="Filter tasks"
        value={state.filter}
        onValueChange={(value) => controller.setFilter(value as Filter)}
      >
        {filters.map(([filter, label]) => (
          <Radio.Root
            key={filter}
            value={filter}
            data-filter={filter}
            aria-label={`${label}, ${counts[filter]}`}
            nativeButton
            render={<button type="button" />}
          >
            {label}
            <span
              className="filter-count"
              data-alert={
                (filter === "attention" || filter === "failed") &&
                counts[filter] > 0
                  ? ""
                  : undefined
              }
            >
              {counts[filter]}
            </span>
          </Radio.Root>
        ))}
      </RadioGroup>
    </>
  );
}
