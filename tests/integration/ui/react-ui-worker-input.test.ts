// @vitest-environment jsdom
import { expect } from "vitest";

import {
  assert,
  assertAbsent,
  executionPresentation,
  screen,
  setup,
  SKIPPED_ANSWER,
  test,
  waitFor,
} from "./react-ui-test-support";

test("worker question accepts a custom answer with no preset selection", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
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
  const composer = screen.getByRole("textbox", { name: "Message" });
  const collapse = screen.getByRole("button", { name: "Hide composer" });

  expect(collapse.closest(".chat-composer-box")).toBeNull();

  expect(collapse.parentElement).toBe(
    composer.closest(".chat-composer-input-row"),
  );

  assert.ok(
    collapse.compareDocumentPosition(composer) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );

  await user.click(collapse);
  assertAbsent(screen.queryByRole("textbox", { name: "Message" }));

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Show composer" }),
  );

  await user.click(screen.getByRole("radio", { name: "Preset" }));

  await user.type(
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
      transport.calls.filter((call) => call.name === "submit_agent_input")
        .length,
      1,
    ),
  );

  assert.deepEqual(
    transport.calls.find((call) => call.name === "submit_agent_input")?.args,
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

test("permission requests can be denied inline", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "permission",
      tool: "Execution",
      kind: "permission",
      presentation: executionPresentation,
      input: { description: "Execute shell commands" },
    };
  });

  assertAbsent(screen.queryByRole("dialog"));

  assert.equal(
    transport.calls.filter((call) => call.name === "submit_agent_input").length,
    0,
  );

  await user.click(screen.getByRole("button", { name: "Deny" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "submit_agent_input")
        .length,
      1,
    ),
  );

  assert.equal(
    transport.calls.find((call) => call.name === "submit_agent_input")?.args
      .approved,
    false,
  );
});

test("worker questions submit preset multiple answers and a custom override together", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          {
            question: "Which checks?",
            multiSelect: true,
            options: [{ label: "Types" }, { label: "Tests" }],
          },
          { question: "Which scope?", options: [{ label: "Default scope" }] },
        ],
      },
    };
  });

  // Only the front card of the stack is exposed; the next one waits behind it.
  assert.ok(screen.getByText("Question 1 of 2"));
  assertAbsent(screen.queryByRole("group", { name: "Which scope?" }));
  await user.click(screen.getByRole("checkbox", { name: "Types" }));
  await user.click(screen.getByRole("checkbox", { name: "Tests" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  assert.ok(screen.getByText("Question 2 of 2"));
  await user.click(screen.getByRole("button", { name: "Back" }));
  assert.ok(screen.getByText("Question 1 of 2"));

  // Moving between cards keeps the answers already chosen.
  assert.equal(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Tests" }).checked,
    true,
  );

  await user.click(screen.getByRole("button", { name: "Next" }));
  assertAbsent(screen.queryByRole("group", { name: "Which checks?" }));
  await user.click(screen.getByRole("radio", { name: "Default scope" }));

  await user.type(
    screen.getByRole("textbox", { name: "Write your own answer" }),
    "Expanded scope",
  );

  await user.click(screen.getByRole("button", { name: "Respond" }));

  await waitFor(() =>
    assert.deepEqual(
      (
        transport.calls.find((call) => call.name === "submit_agent_input")?.args
          .input as any
      )?.answers,
      {
        "Which checks?": "Types, Tests",
        "Which scope?": "Expanded scope",
      },
    ),
  );
});

test("a single worker question can be skipped and the skip undone", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          { question: "Which format?", options: [{ label: "YAML" }] },
        ],
      },
    };
  });

  await user.click(screen.getByRole("button", { name: "Skip this question" }));
  assert.ok(screen.getByText("Skipped", { selector: "[role=status]" }));
  await user.click(screen.getByRole("button", { name: "Undo" }));
  assert.ok(screen.getByRole("button", { name: "Skip this question" }));
  await user.click(screen.getByRole("button", { name: "Skip this question" }));
  await user.click(screen.getByRole("button", { name: "Respond" }));

  await waitFor(() =>
    assert.deepEqual(
      transport.calls.find((call) => call.name === "submit_agent_input")?.args,
      {
        task_id: "one",
        request_id: "request",
        approved: true,
        input: {
          questions: [
            { question: "Which format?", options: [{ label: "YAML" }] },
          ],
          answers: { "Which format?": SKIPPED_ANSWER },
        },
      },
    ),
  );
});

test("a skipped stacked question sends an explicit skipped answer", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          {
            question: "Which format?",
            header: "Format",
            options: [{ label: "YAML" }, { label: "JSON" }],
          },
          {
            question: "Which scope?",
            header: "Scope",
            options: [{ label: "All" }, { label: "Changed" }],
          },
        ],
      },
    };
  });

  await user.click(screen.getByRole("radio", { name: "YAML" }));
  // Skipping drops the partial answer and moves to the next card.
  await user.click(screen.getByRole("button", { name: "Skip this question" }));
  assert.ok(screen.getByText("Question 2 of 2"));

  assert.ok(
    screen.getByRole("button", { name: "Format" }).hasAttribute("data-skipped"),
  );

  await user.click(screen.getByRole("button", { name: "Format" }));

  assert.equal(
    screen.getByRole<HTMLInputElement>("radio", { name: "YAML" }).checked,
    false,
  );

  // Picking a choice takes the skip back; Undo restores the card too.
  await user.click(screen.getByRole("radio", { name: "JSON" }));
  assertAbsent(screen.queryByText("Skipped", { selector: "[role=status]" }));
  await user.click(screen.getByRole("button", { name: "Skip this question" }));
  await user.click(screen.getByRole("radio", { name: "Changed" }));
  await user.click(screen.getByRole("button", { name: "Respond" }));

  await waitFor(() =>
    assert.deepEqual(
      (
        transport.calls.find((call) => call.name === "submit_agent_input")?.args
          .input as any
      )?.answers,
      { "Which format?": SKIPPED_ANSWER, "Which scope?": "Changed" },
    ),
  );
});

