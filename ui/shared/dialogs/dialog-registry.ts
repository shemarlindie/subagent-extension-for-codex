import type { ReactNode } from "react";

import { changedFileDialog } from "../../features/changes/changed-file-preview";
import { delegateDialog } from "../../features/delegation/delegate-form";
import { projectDialog } from "../../features/projects/project-form";
import { settingsDialog } from "../../features/settings/settings-form";
import { controlDialog } from "../../features/tasks/controls/control-form";
import { handoffDialog } from "../../features/tasks/controls/handoff-form";
import { permissionDialog } from "../../features/tasks/controls/permission-form";
import type { DialogState } from "../state/types";
import type { DialogDefinition, DialogKind } from "./dialog-definition";

// A new dialog variant fails to compile until it is registered here.
const registry: { [K in DialogKind]: DialogDefinition<K> } = {
  project: projectDialog,
  settings: settingsDialog,
  delegate: delegateDialog,
  control: controlDialog,
  respond: permissionDialog,
  handoff: handoffDialog,
  file: changedFileDialog,
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
