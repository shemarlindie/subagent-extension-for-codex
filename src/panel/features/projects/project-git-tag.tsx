import { Popover } from "@base-ui/react/popover";

import { CommandLine } from "../changes/command-line";
import { gitInitCommand, gitTag } from "./selectors";
import type { ProjectGit } from "./types";

type ProjectGitTagProps = { git?: ProjectGit; folder: string };

/**
 * A muted tag for a project with no commit. The note it opens is a popover,
 * so its command can be copied and touch screens can open it.
 */
export function ProjectGitTag({ git, folder }: ProjectGitTagProps) {
  const tag = gitTag(git);
  if (!tag) return null;

  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={250}
        className="text-button muted project-git-tag"
      >
        {tag}
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
                  Tasks edit this folder directly, with no worktrees or Git
                  undo. Edits made by commands may not be recorded.
                </p>
                <CommandLine
                  label="Set up Git"
                  command={gitInitCommand(folder)}
                />
              </>
            ) : (
              <p>
                Worktrees need a commit, so tasks edit this repository directly.
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
