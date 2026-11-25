import { useRef, type ChangeEvent } from "react";

import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";

type AttachFilesButtonProps = {
  disabled: boolean;
  /** A form shows the action's name, where a composer's toolbar shows its icon. */
  labelled?: boolean;
  onFiles: (files: File[]) => void;
};

/** Opens the file chooser for a composer's or form's attachments. */
export function AttachFilesButton({
  disabled,
  labelled = false,
  onFiles,
}: AttachFilesButtonProps) {
  const input = useRef<HTMLInputElement>(null);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    onFiles(Array.from(event.target.files ?? []));
    // The same file can be chosen again after its chip is removed.
    event.target.value = "";
  }

  return (
    <>
      <input hidden type="file" multiple ref={input} onChange={choose} />
      {labelled ? (
        <Button
          variant="text"
          className="attach-files-text"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Icon name="paperclip" size={11} />
          Attach files
        </Button>
      ) : (
        <TooltipWrapper label="Attach files">
          <Button
            variant="ghost"
            className="chat-icon-button"
            aria-label="Attach files"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <Icon name="paperclip" size={12} />
          </Button>
        </TooltipWrapper>
      )}
    </>
  );
}
