import { useController } from "../../shared/state/controller-context";
import { CopyButton } from "../file-preview/components/copy-button";

type CommandLineProps = {
  label: string;
  command: string;
};

/**
 * A command to run in a terminal. It selects as a whole on click; Copy shows
 * only where the browser grants clipboard access, as in file previews.
 */
export function CommandLine({ label, command }: CommandLineProps) {
  const controller = useController(),
    canCopy =
      !controller.transport.embedded &&
      typeof navigator.clipboard?.writeText === "function";

  return (
    <div className="command-line">
      <span className="command-label">{label}</span>
      <code className="command">{command}</code>
      {canCopy && <CopyButton text={command} />}
    </div>
  );
}
