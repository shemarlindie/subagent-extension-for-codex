import type { CSSProperties, Ref } from "react";

import animatedGlyph from "../../../../../assets/brand/brand-glyph-animated.svg?raw";
import { useSnapshot } from "../../../app/state/controller-context";
import type { NewTaskState } from "../../../app/state/types";
import { THREAD_TASK_NOTE } from "../delegation";
import { NewTaskComposer } from "./new-task-composer";

const glyphSource = `data:image/svg+xml,${encodeURIComponent(animatedGlyph)}`;

// Masking the animated glyph lets it take the empty state's dimmed text color.
const glyphStyle = {
  "--new-task-glyph": `url("${glyphSource}")`,
} as CSSProperties;

type NewTaskViewProps = {
  newTask: NewTaskState;
  viewRef?: Ref<HTMLDivElement>;
};

/**
 * The inspector while composing: Chat's panel without the task header or
 * tabs. The composer sits where Chat's will, and the header and tabs ease in
 * once the task starts.
 */
export function NewTaskView({ newTask, viewRef }: NewTaskViewProps) {
  const threadMode = useSnapshot((state) => Boolean(state.conversation));

  return (
    <div ref={viewRef} className="task-view new-task-view">
      <div className="evidence">
        <div className="chat-panel">
          <div className="chat">
            <div className="chat-timeline new-task-empty">
              <span
                className="empty-icon new-task-glyph"
                style={glyphStyle}
                aria-hidden="true"
              />
              <p className="new-task-prompt">What would you like to work on?</p>
              {threadMode && <p>{THREAD_TASK_NOTE}</p>}
            </div>
            <div className="chat-footer">
              <NewTaskComposer newTask={newTask} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
