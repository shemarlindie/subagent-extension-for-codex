import { useController } from "../components/controller-context";
import type { ReactNode } from "react";
import { FormFooter } from "./form-footer";
import { defineDialog } from "./dialog-definition";

function InfoForm({ children }: { children: ReactNode }) {
  const controller = useController();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void controller.submit(async () => {});
      }}
    >
      {children}
      <FormFooter label="Done" />
    </form>
  );
}

export const workspaceDialog = defineDialog<"workspace">({
  title: () => "Task workspace",
  render: ({ task }) => (
    <InfoForm>
      <p>
        {task.workspace_strategy === "current_repo"
          ? "This task uses the current repository. Worker edits are already present in this checkout."
          : "The worktree is retained for inspection and session continuation."}
      </p>
      <pre>{task.workspace ?? "Not created yet"}</pre>
    </InfoForm>
  ),
});

export const artifactDialog = defineDialog<"artifact">({
  title: ({ artifact }) => artifact.title,
  render: ({ artifact }) => (
    <InfoForm>
      <pre>{artifact.content}</pre>
    </InfoForm>
  ),
});
