import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useEffect, useRef } from "react";

import { Button } from "../../../shared/components/button";
import { Icon } from "../../../shared/components/icons";
import { Presence } from "../../../shared/components/motion";
import { scrollChildIntoView } from "../../../shared/components/scroll-into-view";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import {
  effectiveFilter,
  FILTER_LABELS,
  filterCounts,
} from "../../../shared/state/selectors";
import type { Filter } from "../../../shared/state/types";

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
    current = effectiveFilter(state),
    searchRef = useRef<HTMLInputElement>(null),
    groupRef = useRef<HTMLDivElement>(null),
    // A load or scope switch passes through an empty list, so the batch that follows sets every
    // pill at once; it appears in place. Only changes between populated renders animate.
    hadTasks = useRef(false),
    settled = hadTasks.current;

  useEffect(() => {
    hadTasks.current = state.tasks.length > 0;
  });

  const filters = Object.entries(FILTER_LABELS) as [Filter, string][];

  // Keep the URL choice visible during loading; the controller drops it when results show no matches.
  // All always shows, which keeps the row reserved.
  const shown = (filter: Filter) =>
    filter === "all" || counts[filter] > 0 || filter === current;

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
        `[data-filter="${current}"]`,
      );

    if (group && selected)
      scrollChildIntoView(group, selected, FILTER_EDGE_GAP);
  }, [current]);

  return (
    <>
      <div className="search-box">
        <Icon name="search" size={10} className="search-icon" />
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
            <Icon name="close" size={8} />
          </Button>
        )}
      </div>
      <RadioGroup
        ref={groupRef}
        className="filters"
        aria-label="Filter tasks"
        value={current}
        onValueChange={(value) => controller.setFilter(value as Filter)}
      >
        {filters.map(([filter, label]) => (
          <Presence
            key={filter}
            show={shown(filter)}
            variant="fold"
            animate={settled}
          >
            <Radio.Root
              value={filter}
              data-filter={filter}
              aria-label={`${label}, ${counts[filter]}`}
              nativeButton
              render={<button type="button" />}
              // Choosing the pill that auto-select already marked fires no change, so pin it here.
              onClick={() => controller.setFilter(filter)}
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
          </Presence>
        ))}
      </RadioGroup>
    </>
  );
}
