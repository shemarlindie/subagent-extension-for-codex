import { createContext, useContext, useSyncExternalStore } from "react";

import type { Controller } from "./controller";

export const ControllerContext = createContext<Controller | null>(null);

export function useController() {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error("Missing application controller");

  return controller;
}

export function useSnapshot() {
  const controller = useController();

  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
}
