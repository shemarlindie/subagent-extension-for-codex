import type { PathSymlink } from "../../../../shared/filesystem/path-contract.js";
import { Icon } from "../../../shared/components/icons/icons";
import { Infotip } from "../../../shared/components/infotip";

type TaskDeletionPathProps = {
  path: string;
  symlinks?: PathSymlink[];
};

export function TaskDeletionPath({ path, symlinks }: TaskDeletionPathProps) {
  return (
    <span className="task-deletion-path">
      <code>{path}</code>
      {!!symlinks?.length && (
        <Infotip
          triggerLabel={`Symbolic links for ${path}`}
          label={
            <div className="task-deletion-path-note">
              <p>This path passes through symbolic links.</p>
              {symlinks.map((link) => (
                <dl key={link.path}>
                  <dt>Symbolic link</dt>
                  <dd>
                    <code>{link.path}</code>
                  </dd>
                  <dt>Resolved target</dt>
                  <dd>
                    <code>{link.target}</code>
                  </dd>
                </dl>
              ))}
            </div>
          }
        >
          <button type="button" className="text-button task-deletion-path-info">
            <Icon name="info" size={13} />
          </button>
        </Infotip>
      )}
    </span>
  );
}
