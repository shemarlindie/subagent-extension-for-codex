import { Menu } from "@base-ui/react/menu";

import { useController } from "../../../app/state/controller-context";
import { buttonClass } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { ProjectArchiveItems } from "../archive/project-archive-items";

type ProjectGroupMenuProps = {
  repository: string;
  name: string;
};

/** A project group's header menu: narrow the list to the project, or archive its tasks. */
export function ProjectGroupMenu({ repository, name }: ProjectGroupMenuProps) {
  const controller = useController();

  return (
    <Menu.Root>
      <Menu.Trigger
        className={buttonClass("ghost", {
          className: "task-group-menu",
        })}
        aria-label={`Actions for ${name}`}
      >
        <Icon name="more-horizontal" size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" align="end" sideOffset={2}>
          <Menu.Popup className="menu-popup">
            <Menu.Item
              className="menu-item"
              data-action="show-project"
              onClick={() =>
                controller.run(() => controller.changeProject(repository))
              }
            >
              Show only this project
            </Menu.Item>
            <Menu.Separator className="menu-separator" />
            <ProjectArchiveItems repository={repository} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
