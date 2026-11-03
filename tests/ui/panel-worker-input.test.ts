// @vitest-environment jsdom
import { expect } from "vitest";

import {
  act,
  assert,
  assertAbsent,
  pasteText,
  screen,
  setup,
  setupInspector,
  SKIPPED_ANSWER,
  test,
  waitFor,
} from "./panel-test-support";

test("worker question accepts a custom answer with no preset selection", async (t) => {
  const { transport, user } = await setupInspector(t, (transport) => {
    const [current] = transport.tasks;

    assert.ok(current);

    current.pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          { question: "Which approach?", options: [{ label: "Preset" }] },
        ],
      },
    };
  });

  // Questions show their choices directly, without a notice or dialog.
  assertAbsent(screen.queryByRole("button", { name: /Claude has a question/ }));
  assertAbsent(screen.getByText("Which approach?").closest(".notice"));
  assertAbsent(screen.queryByRole("dialog"));
  assertAbsent(screen.queryByRole("textbox", { name: "Message" }));
  await user.click(screen.getByRole("button", { name: "Show composer" }));
  const collapse = screen.getByRole("button", { name: "Hide composer" });

  await user.click(collapse);
  assertAbsent(screen.queryByRole("textbox", { name: "Message" }));

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Show composer" }),
  );

  await user.click(screen.getByRole("radio", { name: "Preset" }));

  await pasteText(
    user,
    screen.getByLabelText("Write your own answer"),
    "Custom approach",
  );

  // A typed answer replaces the single choice.
  assert.equal(
    screen.getByRole<HTMLInputElement>("radio", { name: "Preset" }).checked,
    false,
  );

  await user.click(screen.getByRole("button", { name: "Respond" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "submit_input").length,
      1,
    ),
  );

  assert.deepEqual(
    transport.calls.find((call) => call.name === "submit_input")?.args,
    {
      task_id: "one",
      request_id: "request",
      approved: true,
      input: {
        questions: [
          { question: "Which approach?", options: [{ label: "Preset" }] },
        ],
        answers: { "Which approach?": "Custom approach" },
      },
    },
  );
});

test("a question without options answers in a text box and shows send failures inline", async (t) => {
  const { transport, user } = await setupInspector(t, (transport) => {
    const [current] = transport.tasks;

    assert.ok(current);

    current.pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      kind: "question",
      input: { questions: [{ question: "Which branch?" }] },
    };

    const original = transport.tool.bind(transport);
    let failures = 1;

    transport.tool = async <T>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      if (name === "submit_input" && failures-- > 0) {
        transport.calls.push({ name, args });
        throw new Error("Input request is stale");
      }

      return original<T>(name, args);
    };
  });

  await pasteText(
    user,
    screen.getByRole("textbox", { name: "Which branch?" }),
    "main",
  );

  await user.click(screen.getByRole("button", { name: "Respond" }));
  // The failure stays beside the answer, which is kept for a retry.
  await screen.findByText("Input request is stale");
  await user.click(screen.getByRole("button", { name: "Respond" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "submit_input").length,
      2,
    ),
  );

  assert.deepEqual(
    transport.calls.findLast((call) => call.name === "submit_input")?.args
      .input,
    {
      questions: [{ question: "Which branch?" }],
      answers: { "Which branch?": "main" },
    },
  );
});

test("unsent question answers survive switching tasks and clear once sent", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    const [current] = transport.tasks;

    assert.ok(current);

    current.pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          {
            question: "Which checks?",
            header: "Checks",
            multiSelect: true,
            options: [{ label: "Types" }, { label: "Tests" }],
          },
          {
            question: "Which scope?",
            header: "Scope",
            options: [{ label: "All" }],
          },
          {
            question: "Which owner?",
            header: "Owner",
            options: [{ label: "Me" }],
          },
        ],
      },
    };

    // Like the service, answering resolves the request, so the form unmounts.
    const original = transport.tool.bind(transport);

    transport.tool = async <T>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      if (name === "submit_input") {
        const [answered] = transport.tasks;

        assert.ok(answered);
        transport.tasks[0] = { ...answered, pending_input: undefined };
      }

      return original<T>(name, args);
    };
  });

  await user.click(screen.getByRole("checkbox", { name: "Tests" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Skip this question" }));

  await pasteText(
    user,
    screen.getByRole("textbox", { name: "Write your own answer" }),
    "Platform team",
  );

  const reopen = async () => {
    act(() => controller.back());

    await waitFor(() =>
      assertAbsent(screen.queryByRole("button", { name: "Respond" })),
    );

    await act(() => controller.select("one"));
    await screen.findByText(/Question \d of 3/);
  };

  await reopen();
  // The same card, choices, typed answer and skip come back.
  assert.ok(screen.getByText("Question 3 of 3"));

  assert.equal(
    screen.getByRole<HTMLInputElement>("textbox", {
      name: "Write your own answer",
    }).value,
    "Platform team",
  );

  assert.ok(
    screen.getByRole("button", { name: "Scope" }).hasAttribute("data-skipped"),
  );

  await user.click(screen.getByRole("button", { name: "Checks" }));

  assert.equal(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Tests" }).checked,
    true,
  );

  await user.click(screen.getByRole("button", { name: "Respond" }));

  await waitFor(() =>
    assert.deepEqual(
      (
        transport.calls.find((call) => call.name === "submit_input")?.args
          .input as any
      )?.answers,
      {
        "Which checks?": "Tests",
        "Which scope?": SKIPPED_ANSWER,
        "Which owner?": "Platform team",
      },
    ),
  );

  // An answered request leaves no draft, even though the form unmounts afterwards.
  await waitFor(() =>
    assertAbsent(screen.queryByRole("button", { name: "Respond" })),
  );

  assert.equal(controller.session.get("question", "request").draft, undefined);
});

test("keyboard focus follows the stacked question cards", async (t) => {
  const { user } = await setupInspector(t, (transport) => {
    const [current] = transport.tasks;

    assert.ok(current);

    current.pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          { question: "Which format?", options: [{ label: "YAML" }] },
          { question: "Which scope?", options: [{ label: "All" }] },
        ],
      },
    };
  });

  // Enter in a typed answer moves on and continues in the next card.
  await user.type(
    screen.getByRole("textbox", { name: "Write your own answer" }),
    "TOML{Enter}",
  );

  assert.ok(screen.getByText("Question 2 of 2"));

  expect(document.activeElement).toBe(
    screen.getByRole("radio", { name: "All" }),
  );

  // Skip and Undo are one button, so focus stays put while it toggles.
  const toggle = screen.getByRole("button", { name: "Skip this question" });
  await user.click(toggle);
  assert.equal(toggle.textContent, "Undo");
  expect(document.activeElement).toBe(toggle);
  // Back disappears on the first card, so focus moves to the send button.
  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Respond" }),
  );
});
