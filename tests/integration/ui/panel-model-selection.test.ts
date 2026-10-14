// @vitest-environment jsdom
import {
  assert,
  configureModelDefaults,
  enterTask,
  screen,
  selectOption,
  setup,
  test,
  waitFor,
} from "./panel-test-support";

test("discovered model metadata offers suggestions and rejects unsupported inherited effort until corrected", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureModelDefaults(
      transport,
      {
        default_model: "limited-model",
        default_reasoning_effort: "high",
      },
      [
        {
          value: "limited-model",
          displayName: "Limited model",
          description: "SDK model",
          supportedEffortLevels: ["low"],
        },
      ],
    ),
  );

  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");
  const model = screen.getByLabelText<HTMLInputElement>("Model");
  assert.equal(model.placeholder, "limited-model");
  await user.click(model);

  const suggestion = await screen.findByRole("option", {
    name: /Limited model/,
  });

  assert.match(suggestion.textContent ?? "", /limited-model/);
  assert.match(suggestion.textContent ?? "", /SDK model/);
  await user.keyboard("{Escape}");
  await enterTask(user, "Check discovered metadata");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await screen.findByText(
    /Choose a reasoning effort supported by claude model limited-model: low/,
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );

  await selectOption(user, "Reasoning effort", "low");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  assert.equal(
    transport.calls.find((call) => call.name === "start_agent_task")!.args
      .reasoning_effort,
    "low",
  );
});

test("runtime default model metadata blocks unsupported effort and permits native default reasoning", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureModelDefaults(transport, {}, [
      {
        value: "default",
        displayName: "Runtime default",
        description: "",
        supportsEffort: false,
      },
    ]),
  );

  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");
  await enterTask(user, "Check native default metadata");
  assert.equal(screen.getByLabelText<HTMLInputElement>("Model").value, "");
  await selectOption(user, "Reasoning effort", "high (unsupported by claude)");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await screen.findByText(
    /Choose a reasoning effort supported by claude model default/,
  );

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );

  await selectOption(
    user,
    "Reasoning effort",
    "Use default (provider runtime)",
  );

  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  const call = transport.calls.find(
    (call) => call.name === "start_agent_task",
  )!;

  assert.equal(call.args.model, "");
  assert.equal(call.args.reasoning_effort, "default");
});

test("unknown model metadata keeps generic reasoning choices and accepts custom model IDs", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureModelDefaults(transport, {}, [
      {
        value: "no-effort",
        displayName: "No effort",
        description: "",
        supportsEffort: false,
      },
    ]),
  );

  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");
  await enterTask(user, "Use custom model ID");
  await user.type(screen.getByLabelText("Model"), "custom-model");
  assert.ok(screen.getByText(/Reasoning support for this model is unknown/));
  await selectOption(user, "Reasoning effort", "high");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  const call = transport.calls.find(
    (call) => call.name === "start_agent_task",
  )!;

  assert.equal(call.args.model, "custom-model");
  assert.equal(call.args.reasoning_effort, "high");
});

test("model selection retains unsupported effort on Claude and blocks submission until corrected", async (t) => {
  const { transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");
  await enterTask(user, "Investigate effort selection");
  await selectOption(user, "Worker", "fixture · reviewer");
  await selectOption(user, "Reasoning effort", "none");
  await selectOption(user, "Worker", "claude · reviewer");

  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /none \(unsupported by claude\)/,
  );

  await user.click(screen.getByRole("button", { name: "Start task" }));
  await screen.findByText(/Choose a reasoning effort supported by claude/);

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );

  await selectOption(user, "Reasoning effort", "high");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  assert.equal(
    transport.calls.find((call) => call.name === "start_agent_task")!.args
      .reasoning_effort,
    "high",
  );
});

test("model selection rejects unsupported inherited Claude effort and accepts an explicit supported override", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureModelDefaults(transport, { default_reasoning_effort: "none" }),
  );

  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");
  await enterTask(user, "Investigate inherited effort");

  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /Use default \(none\)/,
  );

  await user.click(screen.getByRole("button", { name: "Start task" }));
  await screen.findByText(/Choose a reasoning effort supported by claude/);

  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );

  await selectOption(user, "Reasoning effort", "medium");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  assert.equal(
    transport.calls.find((call) => call.name === "start_agent_task")!.args
      .reasoning_effort,
    "medium",
  );
});

test("model selection updates role and provider defaults while preserving explicit drafts", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureModelDefaults(transport, {
      default_model: "global-model",
      default_reasoning_effort: "low",
      claude_default_model: "claude-model",
      claude_default_reasoning_effort: "medium",
      reviewer_default_model: "review-model",
      reviewer_default_reasoning_effort: "max",
    }),
  );

  await user.click(screen.getByRole("button", { name: "New Task" }));
  await screen.findByRole("dialog");
  const field = screen.getByLabelText<HTMLInputElement>("Model");
  assert.equal(field.placeholder, "review-model");

  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /Use default \(max\)/,
  );

  await user.type(field, "explicit-model");
  await selectOption(user, "Worker", "claude · researcher");
  assert.equal(field.placeholder, "claude-model");
  assert.equal(field.value, "explicit-model");

  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /Use default \(medium\)/,
  );

  await selectOption(user, "Worker", "fixture · researcher");
  assert.equal(field.placeholder, "global-model");

  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /Use default \(low\)/,
  );

  await selectOption(user, "Reasoning effort", "high");
  await selectOption(user, "Worker", "claude · reviewer");
  assert.equal(field.placeholder, "review-model");
  assert.equal(field.value, "explicit-model");

  assert.equal(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent,
    "high",
  );

  await enterTask(user, "Preserve explicit selections");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );

  const call = transport.calls.find(
    (call) => call.name === "start_agent_task",
  )!;

  assert.equal(call.args.model, "explicit-model");
  assert.equal(call.args.reasoning_effort, "high");
});
