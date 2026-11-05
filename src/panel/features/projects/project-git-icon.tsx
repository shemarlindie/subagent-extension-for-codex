import { Popover } from "@base-ui/react/popover";

import type { GitState } from "../../../shared/tasks/model";
import { CommandLine } from "../../shared/components/command-line/command-line";
import { Icon } from "../../shared/components/icons/icons";
import { gitInitCommand, gitTag } from "./selectors";

type ProjectGitIconProps = { git?: GitState; folder: string; name: string };

/**
 * A muted icon for a project with no commit. The note it opens is a popover,
 * so its command can be copied and touch screens can open it.
 */
export function ProjectGitIcon({ git, folder, name }: ProjectGitIconProps) {
  const tag = gitTag(git);
  if (!tag) return null;

  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={250}
        className="text-button muted project-git-icon"
        aria-label={`${tag} in ${name}`}
      >
        <Icon name={git === "none" ? "git-off" : "git-commit-off"} size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="tooltip-positioner" sideOffset={6}>
          <Popover.Popup
            className="tooltip-popup project-git-note"
            initialFocus={false}
          >
            {git === "none" ? (
              <>
                <p>
                  No Git repository. Tasks edit this folder directly, with no
                  worktrees or Git undo. Edits made by commands may not be
                  recorded.
                </p>
                <CommandLine
                  label="Set up Git"
                  command={gitInitCommand(folder)}
                />
              </>
            ) : (
              <p>
                No commits yet. Worktrees need a commit, so tasks edit this
                repository directly.
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
