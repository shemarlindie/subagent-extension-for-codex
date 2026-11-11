import { createContext, useContext, useState } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import type { Controller } from "./controller";
import type { Snapshot } from "./types";

export const ControllerContext = createContext<Controller | null>(null);

export function useController() {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error("Missing application controller");

  return controller;
}

type Select<T> = (state: Snapshot) => T;

/**
 * Reads snapshot fields. The component rerenders only when the selection
 * changes by `shallowEqual`. Pass the field names, with an optional `derive`
 * for values computed from other fields, or a selector that returns a field, a
 * primitive, or an object of those. Derive anything newly built in render.
 */
export function useSnapshot<T>(select: Select<T>): T;

export function useSnapshot<
  K extends keyof Snapshot,
  T extends object = object,
>(fields: readonly K[], derive?: Select<T>): Pick<Snapshot, K> & T;

export function useSnapshot(
  fieldsOrSelect: readonly (keyof Snapshot)[] | Select<unknown>,
  derive?: Select<object>,
) {
  const controller = useController();

  const select =
    typeof fieldsOrSelect === "function"
      ? fieldsOrSelect
      : (state: Snapshot) => ({
          ...Object.fromEntries(
            fieldsOrSelect.map((field) => [field, state[field]]),
          ),
          ...derive?.(state),
        });

  // A selector that builds a nested value renders on every patch. Development
  // checks each component's selector once.
  useState(() => {
    if (import.meta.env.DEV) warnIfUnstable(select, controller.getSnapshot());
  });

  return useSyncExternalStoreWithSelector(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
    select,
    shallowEqual,
  );
}

function warnIfUnstable<T>(select: Select<T>, state: Snapshot) {
  if (shallowEqual(select(state), select(state))) return;

  console.warn(
    "useSnapshot selector returns a new value for the same snapshot, so its component renders on every patch:",
    select,
  );
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype;

/** Compares primitives and plain objects one level deep. */
export function shallowEqual(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true;
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);

  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
  );
}
