import { Collapsible } from "@base-ui/react/collapsible";
import { useEffect, useId, useRef, useState } from "react";

import { inputPresentation } from "../../../../shared/providers/input-presentation.js";
import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { Notice } from "../../../shared/components/notice/notice";
import { PermissionInputDetails } from "./permission-input-details";

export function InlinePermissionRequest({ task }: { task: Task }) {
  const controller = useController();
  const busy = useSnapshot((state) => state.busy);
  const request = task.pending_input!;
  const presentation = inputPresentation(request);
  const titleId = useId();
  const [message, setMessage] = useState("");
  const [messageOpen, setMessageOpen] = useState(false);
  const messageInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!messageOpen) return;

    // Wait until Base UI has expanded the panel before moving focus into it.
    const frame = requestAnimationFrame(() => messageInput.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, [messageOpen]);

  const decide = (approved: boolean) => () =>
    void (async () => {
      setError(undefined);

      const failure = await controller.taskActions.decidePermission(
        task,
        approved,
        message,
      );

      if (failure) setError(failure);
    })();

  return (
    <Notice className="permission-request">
      <form
        className="permission-request-form"
        aria-labelledby={titleId}
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="permission-request-heading">
          <h3 id={titleId}>
            <code>{request.tool}</code>
          </h3>
          <span className="permission-request-label">Permission request</span>
        </div>
        {request.presentation?.description &&
          request.presentation.description !== request.input.description && (
            <p className="permission-request-description">
              {presentation.description}
            </p>
          )}
        <PermissionInputDetails input={request.input} />
        <Collapsible.Root
          className="permission-message"
          open={messageOpen}
          onOpenChange={setMessageOpen}
        >
          <Collapsible.Trigger className="permission-message-trigger">
            <span>Add a message</span>
            <Icon
              name="chevron-down"
              size={10}
              className="permission-message-chevron"
            />
          </Collapsible.Trigger>
          <Collapsible.Panel className="collapse-panel" keepMounted>
            <div className="permission-message-content">
              <input
                ref={messageInput}
                type="text"
                className="permission-message-input"
                aria-label="Optional message to worker"
                placeholder="Message to worker"
                maxLength={20000}
                value={message}
                onChange={(event) => setMessage(event.currentTarget.value)}
              />
            </div>
          </Collapsible.Panel>
        </Collapsible.Root>
        {error && (
          <div className="form-error error" role="alert">
            {error}
          </div>
        )}
        <footer className="permission-actions">
          <Button disabled={busy} onClick={decide(false)}>
            Deny
          </Button>
          <Button variant="primary" disabled={busy} onClick={decide(true)}>
            {presentation.approveLabel}
          </Button>
        </footer>
      </form>
    </Notice>
  );
}
