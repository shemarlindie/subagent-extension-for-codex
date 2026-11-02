import { useContext, useEffect, useState } from "react";

import { ControllerContext } from "../../../app/state/controller-context";
import type { Event } from "../../../app/state/types";
import { JsonTree } from "../../../shared/components/json-tree/json-tree";

type OriginalResponseResult = { available: boolean; original?: unknown };

interface OriginalResponseDetailsProps {
  event: Event;
}

/** Mounted only while details are open. Cleanup drops ownership of late replies. */
export function OriginalResponseDetails({
  event,
}: OriginalResponseDetailsProps) {
  const controller = useContext(ControllerContext);
  const [result, setResult] = useState<OriginalResponseResult>();
  const responseRef = event.data.response_ref;
  const taskId = event.task_id;

  useEffect(() => {
    let active = true;

    controller?.transport
      .tool<OriginalResponseResult>("app_get_original_response", {
        task_id: taskId,
        response_ref: responseRef,
      })
      .then(
        (value) => {
          if (active) setResult(value);
        },
        () => {
          if (active) setResult({ available: false });
        },
      );

    return () => {
      active = false;
    };
  }, [controller, taskId, responseRef]);

  let content = <p className="muted">Loading original response…</p>;

  if (result) {
    content = result.available ? (
      <JsonTree value={result.original} />
    ) : (
      <p className="muted">Original response unavailable.</p>
    );
  }

  return (
    <section aria-label="Original response">
      <strong>Original response</strong>
      {content}
    </section>
  );
}
