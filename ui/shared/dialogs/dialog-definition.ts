import type { ReactNode } from "react";

import type { DialogState } from "../state/types";

export type DialogKind = DialogState["kind"];
export type DialogOf<K extends DialogKind> = Extract<DialogState, { kind: K }>;

/** What a dialog variant contributes to the shared `DialogHost` shell. */
export interface DialogDefinition<K extends DialogKind> {
  title: (dialog: DialogOf<K>) => string;
  render: (dialog: DialogOf<K>) => ReactNode;
  /** Replacement control when the original trigger was unmounted, such as a menu item. */
  restoreFocus?: () => HTMLElement | null;
  /** The element to focus on open; defaults to the first focusable one. */
  initialFocus?: (
    popup: HTMLElement | null,
    dialog: DialogOf<K>,
  ) => HTMLElement | null;
}

export function defineDialog<K extends DialogKind>(
  definition: DialogDefinition<K>,
): DialogDefinition<K> {
  return definition;
}

export function firstTextField(popup: HTMLElement | null) {
  return (
    popup?.querySelector<HTMLElement>(
      "textarea, input:not([type=hidden], [type=checkbox], [type=radio])",
    ) ?? null
  );
}
