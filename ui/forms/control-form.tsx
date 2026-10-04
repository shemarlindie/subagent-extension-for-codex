import { useForm } from "react-hook-form";
import type { DialogState, Task } from "../core/types";
import { useController } from "../components/controller-context";
import { Field } from "./fields";
import { FormFooter } from "./form-footer";
import { TaskDescription } from "../components/task-description";
export function controlTitle(action: string) {
  return (
    (
      {
        steer: "Steer task",
        continue: "Continue task",
        cancel: "Cancel task?",
        retry: "Start a new attempt?",
        interrupt: "Interrupt task?",
      } as Record<string, string>
    )[action] ?? "Task action"
  );
}
export function ControlForm({
  dialog,
}: {
  dialog: Extract<DialogState, { kind: "control" }>;
}) {
  const controller = useController(),
    { action, task } = dialog;
  const { register, handleSubmit } = useForm<{ instruction: string }>();
  const instruction = action === "steer" || action === "continue";
  const descriptions: Record<string, string> = {
    steer:
      "A running turn will be interrupted and continued with your instruction.",
    continue: "Continue in the existing workspace and native session.",
    cancel: "Stop this task. Its workspace and artifacts will be retained.",
    retry:
      "Create another task from the original request. This starts a new worker attempt with the original budgets.",
    interrupt:
      "Stop current execution and preserve the workspace and session for continuation.",
  };
  const labels: Record<string, string> = {
    steer: "Send instruction",
    continue: "Continue",
    cancel: "Cancel task",
    retry: "Start new attempt",
    interrupt: "Interrupt",
  };
  const tools: Record<string, string> = {
    steer: "send_agent_instruction",
    continue: "continue_agent_task",
    cancel: "cancel_agent_task",
    retry: "retry_agent_task",
    interrupt: "interrupt_agent_task",
  };
  return (
    <form
      onSubmit={handleSubmit((values) =>
        controller.submit(
          () =>
            controller.tool<Task>(tools[action], {
              task_id: task.id,
              ...(values.instruction?.trim()
                ? { message: values.instruction }
                : {}),
            }),
          action === "retry",
        ),
      )}
    >
      <p className="form-note">{descriptions[action]}</p>
      {instruction ? (
        <Field
          id="instruction"
          label={
            action === "steer" ? "New instruction" : "Instruction (optional)"
          }
        >
          <textarea
            id="instruction"
            maxLength={20000}
            required={action === "steer"}
            {...register("instruction", { required: action === "steer" })}
          />
        </Field>
      ) : (
        <>
          <p>{task.title}</p>
          <TaskDescription
            task={task}
            defaultOpen={action === "interrupt" || action === "cancel"}
          />
        </>
      )}
      <FormFooter label={labels[action]} />
    </form>
  );
}
