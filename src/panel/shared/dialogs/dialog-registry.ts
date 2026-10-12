import type { DialogState } from "../../app/state/types";
import { changedFileDialog } from "../../features/changes/changed-file-preview";
import { worktreeDialog } from "../../features/changes/worktree-form";
import {
  delegateDialog,
  delegateLoadingDialog,
} from "../../features/delegation/delegate-form";
import { projectDialog } from "../../features/projects/project-form";
import { removeProjectDialog } from "../../features/projects/remove-project-form";
import {
  settingsDialog,
  settingsLoadingDialog,
} from "../../features/settings/settings-form";
import { deleteTaskDialog } from "../../features/tasks/controls/delete-task-form";
import { handoffDialog } from "../../features/tasks/controls/handoff-form";
import { permissionDialog } from "../../features/tasks/controls/permission-form";
import type { DialogDefinition, DialogKind } from "./dialog-definition";

// A new dialog variant fails to compile until it is registered here.
const registry: { [K in DialogKind]: DialogDefinition<K> } = {
  "remove-project": removeProjectDialog,
  project: projectDialog,
  settings: settingsDialog,
  "settings-loading": settingsLoadingDialog,
  delegate: delegateDialog,
  "delegate-loading": delegateLoadingDialog,
  respond: permissionDialog,
  handoff: handoffDialog,
  delete: deleteTaskDialog,
  file: changedFileDialog,
  worktree: worktreeDialog,
};

/** Looks up by the dialog's kind, which TypeScript cannot correlate with the entry. */
export function dialogDefinition(dialog: DialogState) {
  return registry[dialog.kind] as unknown as DialogDefinition<DialogKind>;
}