test("a question without options answers in a text box and shows send failures inline", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
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
      if (name === "submit_agent_input" && failures-- > 0) {
        transport.calls.push({ name, args });
        throw new Error("Input request is stale");
      }

      return original<T>(name, args);
    };
  });

  await user.type(
    screen.getByRole("textbox", { name: "Which branch?" }),
    "main",
  );

  await user.click(screen.getByRole("button", { name: "Respond" }));
  // The failure stays beside the answer, which is kept for a retry.
  await screen.findByText("Input request is stale");
  await user.click(screen.getByRole("button", { name: "Respond" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "submit_agent_input")
        .length,
      2,
    ),
  );

  assert.deepEqual(
    transport.calls.findLast((call) => call.name === "submit_agent_input")?.args
      .input,
    {
      questions: [{ question: "Which branch?" }],
      answers: { "Which branch?": "main" },
    },
  );
});

test("unsent question answers survive switching tasks and clear once sent", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
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
      if (name === "submit_agent_input") {
        transport.tasks[0] = {
          ...transport.tasks[0],
          pending_input: undefined,
        };
      }

      return original<T>(name, args);
    };
  });

  await user.click(screen.getByRole("checkbox", { name: "Tests" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Skip this question" }));

  await user.type(
    screen.getByRole("textbox", { name: "Write your own answer" }),
    "Platform team",
  );

  const reopen = async () => {
    controller.back();

    await waitFor(() =>
      assertAbsent(screen.queryByRole("button", { name: "Respond" })),
    );

    await controller.select("one");
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
        transport.calls.find((call) => call.name === "submit_agent_input")?.args
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
  const { user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
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

test("stacked worker questions return to the first unanswered card before sending", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          {
            question: "Which format?",
            header: "Format",
            options: [{ label: "YAML" }, { label: "JSON" }],
          },
          {
            question: "Which extras?",
            header: "Extras",
            multiSelect: true,
            options: [{ label: "Docs" }, { label: "Tests" }],
          },
        ],
      },
    };
  });

  assert.ok(screen.getByText("Question 1 of 2"));

  assertAbsent(
    screen.queryByRole("button", { name: /Claude has 2 questions/ }),
  );

  assertAbsent(screen.getByText("Which format?").closest(".notice"));

  // Returning to the task shows the question directly again.
  controller.back();

  await waitFor(() =>
    assertAbsent(screen.queryByRole("button", { name: "Respond" })),
  );

  await controller.select("one");
  await screen.findByText("Question 1 of 2");

  await user.click(screen.getByRole("button", { name: "Extras" }));
  assert.ok(screen.getByText("Question 2 of 2"));
  await user.click(screen.getByRole("checkbox", { name: "Docs" }));

  // A typed answer joins the multiple choices.
  await user.type(
    screen.getByRole("textbox", { name: "Write your own answer" }),
    "Examples",
  );

  await user.click(screen.getByRole("button", { name: "Respond" }));

  assert.equal(
    screen
      .getByText("Answer each question before sending.")
      .getAttribute("role"),
    "alert",
  );

  assert.ok(screen.getByText("Question 1 of 2"));

  assert.equal(
    transport.calls.filter((call) => call.name === "submit_agent_input").length,
    0,
  );

  await user.click(screen.getByRole("radio", { name: "JSON" }));
  await user.click(screen.getByRole("button", { name: "Respond" }));

  await waitFor(() =>
    assert.deepEqual(
      (
        transport.calls.find((call) => call.name === "submit_agent_input")?.args
          .input as any
      )?.answers,
      { "Which format?": "JSON", "Which extras?": "Docs, Examples" },
    ),
  );
});

test("permission approval includes the optional message after an explicit decision", async (t) => {
  const { user, transport } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "message-request",
      kind: "permission",
      tool: "Bash",
      input: { command: "pwd" },
    };
  });

  assertAbsent(screen.queryByRole("dialog"));

  assert.equal(
    transport.calls.filter((call) => call.name === "submit_agent_input").length,
    0,
  );

  assert.equal(transport.tasks[0].pending_input?.id, "message-request");
  await user.click(screen.getByRole("button", { name: "Add a message" }));

  await user.type(
    screen.getByRole("textbox", { name: "Optional message to worker" }),
    "Only run this command",
  );

  await user.click(
    screen.getByRole("button", { name: "Approve this request once" }),
  );

  await waitFor(() =>
    assert.deepEqual(
      transport.calls.find((call) => call.name === "submit_agent_input")?.args,
      {
        task_id: "one",
        request_id: "message-request",
        approved: true,
        message: "Only run this command",
      },
    ),
  );
});
