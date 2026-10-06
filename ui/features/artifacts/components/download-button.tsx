import { Button } from "../../../shared/components/button";
import { Icon } from "../../../shared/components/icons";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import type { ArtifactSummary } from "../../../shared/state/types";

type DownloadButtonProps = {
  summary: ArtifactSummary;
  variant?: "ghost" | "default";
  label?: string;
};

export function DownloadButton({
  summary,
  variant = "ghost",
  label,
}: DownloadButtonProps) {
  const controller = useController(),
    state = useSnapshot();

  if (!state.host.canDownload) return null;
  const name = `Download ${summary.file_name}`;

  const button = (
    <Button
      variant={variant}
      className={label ? "file-action" : "toolbar-icon-button"}
      aria-label={label ? undefined : name}
      data-download={summary.id}
      onClick={() => controller.run(() => controller.download(summary))}
    >
      <Icon name="download" size={14} />
      {label}
    </Button>
  );

  return label ? (
    button
  ) : (
    <TooltipWrapper label={name}>{button}</TooltipWrapper>
  );
}
