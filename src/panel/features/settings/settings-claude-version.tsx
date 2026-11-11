import { Collapsible } from "@base-ui/react/collapsible";
import type { MouseEvent } from "react";

import type { AboutInfo, ClaudeUpgradeInfo } from "../../../shared/about/types";
import type { ProviderReadiness } from "../../../shared/providers/types";
import { useController } from "../../app/state/controller-context";
import { Button, buttonClass } from "../../shared/components/button/button";
import { CommandLine } from "../../shared/components/command-line/command-line";
import { Icon } from "../../shared/components/icons/icons";
import { LoadingSpinner } from "../../shared/components/loading-spinner/loading-spinner";
import { TooltipWrapper } from "../../shared/components/tooltip";

type SettingsClaudeVersionProps = {
  version: string;
  readiness?: ProviderReadiness;
  recommended?: AboutInfo["claude_recommended"];
  upgrade?: ClaudeUpgradeInfo;
  pending: boolean;
  error?: string;
  onRecheck: () => void;
};

function upgradeTooltip(
  tooOld: boolean,
  recommended: SettingsClaudeVersionProps["recommended"],
  current: boolean,
) {
  if (tooOld) return "Claude Code is too old. Show upgrade instructions";

  if (recommended?.behind) {
    return `Claude Code ${recommended.version} or later is recommended. Show upgrade instructions`;
  }

  if (current) return "Recommended Claude Code version installed";

  return "Show upgrade instructions";
}

function upgradeIcon(tooOld: boolean, current: boolean) {
  if (tooOld) return "alert-triangle";

  return current ? "check-circle" : "arrow-up-circle";
}

export function SettingsClaudeVersion({
  version,
  readiness,
  recommended,
  upgrade,
  pending,
  error,
  onRecheck,
}: SettingsClaudeVersionProps) {
  const controller = useController();
  const tooOld = readiness?.details.problem === "too_old";

  const current = Boolean(
    readiness?.ready && recommended && !recommended.behind,
  );

  function openInstructions(event: MouseEvent<HTMLAnchorElement>) {
    if (!controller.transport.openLink) return;
    event.preventDefault();
    const url = event.currentTarget.href;

    controller.run(async () => {
      await controller.transport.openLink?.(url);
    });
  }

  return (
    <Collapsible.Root className="settings-about-action-row">
      <dt>Claude Code CLI</dt>
      <dd className="settings-about-action-value">
        <span>{version}</span>
        {pending && <LoadingSpinner />}
        <TooltipWrapper
          label={upgradeTooltip(tooOld, recommended, current)}
          triggerLabel={
            tooOld ? "CLI upgrade required" : "CLI upgrade instructions"
          }
        >
          <Collapsible.Trigger
            className={buttonClass("ghost", {
              className:
                "settings-about-action-button settings-cli-upgrade-trigger",
            })}
            data-warning={tooOld || undefined}
            data-muted={current || undefined}
          >
            <Icon name={upgradeIcon(tooOld, current)} size={13} />
          </Collapsible.Trigger>
        </TooltipWrapper>
      </dd>
      <Collapsible.Panel
        render={<dd />}
        className="settings-cli-upgrade-panel collapse-panel"
      >
        <div className="settings-claude-upgrade">
          {readiness?.message && (
            <p className="settings-about-readiness">{readiness.message}</p>
          )}
          {upgrade && (
            <>
              {upgrade.command && (
                <CommandLine label="Upgrade" command={upgrade.command} />
              )}
              <p>
                {upgrade.note} See the{" "}
                <a
                  href="https://code.claude.com/docs/en/setup#update-claude-code"
                  target="_blank"
                  rel="noreferrer"
                  onClick={openInstructions}
                >
                  Claude Code update instructions
                </a>
                .
              </p>
            </>
          )}
          <Button
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={onRecheck}
          >
            {pending ? "Checking…" : "Recheck version"}
          </Button>
          {error && (
            <p className="form-error" role="alert">
              Couldn't recheck the CLI. {error}
            </p>
          )}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
