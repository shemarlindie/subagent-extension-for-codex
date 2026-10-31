// @vitest-environment jsdom
import {
  assert,
  configureModelDefaults,
  enterTask,
  pasteText,
  screen,
  selectOption,
  setupDelegate,
  startedTask,
  test,
} from "./panel-test-support";

type Panel = Awaited<ReturnType<typeof setupDelegate>>;

const startCalls = ({ transport }: Panel) =>
  transport.calls.filter((call) => call.name === "start_task");

/**
 * Starting is blocked with `message` and sends nothing until `effort` is
 * chosen. Returns the arguments of the single start that follows.
 */
async function startAfterChoosingEffort(
  panel: Panel,
  message: RegExp,
  effort: string,
) {
  await panel.user.click(screen.getByRole("button", { name: "Start task" }));
  await screen.findByText(message);
  assert.equal(startCalls(panel).length, 0);
  await selectOption(panel.user, "Reasoning effort", effort);
  await panel.user.click(screen.getByRole("button", { name: "Start task" }));

  return (await startedTask(panel.transport)).args;
}

test("discovered model metadata offers suggestions and rejects unsupported inherited effort until corrected", async (t) => {
  const panel = await setupDelegate(t, (transport) =>
    configureModelDefaults(
      transport,
      {
        "models.global.model": "limited-model",
        "models.global.reasoning_effort": "high",
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

  const { user } = panel;

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

  const args = await startAfterChoosingEffort(
    panel,
    /Choose a reasoning effort supported by claude model limited-model: low/,
    "low",
  );

  assert.equal(args.reasoning_effort, "low");
});

test("runtime default model metadata blocks unsupported effort and permits native default reasoning", async (t) => {
  const panel = await setupDelegate(t, (transport) =>
    configureModelDefaults(transport, {}, [
      {
        value: "default",
        displayName: "Runtime default",
        description: "",
        supportsEffort: false,
      },
    ]),
  );

  const { user } = panel;

  await screen.findByRole("dialog");
  await enterTask(user, "Check native default metadata");
  assert.equal(screen.getByLabelText<HTMLInputElement>("Model").value, "");
  await selectOption(user, "Reasoning effort", "high (unsupported by claude)");

  const args = await startAfterChoosingEffort(
    panel,
    /Choose a reasoning effort supported by claude model default/,
    "Use default",
  );

  assert.equal(args.model, "");
  assert.equal(args.reasoning_effort, "default");
});

test("unknown model metadata keeps generic reasoning choices and accepts custom model IDs", async (t) => {
  const { transport, user } = await setupDelegate(t, (transport) =>
    configureModelDefaults(transport, {}, [
      {
        value: "no-effort",
        displayName: "No effort",
        description: "",
        supportsEffort: false,
      },
    ]),
  );

  await screen.findByRole("dialog");
  await enterTask(user, "Use custom model ID");
  await pasteText(user, screen.getByLabelText("Model"), "custom-model");
  assert.ok(screen.getByText(/Reasoning support for this model is unknown/));
  await selectOption(user, "Reasoning effort", "high");
  await user.click(screen.getByRole("button", { name: "Start task" }));

  const call = await startedTask(transport);

  assert.equal(call.args.model, "custom-model");
  assert.equal(call.args.reasoning_effort, "high");
});

test("model selection retains unsupported effort on Claude and blocks submission until corrected", async (t) => {
  const panel = await setupDelegate(t);
  const { user } = panel;
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

  const args = await startAfterChoosingEffort(
    panel,
    /Choose a reasoning effort supported by claude/,
    "high",
  );

  assert.equal(args.reasoning_effort, "high");
});

test("model selection updates role and provider defaults while preserving explicit drafts", async (t) => {
  const { transport, user } = await setupDelegate(t, (transport) =>
    configureModelDefaults(transport, {
      "models.global.model": "global-model",
      "models.global.reasoning_effort": "low",
      "models.providers.claude.model": "claude-model",
      "models.providers.claude.reasoning_effort": "medium",
      "models.profiles.reviewer.model": "review-model",
      "models.profiles.reviewer.reasoning_effort": "max",
    }),
  );

  await screen.findByRole("dialog");
  const field = screen.getByLabelText<HTMLInputElement>("Model");
  assert.equal(field.placeholder, "review-model");

  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /Use default \(max\)/,
  );

  await pasteText(user, field, "explicit-model");
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

  const call = await startedTask(transport);

  assert.equal(call.args.model, "explicit-model");
  assert.equal(call.args.reasoning_effort, "high");
});
