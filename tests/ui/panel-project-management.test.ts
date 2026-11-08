// @vitest-environment jsdom
import { expect } from "vitest";

import {
  act,
  pasteText,
  screen,
  setup,
  setupProjects,
  test,
  waitFor,
  within,
} from "./panel-test-support";

async function openManage(user: Awaited<ReturnType<typeof setup>>["user"]) {
  await user.click(screen.getByRole("combobox", { name: "Project scope" }));

  await user.click(
    await screen.findByRole("option", { name: "Manage projects…" }),
  );

  await screen.findByRole("heading", { name: "Projects" });
}

test("project rename drafts survive refresh and failure until a retry succeeds", async (t) => {
  const { controller, transport, user } = await setupProjects(t);
  const original = transport.tool.bind(transport);
  let failRename = true;

  transport.tool = async <T>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    if (name === "app_rename_project") {
      transport.calls.push({ name, args });
      if (failRename) throw new Error("Rename failed");

      transport.projects = transport.projects.map((project) => ({
        ...project,
        name: String(args.name).trim(),
      }));

      return { name: String(args.name).trim() } as T;
    }

    return original<T>(name, args);
  };

  await user.click(
    screen.getByRole("button", { name: "Edit project name: a" }),
  );

  const input = screen.getByRole("textbox", { name: "Project name" });
  await user.clear(input);
  await pasteText(user, input, "New name");
  await act(() => controller.refresh());
  expect((input as HTMLInputElement).value).toBe("New name");
  await user.keyboard("{Enter}");
  await screen.findByRole("alert");
  expect((input as HTMLInputElement).value).toBe("New name");
  failRename = false;
  await user.keyboard("{Enter}");
  await screen.findByRole("button", { name: "Remove New name" });
});

test("Manage cancels edit errors and restores focus when returning from Add", async (t) => {
  const { transport, user } = await setup(t);
  const original = transport.tool.bind(transport);

  transport.tool = async <T>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    if (name === "app_rename_project") throw new Error("Rename failed");

    return original<T>(name, args);
  };

  await openManage(user);

  await user.click(
    screen.getByRole("button", { name: "Edit project name: a" }),
  );

  await pasteText(
    user,
    screen.getByRole("textbox", { name: "Project name" }),
    " changed",
  );

  await user.keyboard("{Enter}");
  await screen.findByRole("alert");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Remove a" }));
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Add project" }));

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Folder path" }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Close" }));

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add project" }),
    ),
  );
});

test("a picker finishing after leaving Add cannot replace a new draft", async (t) => {
  const { transport, user } = await setupProjects(t);
  let resolve!: (value: { repository: string }) => void;

  const picked = new Promise<{ repository: string }>((done) => {
    resolve = done;
  });

  const original = transport.tool.bind(transport);

  transport.tool = async <T>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> =>
    name === "app_browse_project"
      ? ((await picked) as T)
      : original<T>(name, args);

  await user.click(screen.getByRole("button", { name: "Add project" }));
  await user.click(screen.getByRole("button", { name: "Browse…" }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Add project" }));
  const input = screen.getByRole("textbox", { name: "Folder path" });
  await pasteText(user, input, "/new-draft");

  await act(async () => {
    resolve({ repository: "/late-picker" });
    await picked;
  });

  expect((input as HTMLInputElement).value).toBe("/new-draft");
});

test("Manage opens a page and Back restores task selection, filters and focus", async (t) => {
  const { controller, user } = await setup(t);
  const selected = controller.getSnapshot().selected;
  await act(async () => controller.setSearch("Review"));
  const search = controller.getSnapshot().search;
  await openManage(user);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("region", { name: "Selected task" })).toBeNull();

  expect(
    screen.queryByRole("separator", { name: "Resize task list" }),
  ).toBeNull();

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Projects" }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Tasks" }));
  expect(controller.getSnapshot().selected).toBe(selected);
  expect(controller.getSnapshot().search).toBe(search);

  expect(document.activeElement).toBe(
    screen.getByRole("combobox", { name: "Project scope" }),
  );
});

test("removal uses a focused modal, explains folder retention, and resets the optional choice", async (t) => {
  const { user } = await setup(t);
  await openManage(user);
  await user.click(screen.getByRole("button", { name: "Remove a" }));
  const modal = screen.getByRole("dialog", { name: "Remove project?" });

  expect(modal.textContent).toContain(
    "Your folder, task data and provider sessions stay.",
  );

  expect(modal.textContent?.toLowerCase()).not.toContain("delete");
  expect(modal.textContent).not.toContain("through an approved parent folder");

  await user.click(
    within(modal).getByRole("switch", {
      name: "Also remove extension task data",
    }),
  );

  await user.click(within(modal).getByRole("button", { name: "Cancel" }));

  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove a" }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Remove a" }));

  expect(
    screen
      .getByRole("switch", { name: "Also remove extension task data" })
      .getAttribute("aria-checked"),
  ).toBe("false");
});

test("removal explains remaining parent registration only when it covers the project", async (t) => {
  const { user } = await setupProjects(t, (transport) => {
    transport.projects.push(
      { repository: "/repo", kind: "parent", name: "Repositories" },
      { repository: "/repo-other", kind: "parent", name: "Other" },
    );
  });

  await user.click(screen.getByRole("button", { name: "Remove a" }));

  expect(screen.getByRole("dialog").textContent).toContain(
    "This project may still be registered through an approved parent folder.",
  );

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Remove Repositories" }));

  expect(screen.getByRole("dialog").textContent).not.toContain(
    "through an approved parent folder",
  );
});
