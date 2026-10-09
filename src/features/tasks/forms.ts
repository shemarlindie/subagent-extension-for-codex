import { createHash, randomBytes } from "node:crypto";

import {
  type CallToolResult,
  type ElicitRequestFormParams,
  inputRequired,
  type ServerContext,
} from "@modelcontextprotocol/server";
import {
  createOpenAIFormContentSchema,
  type OpenAIForm,
  OpenAIFormResultSchema,
  OpenAIFormSchema,
} from "@openai/mcp-extensions/server";
import { z } from "zod";

import { decodeStored } from "../../platform/database/decode.js";
import { hostProjectCandidate } from "../../platform/panel/host-context.js";
import { reasoningLevels } from "../../shared/contracts.js";
import { inputPresentation } from "../providers/input-presentation.js";
import { providerMetadata } from "../providers/metadata.js";
import { type Control } from "./control.js";
import { FormRequests } from "./form-requests.js";
import { pendingInputKind } from "./model.js";

type Kind =
  "request_agent_task" | "request_agent_input" | "request_agent_project";

/**
 * Discovered models become choices; host forms cannot combine a choice list
 * with free text. Without discovery, the field stays free text.
 */
function modelField(
  workers: Awaited<ReturnType<Control["availableWorkers"]>>,
  requested: unknown,
) {
  const catalogs = workers.flatMap((worker) =>
    "models" in worker && worker.models.length
      ? [{ provider: worker.provider, models: worker.models }]
      : [],
  );

  const saved = typeof requested === "string" ? requested.trim() : "";
  if (!catalogs.length)
    return {
      type: "string",
      title: "Model",
      description:
        "Blank uses configured defaults. Enter a model ID or provider alias.",
      maxLength: 200,
      default: saved,
    };
  // Name the provider whenever a choice could be paired with another worker.
  const prefix = workers.length > 1;

  const uncataloged = workers
    .filter((worker) => !catalogs.some((c) => c.provider === worker.provider))
    .map((worker) => worker.provider);

  const choices = [
    { const: "", title: "Use configured default" },
    ...catalogs.flatMap(({ provider, models }) =>
      models.map((model) => ({
        const: model.value,
        title: [
          prefix ? `${provider} · ${model.displayName}` : model.displayName,
          model.description,
        ]
          .filter(Boolean)
          .join(" — "),
      })),
    ),
  ].filter(
    (choice, index, all) =>
      all.findIndex((other) => other.const === choice.const) === index,
  );

  // Keep a requested custom ID selectable even when the catalog omits it.
  if (saved && !choices.some((choice) => choice.const === saved))
    choices.push({ const: saved, title: `${saved} (custom)` });

  return {
    type: "string",
    title: "Model",
    description: [
      "Choose a model for the selected worker's provider. Unsupported reasoning efforts are rejected when the task starts.",
      uncataloged.length
        ? `No model list for ${uncataloged.join(", ")}; use the configured default.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    oneOf: choices,
    default: saved,
  };
}

interface Request {
  kind: Kind;
  args: Record<string, unknown>;
  form: OpenAIForm;
  message: string;
  task_id?: string;
  request_id?: string;
  questions?: string[];
  status: "pending" | "processing" | "complete";
  answer?: string;
  result?: CallToolResult;
}

const storedRequestSchema = z.looseObject({
  kind: z.enum([
    "request_agent_task",
    "request_agent_input",
    "request_agent_project",
  ]),
  args: z.record(z.string(), z.unknown()),
  form: OpenAIFormSchema,
  message: z.string(),
  task_id: z.string().optional(),
  request_id: z.string().optional(),
  questions: z.array(z.string()).optional(),
  status: z.enum(["pending", "processing", "complete"]),
  answer: z.string().optional(),
  result: z
    .custom<CallToolResult>((v) => typeof v === "object" && v !== null)
    .optional(),
});

const decodeRequest = (id: string, body: string) =>
  decodeStored(
    storedRequestSchema,
    body,
    `form request ${id}`,
  ) satisfies Request;

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );

const hash = (v: string) => createHash("sha256").update(v).digest("hex");

const complete = (result: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(result) }],
  structuredContent: { result },
});

const failed = (error: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: String(error) }],
});

/** Durable opaque MRTR state: clients cannot change its owner, args or input request. */
export class Forms {
  private inFlight = new Map<string, Promise<CallToolResult>>();
  private requests: FormRequests;
  constructor(
    private c: Control,
    private now = () => Date.now(),
  ) {
    this.requests = new FormRequests(c.store.database);
  }

  /** Recover submissions only after the service has secured its listener. */
  recover() {
    for (const row of this.requests.all()) {
      const r = decodeRequest(row.id, row.body);

      if (r.status === "processing") {
        r.status = "complete";

        r.result = failed(
          r.kind === "request_agent_project"
            ? "Service restarted during project registration. Inspect registered projects before requesting registration again."
            : "Service restarted during form submission. Inspect tasks before starting another request.",
        );

        this.save(row.id, r);
      }
    }
  }

  verify(owner: string, token: string): string {
    this.load(owner, token);

    return token;
  }

  private load(owner: string, token: string): Request {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error("Invalid or expired form state");

    const id = hash(token);
    const body = this.requests.body(id, owner, this.now());
    if (!body) throw new Error("Invalid or expired form state");

    return decodeRequest(id, body);
  }

  private save(id: string, r: Request) {
    this.requests.update(id, JSON.stringify(r));
  }

  private checkInput(owner: string, r: Request) {
    if (!r.task_id) return;
    const task = this.c.store.get(r.task_id, owner);
    if (task.pending_input?.id !== r.request_id)
      throw new Error("Input request is stale");
  }

  private async build(
    owner: string,
    kind: Kind,
    args: Record<string, unknown>,
    repositoryHint?: string,
  ): Promise<Request> {
    if (kind === "request_agent_project") {
      if (!this.c.projects)
        throw new Error("Project registration is unavailable");

      return {
        kind,
        args,
        status: "pending",
        message:
          "Register this local Git repository for delegation? Registration grants workers access to the repository; this does not start a task.",
        form: OpenAIFormSchema.parse({
          type: "object",
          properties: {
            repository: {
              type: "string",
              title: "Repository path",
              description: "Absolute path to the local Git repository root.",
              minLength: 1,
              maxLength: 4096,
              ...(typeof args.repository === "string"
                ? { default: args.repository }
                : repositoryHint
                  ? { default: repositoryHint }
                  : {}),
            },
            decision: {
              type: "string",
              title: "Repository access",
              enum: ["deny", "allow"],
              default: "deny",
            },
          },
          required: ["repository", "decision"],
        }),
      };
    }

    if (kind === "request_agent_task") {
      const defaults = this.c.settings.taskInput(owner, args);

      const workspaceStrategy = defaults.workspace_strategy as
        "worktree" | "current_repo";

      const description =
        typeof args.description === "string" ? args.description.trim() : "";

      const projects = this.c.projects?.list() ?? [
        { repository: this.c.repository, kind: "repository" },
      ];

      const choices = projects.filter((p) => p.kind === "repository");
      if (!choices.length)
        throw new Error(
          "Add a repository through the project user interface or local projects CLI before opening a task form",
        );
      const availableWorkers = await this.c.availableWorkers();

      const nativePermissions = availableWorkers
        .map(
          (worker) =>
            providerMetadata(worker.provider, worker.metadata)
              ?.nativePermissions,
        )
        .filter((permissions) => permissions !== undefined);

      const permissions = nativePermissions[0];
      const settingsDefaults = defaults as unknown as Record<string, unknown>;

      const defaultProviderOptions =
        (
          defaults.provider_options as
            Record<string, Record<string, unknown>> | undefined
        )?.[String(defaults.provider)] ?? {};

      const workers = availableWorkers.flatMap((w) =>
        w.profiles.map((profile) => ({
          const: `${w.provider}:${profile}`,
          title: `${w.provider} · ${profile.replaceAll("_", " ")}`,
        })),
      );

      return {
        kind,
        args,
        status: "pending",
        message:
          "Delegate work in a Git worktree or the current repository. Provide the full request as the description; a task title is generated automatically. Confirm the workspace, worker and budgets.",
        form: OpenAIFormSchema.parse({
          type: "object",
          properties: {
            repository: {
              type: "string",
              title: "Project",
              oneOf: choices.map((p) => ({
                const: p.repository,
                title: p.repository,
              })),
              ...(choices.some((p) => p.repository === args.repository)
                ? { default: args.repository }
                : {}),
            },
            description: {
              type: "string",
              title: "Description",
              description: "Full instructions and details for the worker.",
              minLength: 1,
              maxLength: 20000,
              ...(description ? { default: description } : {}),
            },
            worker: {
              type: "string",
              title: "Worker",
              oneOf: workers,
              default: `${defaults.provider}:${defaults.worker_profile}`,
            },
            model: modelField(availableWorkers, args.model),
            reasoning_effort: {
              type: "string",
              title: "Reasoning effort",
              enum: ["default", ...reasoningLevels],
              default: args.reasoning_effort ?? "default",
            },
            ...(permissions
              ? {
                  permission_mode: {
                    type: "string",
                    title: permissions.formTitle ?? "Permission mode",
                    description: permissions.formHelp ?? permissions.help,
                    oneOf: [
                      ...new Map(
                        nativePermissions
                          .flatMap((native) => native.options)
                          .map((option) => [option.value, option]),
                      ).values(),
                    ].map((option) => ({
                      const: option.value,
                      title: option.label,
                    })),
                    default:
                      defaultProviderOptions[permissions.permissionOption] ??
                      settingsDefaults[permissions.permissionSetting] ??
                      "inherit",
                  },
                  ...(permissions.approvalDeciderOption
                    ? {
                        approval_decider: {
                          type: "string",
                          title: "Approval decision maker",
                          enum: ["user", "parent_agent"],
                          default:
                            defaultProviderOptions[
                              permissions.approvalDeciderOption
                            ] ??
                            (permissions.approvalDeciderSetting
                              ? settingsDefaults[
                                  permissions.approvalDeciderSetting
                                ]
                              : undefined) ??
                            "user",
                        },
                      }
                    : {}),
                }
              : {}),
            workspace_strategy: {
              type: "string",
              title: "Workspace",
              description:
                "Current repository includes uncommitted changes. Write profiles edit the checkout directly; use HEAD as the revision.",
              oneOf: [
                { const: "worktree", title: "Isolated worktree" },
                {
                  const: "current_repo",
                  title: "Current repository (uncommitted changes)",
                },
              ],
              default: workspaceStrategy,
            },
            revision: {
              type: "string",
              title: "Revision (HEAD for current repository)",
              description:
                workspaceStrategy === "current_repo"
                  ? "Current repository always uses HEAD. Select an isolated worktree to use another committed revision."
                  : undefined,
              default:
                workspaceStrategy === "current_repo"
                  ? "HEAD"
                  : (args.revision ?? "HEAD"),
              minLength: 1,
            },
            max_runtime_minutes: {
              type: "number",
              title: "Runtime budget (minutes)",
              minimum: 0.01,
              maximum: 120,
              default: defaults.budget.max_runtime_minutes ?? 20,
            },
            use_runtime_budget: {
              type: "boolean",
              title: "Apply a runtime limit",
              default: defaults.budget.max_runtime_minutes !== null,
            },
            max_cost_usd: {
              type: "number",
              title: "Cost budget (USD)",
              description:
                "Claude checks this budget after a response, which can exceed the amount. Interrupted usage may be missing.",
              minimum: 0.01,
              maximum: 100,
              default: defaults.budget.max_cost_usd ?? 5,
            },
            use_cost_budget: {
              type: "boolean",
              title: "Apply a cost limit (requires provider support)",
              default: defaults.budget.max_cost_usd !== null,
            },
          },
          required: [
            "repository",
            "description",
            "worker",
            "revision",
            "max_runtime_minutes",
            "max_cost_usd",
          ],
        }),
      };
    }

    const task = this.c.store.get(String(args.task_id), owner);
    if (!task.pending_input) throw new Error("No pending input request");
    const pending = task.pending_input;

    const r: Request = {
      kind,
      args,
      status: "pending",
      task_id: task.id,
      request_id: pending.id,
      form: { type: "object", properties: {} },
      message: "",
    };

    if (pendingInputKind(pending) !== "question") {
      const presentation = inputPresentation(pending);
      r.message = `${presentation.formMessage ?? `Worker requests permission for ${pending.tool}:`}\n${JSON.stringify(pending.input)}`;

      r.form = OpenAIFormSchema.parse({
        type: "object",
        properties: {
          decision: {
            type: "string",
            title: presentation.formTitle ?? "Permission",
            oneOf: [
              { const: "deny", title: "Deny" },
              {
                const: "allow",
                title: presentation.formApproveLabel ?? "Allow this request",
              },
            ],
            default: "deny",
          },
        },
        required: ["decision"],
      });

      return r;
    }

    // Worker-supplied question payloads; every field is read defensively.
    const questions: {
      question?: unknown;
      options?: unknown;
      multiSelect?: unknown;
    }[] = Array.isArray(pending.input.questions) ? pending.input.questions : [];

    if (!questions.length || questions.length > 20)
      throw new Error("Unsupported worker question; respond in the console");
    r.questions = questions.map((q) => String(q.question));
    if (new Set(r.questions).size !== r.questions.length)
      throw new Error("Duplicate worker questions; respond in the console");
    r.message = `Answer the worker's questions for task: ${task.title}`;

    const properties = Object.fromEntries(
      questions.map((q, i) => {
        const options = Array.isArray(q.options)
          ? q.options.map((o: { label?: unknown; description?: unknown }) => ({
              const: String(o.label),
              title: String(o.label),
              ...(o.description ? { description: String(o.description) } : {}),
            }))
          : [];

        return [
          `q${i}`,
          options.length
            ? q.multiSelect
              ? {
                  type: "array",
                  title: String(q.question),
                  items: { anyOf: options },
                  minItems: 1,
                  uniqueItems: true,
                }
              : { type: "string", title: String(q.question), oneOf: options }
            : {
                type: "string",
                title: String(q.question),
                minLength: 1,
                maxLength: 20000,
              },
        ];
      }),
    );

    r.form = OpenAIFormSchema.parse({
      type: "object",
      properties,
      required: Object.keys(properties),
    });

    return r;
  }

  async handle(
    owner: string,
    kind: Kind,
    args: Record<string, unknown>,
    ctx: ServerContext,
  ) {
    const state = ctx.mcpReq.requestState<string>();
    let token = state;
    let r: Request;

    if (!token) {
      if (
        ctx.mcpReq.inputResponses &&
        Object.keys(ctx.mcpReq.inputResponses).length
      )
        throw new Error("Form responses require request state");

      const stateMeta = ctx.mcpReq._meta?.["codex/sandbox-state-meta"] as
        { sandboxCwd?: unknown } | undefined;

      // Save the hint in the form, keeping original arguments stable on retries.
      const repositoryHint =
        kind === "request_agent_project" &&
        args.repository === undefined &&
        typeof stateMeta?.sandboxCwd === "string" &&
        stateMeta.sandboxCwd.length <= 4096
          ? await hostProjectCandidate(stateMeta.sandboxCwd)
          : undefined;

      r = await this.build(owner, kind, args, repositoryHint);

      if (this.requests.pending(owner, this.now()) >= 500)
        throw new Error("Too many pending form requests");
      token = randomBytes(32).toString("base64url");

      this.requests.add(
        hash(token),
        owner,
        this.now() + 10 * 60000,
        r.task_id,
        JSON.stringify(r),
      );
    } else {
      r = this.load(owner, token);
      if (r.kind !== kind || canonical(r.args) !== canonical(args))
        throw new Error("Form state does not match this tool request");
    }

    const id = hash(token);
    const raw = ctx.mcpReq.inputResponses?.form;

    const response =
      raw === undefined ? undefined : OpenAIFormResultSchema.parse(raw);

    const answer = response ? canonical(response) : undefined;

    if (r.status !== "pending") {
      if (answer !== r.answer)
        throw new Error("Form was already submitted with a different response");

      return (
        this.inFlight.get(id) ??
        r.result ??
        failed(
          kind === "request_agent_project"
            ? "Project registration is interrupted; inspect registered projects."
            : "Form submission is interrupted; inspect task state.",
        )
      );
    }

    this.checkInput(owner, r);
    if (!response)
      return inputRequired({
        requestState: token,
        inputRequests: {
          form: inputRequired.elicit({
            mode: "form",
            message: r.message,
            requestedSchema:
              r.form as ElicitRequestFormParams["requestedSchema"],
          }),
        },
      });

    if (response.action !== "accept") {
      r.status = "complete";
      r.answer = answer;
      r.result = complete({ cancelled: true });
      this.save(id, r);

      return r.result;
    }

    const content = createOpenAIFormContentSchema(r.form).parse(
      response.content,
    );

    if (
      Object.keys(content).some((key) => !Object.hasOwn(r.form.properties, key))
    )
      throw new Error("Unknown form field");
    r.status = "processing";
    r.answer = answer;
    this.save(id, r);

    const run = (async () => {
      try {
        let result: unknown;

        if (kind === "request_agent_project") {
          // Accepting the form alone never grants access: require explicit allow.
          result =
            content.decision === "allow"
              ? await this.c.projects!.register(String(content.repository))
              : { cancelled: true };
        } else if (kind === "request_agent_task") {
          const [provider, worker_profile] = String(content.worker).split(":");

          const permissions = providerMetadata(
            provider,
            this.c.providers.get(provider)?.metadata,
          )?.nativePermissions;

          const existingOptions = (
            r.args.provider_options as
              Record<string, Record<string, unknown>> | undefined
          )?.[provider];

          const providerOptions: Record<
            string,
            Record<string, unknown>
          > = existingOptions ? { [provider]: { ...existingOptions } } : {};

          if (permissions) {
            providerOptions[provider] = {
              ...(providerOptions[provider] ?? {}),
              [permissions.permissionOption]:
                content.permission_mode ??
                r.form.properties.permission_mode?.default ??
                "inherit",
              ...(permissions.approvalDeciderOption
                ? {
                    [permissions.approvalDeciderOption]:
                      content.approval_decider ??
                      r.form.properties.approval_decider?.default ??
                      "user",
                  }
                : {}),
            };
          }

          result = await this.c.start(
            owner,
            {
              ...r.args,
              ...(Object.keys(providerOptions).length
                ? { provider_options: providerOptions }
                : {}),
              repository: content.repository,
              description: content.description,
              provider,
              worker_profile,
              model: content.model ?? r.args.model,
              reasoning_effort:
                content.reasoning_effort ?? r.args.reasoning_effort,
              revision:
                content.workspace_strategy === "current_repo"
                  ? "HEAD"
                  : content.revision,
              workspace_strategy:
                content.workspace_strategy ??
                r.args.workspace_strategy ??
                r.form.properties.workspace_strategy?.default,
              budget: {
                ...((r.args.budget as object) ?? {}),
                max_runtime_minutes:
                  (content.use_runtime_budget ??
                    r.form.properties.use_runtime_budget?.default) === false
                    ? null
                    : content.max_runtime_minutes,
                max_cost_usd:
                  (content.use_cost_budget ??
                    r.form.properties.use_cost_budget?.default) === false
                    ? null
                    : content.max_cost_usd,
              },
            },
            "user",
          );
        } else {
          const answers = Object.fromEntries(
            (r.questions ?? []).map((question, i) => [
              question,
              Array.isArray(content[`q${i}`])
                ? (content[`q${i}`] as string[]).join(", ")
                : content[`q${i}`],
            ]),
          );

          result = await this.c.input(
            owner,
            r.task_id!,
            r.request_id!,
            r.questions ? true : content.decision === "allow",
            r.questions ? { answers } : undefined,
          );
        }

        r.result = complete(result);
      } catch (error) {
        r.result = failed(error);
      }

      r.status = "complete";
      this.save(id, r);

      return r.result;
    })();

    this.inFlight.set(id, run);

    try {
      return await run;
    } finally {
      this.inFlight.delete(id);
    }
  }
}
