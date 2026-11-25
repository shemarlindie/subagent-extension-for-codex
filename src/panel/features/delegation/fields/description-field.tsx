import { memo } from "react";
import type { UseFormReturn } from "react-hook-form";

import { useSnapshot } from "../../../app/state/controller-context";
import { Field } from "../../../shared/forms/fields";
import { AttachFilesButton } from "../../attachments/attach-files-button";
import { DraftAttachments } from "../../attachments/draft-attachments";
import { useDraftFiles } from "../../attachments/use-draft-files";
import type { DelegateValues } from "../delegate-values";
import { newTaskSessionId } from "../new-task/new-task-values";

type DescriptionFieldProps = {
  form: UseFormReturn<DelegateValues>;
  disabled: boolean;
};

/**
 * The task's first message and its files, chosen below it or dropped or
 * pasted into it.
 */
export const DescriptionField = memo(function DescriptionField({
  form: { register },
  disabled,
}: DescriptionFieldProps) {
  const conversation = useSnapshot((state) => state.conversation);

  const attachments = useDraftFiles(
    "delegate",
    newTaskSessionId(conversation),
    disabled,
  );

  return (
    <Field id="description" label="Description">
      <textarea
        id="description"
        required
        maxLength={20000}
        placeholder="Review the authentication boundary. Cite findings with file paths and suggest next steps."
        {...register("description", { required: true })}
        {...attachments.dropTarget}
      />
      <div className="description-files">
        <AttachFilesButton
          labelled
          disabled={disabled}
          onFiles={attachments.add}
        />
        <DraftAttachments
          attachments={attachments}
          disabled={disabled}
          previewable={false}
        />
      </div>
    </Field>
  );
});
