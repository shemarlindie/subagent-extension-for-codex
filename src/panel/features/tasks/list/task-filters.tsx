import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useEffect, useRef } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import {
  effectiveFilter,
  FILTER_LABELS,
  filterCounts,
  TASK_LIST_FIELDS,
} from "../../../app/state/selectors";
import type { Filter } from "../../../app/state/types";
import { SkeletonShape } from "../../../shared/components/loading-skeleton/loading-skeleton";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { Presence } from "../../../shared/components/motion/presence";
import { SearchField } from "../../../shared/components/search/search-field";
import { scrollChildIntoView } from "../../../shared/utils/scroll-into-view";

const FILTER_EDGE_GAP = 16;

export function TaskFilters() {
  const controller = useController();
  const list = useSnapshot(TASK_LIST_FIELDS);
  const loading = useSnapshot((state) => state.taskListLoading);
  const counts = filterCounts(list);
  const current = effectiveFilter(list);
  const groupRef = useRef<HTMLDivElement>(null);
  // A load or scope switch passes through an empty list, so the batch that follows sets every
  // pill at once; it appears in place. Only changes between populated renders animate.
  const hadTasks = useRef(false);
  const settled = hadTasks.current;

  useEffect(() => {
    hadTasks.current = list.tasks.length > 0;
  });

  const filters = Object.entries(FILTER_LABELS) as [Filter, string][];

  // Keep the URL choice visible during loading; the controller drops it when results show no matches.
  // All always shows, which keeps the row reserved.
  const shown = (filter: Filter) =>
    filter === "all" || counts[filter] > 0 || filter === current;

  // Keep the selected filter visible when the group scrolls sideways.
  useEffect(() => {
    const group = groupRef.current;

    const selected = group?.querySelector<HTMLElement>(
      `[data-filter="${current}"]`,
    );

    if (group && selected) {
      scrollChildIntoView(group, selected, FILTER_EDGE_GAP);
    }
  }, [current]);

  return (
    <>
      <SearchField
        className="task-search"
        label="Search tasks"
        clearLabel="Clear search"
        focusShortcut
        value={list.search}
        onValueChange={(value) => controller.setSearch(value)}
        blurOnEmptyEscape
      />
      <RadioGroup
        ref={groupRef}
        className="filters"
        aria-label="Filter tasks"
        aria-busy={loading || undefined}
        value={current}
        onValueChange={(value) => controller.setFilter(value)}
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
              aria-label={
                loading ? `${label}, loading` : `${label}, ${counts[filter]}`
              }
              nativeButton
              render={<button type="button" />}
              // Choosing the pill that auto-select already marked fires no change, so pin it here.
              onClick={() => controller.setFilter(filter)}
            >
              {label}
              <span
                className="filter-count"
                data-alert={
                  !loading &&
                  (filter === "attention" || filter === "failed") &&
                  counts[filter] > 0
                    ? ""
                    : undefined
                }
                data-unread={
                  !loading && filter === "unread" && counts[filter] > 0
                    ? ""
                    : undefined
                }
              >
                <LoadingSwap
                  as="span"
                  className="loading-swap-inline"
                  loading={loading}
                  busy={false}
                  skeleton={<SkeletonShape className="filter-count-skeleton" />}
                >
                  {counts[filter]}
                </LoadingSwap>
              </span>
            </Radio.Root>
          </Presence>
        ))}
      </RadioGroup>
    </>
  );
}
