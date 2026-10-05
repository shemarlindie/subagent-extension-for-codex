import type { ReactNode } from "react";

import type { DialogState } from "../core/types";
import { controlDialog } from "./control-form";
import { delegateDialog } from "./delegate-form";
import type { DialogDefinition, DialogKind } from "./dialog-definition";
import { handoffDialog } from "./handoff-form";
import { artifactDialog } from "./info-dialogs";
import { permissionDialog } from "./permission-form";
import { projectDialog } from "./project-form";
import { settingsDialog } from "./settings-form";

// A new dialog variant fails to compile until it is registered here.
const registry: { [K in DialogKind]: DialogDefinition<K> } = {
  project: projectDialog,
  settings: settingsDialog,
  delegate: delegateDialog,
  control: controlDialog,
  respond: permissionDialog,
  handoff: handoffDialog,
  artifact: artifactDialog,
};

/** Looks up by the dialog's kind, which TypeScript cannot correlate with the entry. */
export function dialogDefinition(dialog: DialogState) {
  return registry[dialog.kind] as unknown as {
    title(dialog: DialogState): string;
    render(dialog: DialogState): ReactNode;
    initialFocus?(
      popup: HTMLElement | null,
      dialog: DialogState,
    ): HTMLElement | null;
  };
}
