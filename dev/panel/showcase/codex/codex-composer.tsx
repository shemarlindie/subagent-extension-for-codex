import { CodexIcon } from "./codex-icon";

const MODEL = "GPT-6.1 Sol";
const EFFORT = "Medium";

type CodexComposerProps = { working: boolean };

/** Codex's composer, showing its stop button while Codex works. */
export function CodexComposer({ working }: CodexComposerProps) {
  return (
    <div className="codex-composer">
      <div className="codex-composer-input">Work with Codex</div>
      <div className="codex-composer-bar">
        <CodexIcon name="plus" />
        <span className="codex-composer-approve">
          <CodexIcon name="shield" />
          Approve for me
        </span>
        <span className="codex-composer-spacer" />
        {working && <span className="codex-spinner" aria-hidden="true" />}
        <span className="codex-composer-model">
          {MODEL} <span>{EFFORT}</span>
        </span>
        <CodexIcon name="mic" />
        <span className={`codex-composer-send${working ? " stop" : ""}`}>
          {!working && <CodexIcon name="send" />}
        </span>
      </div>
    </div>
  );
}
