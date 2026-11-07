// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { LookupField } from "./lookup-field";
import { MultiSelectField, SelectField } from "./select-field";

const alpha = {
  value: "/repos/alpha",
  label: "Alpha project",
  description: "Frontend repository",
};

const options = [
  alpha,
  {
    value: "/repos/beta-service",
    label: "Beta project",
    description: "Backend repository",
  },
  {
    value: "/repos/gamma",
    label: "Gamma project",
    description: "Documentation repository",
  },
];

afterEach(cleanup);

function SingleLookup() {
  const [value, setValue] = useState("/repos/alpha");

  return (
    <SelectField
      id="project"
      label="Project"
      searchable
      options={options}
      value={value}
      onValueChange={setValue}
    />
  );
}

function MultipleLookup() {
  const [value, setValue] = useState(["/repos/alpha"]);

  return (
    <>
      <MultiSelectField
        id="dependencies"
        label="Dependencies"
        searchable
        options={options}
        value={value}
        onValueChange={setValue}
      />
      <output aria-label="Selected dependencies">{value.join(",")}</output>
    </>
  );
}

test("lookup finds labels, descriptions and values with trimmed case-insensitive queries", async () => {
  const user = userEvent.setup({ delay: null });

  render(<SingleLookup />);
  await user.click(screen.getByRole("combobox", { name: "Project" }));

  const search = await screen.findByRole("combobox", {
    name: "Search project",
  });

  await user.click(search);
  await user.paste("  BETA PROJECT  ");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option").textContent).toContain("Beta project");

  await user.clear(search);
  await user.paste("documentation");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option").textContent).toContain("Gamma project");

  await user.clear(search);
  await user.paste("beta-service");
  await user.click(screen.getByRole("option"));

  expect(
    screen.getByRole("combobox", { name: "Project" }).textContent,
  ).toContain("Beta project");

  await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
});

test("keyboard search selects an option and returns focus to the trigger", async () => {
  const user = userEvent.setup({ delay: null });

  render(<SingleLookup />);

  const trigger = screen.getByRole("combobox", { name: "Project" });

  trigger.focus();
  await user.keyboard("{Enter}");

  const search = await screen.findByRole("combobox", {
    name: "Search project",
  });

  await waitFor(() => expect(document.activeElement).toBe(search));
  await user.type(search, "Gamma");
  await user.keyboard("{ArrowDown}{Enter}");
  await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
  expect(trigger.textContent).toContain("Gamma project");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("multiple lookup preserves selected dependencies across searches and supports removal", async () => {
  const user = userEvent.setup({ delay: null });

  render(<MultipleLookup />);
  await user.click(screen.getByRole("combobox", { name: "Dependencies" }));

  const search = await screen.findByRole("combobox", {
    name: "Search dependencies",
  });

  await user.click(search);
  await user.paste("Beta");
  await user.click(screen.getByRole("option"));

  expect(screen.getByLabelText("Selected dependencies").textContent).toBe(
    "/repos/alpha,/repos/beta-service",
  );

  await user.clear(search);
  await user.paste("Gamma");
  await user.click(screen.getByRole("option"));

  expect(screen.getByLabelText("Selected dependencies").textContent).toBe(
    "/repos/alpha,/repos/beta-service,/repos/gamma",
  );

  await user.clear(search);
  await user.paste("Alpha");
  expect(screen.getByRole("option").getAttribute("aria-selected")).toBe("true");
  await user.click(screen.getByRole("option"));

  expect(screen.getByLabelText("Selected dependencies").textContent).toBe(
    "/repos/beta-service,/repos/gamma",
  );
});

test("lookup action stays listed while searching and runs without changing the value", async () => {
  const user = userEvent.setup({ delay: null });
  const onSelect = vi.fn();
  const onValueChange = vi.fn();

  render(
    <LookupField
      id="project"
      label="Project"
      itemsLabel="projects"
      options={options}
      value="/repos/alpha"
      onValueChange={onValueChange}
      action={{ label: "Manage projects…", onSelect }}
    />,
  );

  await user.click(screen.getByRole("combobox", { name: "Project" }));

  await user.click(
    await screen.findByRole("combobox", { name: "Search project" }),
  );

  await user.paste("missing project");
  expect(screen.getByText("No matching projects")).toBeTruthy();
  await user.click(screen.getByRole("option", { name: "Manage projects…" }));

  await waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
  expect(onValueChange).not.toHaveBeenCalled();
});

test("refreshing lookup options preserves the search and selected value", async () => {
  const user = userEvent.setup({ delay: null });

  const props = {
    id: "project",
    label: "Project",
    searchable: true,
    value: "/repos/alpha",
    onValueChange: vi.fn(),
  };

  const view = render(<SelectField {...props} options={options} />);

  await user.click(screen.getByRole("combobox", { name: "Project" }));

  const search = await screen.findByRole("combobox", {
    name: "Search project",
  });

  await user.click(search);
  await user.paste("Beta");

  view.rerender(
    <SelectField
      {...props}
      options={[
        ...options,
        { value: "/repos/beta-extra", label: "Beta tools" },
      ]}
    />,
  );

  expect(screen.getByRole("combobox", { name: "Search project" })).toBe(search);
  expect((search as HTMLInputElement).value).toBe("Beta");
  expect(screen.getAllByRole("option")).toHaveLength(2);

  expect(
    screen.getByRole("combobox", { name: "Project" }).textContent,
  ).toContain("Alpha project");

  expect(props.onValueChange).not.toHaveBeenCalled();
});
