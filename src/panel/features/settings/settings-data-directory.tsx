import { useController } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";

type SettingsDataDirectoryProps = {
  path: string;
  platform: string;
};

const FILE_MANAGER_LABELS: Partial<Record<string, string>> = {
  darwin: "Show in Finder",
  win32: "Open in File Explorer",
};

export function SettingsDataDirectory({
  path,
  platform,
}: SettingsDataDirectoryProps) {
  const controller = useController();
  const label = FILE_MANAGER_LABELS[platform] ?? "Open in file manager";

  return (
    <div className="settings-about-action-row">
      <dt>Data directory</dt>
      <dd className="settings-about-action-value">
        <span>{path}</span>
        <TooltipWrapper label={label}>
          <Button
            variant="ghost"
            className="settings-about-action-button"
            data-muted
            onClick={() =>
              controller.run(() => controller.tool("app_open_data_directory"))
            }
          >
            <Icon name="external-link" size={11} />
          </Button>
        </TooltipWrapper>
      </dd>
    </div>
  );
}
