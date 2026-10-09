import { CopyButton } from "../file-preview/components/copy-button";

type CommandLineProps = {
  label: string;
  command: string;
};

/** A complete value to copy, with a compact action and whole-value selection. */
export function CommandLine({ label, command }: CommandLineProps) {
  return (
    <div className="command-line">
      <span className="command-label">{label}</span>
      <div className="command-value">
        <code className="command">{command}</code>
        <CopyButton
          text={command}
          label={`Copy ${label.toLowerCase()}`}
          iconOnly
        />
      </div>
    </div>
  );
}
