import { Collapsible } from "@base-ui/react/collapsible";

import type { MessageAttachment } from "../../../../core/shared/attachments/model.js";
import { Button, buttonClass } from "../../../shared/components/button/button";
import { Chevron } from "../../../shared/components/chevron";
import { Icon } from "../../../shared/components/icons/icons";
import {
  attachmentIcon,
  attachmentOrigin,
  attachmentSize,
  displayTitle,
} from "../../attachments/attachment-display";
import { useOpenAttachment } from "../../attachments/use-open-attachment";

type ActivityAttachmentsProps = {
  taskId: string;
  attachments: MessageAttachment[];
};

/**
 * A message's attachments, folded to a count. Open, each shows its title,
 * origin and size, and the parent agent's summary. An upload's path and
 * summary only repeat its name, so uploads show their size alone.
 */
export function ActivityAttachments({
  taskId,
  attachments,
}: ActivityAttachmentsProps) {
  const open = useOpenAttachment(taskId, attachments);

  return (
    <Collapsible.Root className="activity-attachments">
      <Collapsible.Trigger
        className={buttonClass("text", {
          className: "activity-attachments-toggle",
        })}
      >
        {attachments.length}{" "}
        {attachments.length === 1 ? "attachment" : "attachments"}
        <Chevron size={9} />
      </Collapsible.Trigger>
      <Collapsible.Panel className="collapse-panel">
        <ul className="activity-attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.position}>
              <Icon name={attachmentIcon(attachment)} size={11} />
              <div className="activity-attachment-details">
                <Button
                  variant="text"
                  className="activity-attachment-title"
                  onClick={() => void open(attachment)}
                >
                  {displayTitle(attachment)}
                </Button>
                {attachment.source === "upload" ? (
                  <span className="activity-attachment-origin">
                    {attachmentSize(attachment)}
                  </span>
                ) : (
                  <>
                    <span className="activity-attachment-origin">
                      {attachmentOrigin(attachment)}
                    </span>
                    <p className="activity-attachment-summary">
                      {attachment.summary}
                    </p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
