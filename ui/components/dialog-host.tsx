import { useRef } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useController, useSnapshot } from "./controller-context";
import { ProjectForm } from "../forms/project-form";
import { SettingsForm } from "../forms/settings-form";
import { DelegateForm } from "../forms/delegate-form";
import { ControlForm, controlTitle } from "../forms/control-form";
import { QuestionForm } from "../forms/question-form";
import { PermissionForm } from "../forms/permission-form";
import { HandoffForm } from "../forms/handoff-form";
import { FormFooter } from "../forms/form-footer";
import { useAnimatedHeight } from "./motion";
import { buttonClass } from "./button";
export function DialogHost({ suspended = false }: { suspended?: boolean }) {
  const controller = useController(),
    state = useSnapshot(),
    // The closing animation keeps showing the last dialog rather than an empty box.
    lastDialog = useRef(state.dialog);
  if (state.dialog) lastDialog.current = state.dialog;
  const dialog = state.dialog ?? lastDialog.current;
  const trigger = useRef<HTMLElement | null>(null),
    openedScope = useRef(0),
    popup = useRef<HTMLDivElement>(null);
  // Switching forms or showing an error eases the height instead of snapping it.
  useAnimatedHeight(popup, `${dialog?.kind}:${state.formError ?? ""}`);
  const title = !dialog
    ? ""
    : dialog.kind === "project"
      ? "Add project"
      : dialog.kind === "settings"
        ? "Plugin settings"
        : dialog.kind === "delegate"
          ? "New delegated task"
          : dialog.kind === "control"
            ? controlTitle(dialog.action)
            : dialog.kind === "respond"
              ? dialog.task.pending_input?.tool === "AskUserQuestion"
                ? "Respond to worker"
                : "Review permission request"
              : dialog.kind === "handoff"
                ? "Bring task to Codex"
                : dialog.kind === "artifact"
                  ? dialog.artifact.title
                  : "Task workspace";
  return (
    // Host collapse hides the modal; keeping its contents mounted retains drafts.
    <Dialog.Root
      open={Boolean(state.dialog) && !suspended}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (state.busy) details.cancel();
        else if (!open) controller.dismiss();
      }}
    >
      <Dialog.Portal keepMounted={Boolean(state.dialog)}>
        <Dialog.Backdrop className="dialog-overlay" />
        <Dialog.Popup
          ref={popup}
          id="dialog"
          className="dialog"
          aria-describedby={undefined}
          initialFocus={() => {
            trigger.current = document.activeElement as HTMLElement | null;
            openedScope.current = dialog?.scope ?? 0;
            return dialog?.kind === "delegate" && dialog.repository
              ? document.getElementById("description")
              : true;
          }}
          finalFocus={() =>
            suspended
              ? document.getElementById("open-panel")
              : openedScope.current === controller.getSnapshot().scopeVersion &&
                  trigger.current?.isConnected
                ? trigger.current
                : document.getElementById("delegate")
          }
        >
          <div className="dialog-heading">
            <Dialog.Title id="dialog-title">{title}</Dialog.Title>
            <Dialog.Close
              type="button"
              className={buttonClass("ghost", { className: "dialog-close" })}
              aria-label="Close"
              disabled={state.busy}
            >
              ×
            </Dialog.Close>
          </div>
          {dialog?.kind === "project" ? (
            <ProjectForm dialog={dialog} />
          ) : dialog?.kind === "settings" ? (
            <SettingsForm dialog={dialog} />
          ) : dialog?.kind === "delegate" ? (
            <DelegateForm dialog={dialog} />
          ) : dialog?.kind === "control" ? (
            <ControlForm dialog={dialog} />
          ) : dialog?.kind === "respond" ? (
            dialog.task.pending_input?.tool === "AskUserQuestion" ? (
              <QuestionForm task={dialog.task} />
            ) : (
              <PermissionForm task={dialog.task} />
            )
          ) : dialog?.kind === "handoff" ? (
            <HandoffForm task={dialog.task} />
          ) : (
            dialog && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void controller.submit(async () => {});
                }}
              >
                {dialog.kind === "artifact" ? (
                  <pre>{dialog.artifact.content}</pre>
                ) : (
                  dialog.kind === "workspace" && (
                    <>
                      <p>
                        {dialog.task.workspace_strategy === "current_repo"
                          ? "This task uses the current repository. Worker edits are already present in this checkout."
                          : "The worktree is retained for inspection and session continuation."}
                      </p>
                      <pre>{dialog.task.workspace ?? "Not created yet"}</pre>
                    </>
                  )
                )}
                <FormFooter label="Done" />
              </form>
            )
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
