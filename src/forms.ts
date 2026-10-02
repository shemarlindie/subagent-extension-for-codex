import { createHash, randomBytes } from "node:crypto";
import {
  inputRequired,
  type ServerContext,
  type CallToolResult,
  type ElicitRequestFormParams,
} from "@modelcontextprotocol/server";
import {
  OpenAIFormSchema,
  OpenAIFormResultSchema,
  createOpenAIFormContentSchema,
  type OpenAIForm,
} from "@openai/mcp-extensions/server";
import { type Control } from "./control.js";
import { type Task } from "./model.js";

type Kind = "request_agent_task" | "request_agent_input";
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
  constructor(
    private c: Control,
    private now = () => Date.now(),
  ) {
    c.store.db.exec(
      "CREATE TABLE IF NOT EXISTS form_requests(id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, body TEXT NOT NULL)",
    );
  }
  /** Recover submissions only after the service has secured its listener. */
  recover() {
    for (const row of this.c.store.db
      .prepare("SELECT id,body FROM form_requests")
      .all()) {
      const r: Request = JSON.parse(String(row.body));
      if (r.status === "processing") {
        r.status = "complete";
        r.result = failed(
          "Service restarted during form submission. Inspect tasks before starting another request.",
        );
        this.save(String(row.id), r);
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
    const row = this.c.store.db
      .prepare(
        "SELECT body FROM form_requests WHERE id=? AND owner=? AND expires>?",
      )
      .get(hash(token), owner, this.now());
    if (!row) throw new Error("Invalid or expired form state");
    return JSON.parse(String(row.body));
  }
  private save(id: string, r: Request) {
    this.c.store.db
      .prepare("UPDATE form_requests SET body=? WHERE id=?")
      .run(JSON.stringify(r), id);
  }
  private checkInput(owner: string, r: Request) {
    if (!r.task_id) return;
    const task = this.c.store.get(r.task_id, owner);
    if (task.pending_input?.id !== r.request_id)
      throw new Error("Input request is stale");
  }
  private build(
    owner: string,
    kind: Kind,
    args: Record<string, unknown>,
  ): Request {
    if (kind === "request_agent_task") {
      const defaults = this.c.settings.taskInput(owner, args) as any;
      const workspaceStrategy = defaults.workspace_strategy as
        "worktree" | "current_repo";
      const projects = this.c.projects?.list() ?? [
        { repository: this.c.repository, kind: "repository" },
      ];
      const choices = projects.filter((p) => p.kind === "repository");
      if (!choices.length)
        throw new Error(
          "Register a repository with the local projects CLI before opening a task form",
        );
      const workers = this.c.workers().flatMap((w) =>
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
          "Delegate work in a Git worktree or the current repository. Confirm the workspace, task, worker and budgets.",
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
            task: {
              type: "string",
              title: "Task",
              minLength: 1,
              maxLength: 20000,
              ...(args.task ? { default: args.task } : {}),
            },
            worker: {
              type: "string",
              title: "Worker",
              oneOf: workers,
              default: `${defaults.provider}:${defaults.worker_profile}`,
            },
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
              default: defaults.budget.max_runtime_minutes,
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
            "task",
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
    if (pending.tool !== "AskUserQuestion") {
      const wholeTurn = pending.tool === "CodexExecution";
      r.message = `${wholeTurn ? "Allow this Codex execution turn? Approval covers the entire turn, including shell commands; there are no separate command approval prompts. Review the workspace and execution policy below." : `Worker requests permission for ${pending.tool}:`}\n${JSON.stringify(pending.input)}`;
      r.form = OpenAIFormSchema.parse({
        type: "object",
        properties: {
          decision: {
            type: "string",
            title: wholeTurn ? "Codex execution permission" : "Permission",
            oneOf: [
              { const: "deny", title: "Deny" },
              {
                const: "allow",
                title: wholeTurn
                  ? "Approve this execution turn"
                  : "Allow this request",
              },
            ],
            default: "deny",
          },
        },
        required: ["decision"],
      });
      return r;
    }
    const questions = Array.isArray(pending.input.questions)
      ? pending.input.questions
      : [{ question: pending.input.question ?? "Your response" }];
    if (!questions.length || questions.length > 20)
      throw new Error("Unsupported worker question; respond in the console");
    r.questions = questions.map((q) => String(q.question));
    if (new Set(r.questions).size !== r.questions.length)
      throw new Error("Duplicate worker questions; respond in the console");
    r.message = `Answer the worker's questions for task: ${task.task}`;
    const properties = Object.fromEntries(
      questions.map((q, i) => {
        const options = Array.isArray(q.options)
          ? q.options.map((o: any) => ({
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
      r = this.build(owner, kind, args);
      this.c.store.db
        .prepare("DELETE FROM form_requests WHERE expires<=?")
        .run(this.now());
      const count = this.c.store.db
        .prepare("SELECT COUNT(*) AS n FROM form_requests WHERE owner=?")
        .get(owner)!;
      if (Number(count.n) >= 500)
        throw new Error("Too many pending form requests");
      token = randomBytes(32).toString("base64url");
      this.c.store.db
        .prepare("INSERT INTO form_requests VALUES(?,?,?,?)")
        .run(hash(token), owner, this.now() + 10 * 60000, JSON.stringify(r));
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
        failed("Form submission is interrupted; inspect task state.")
      );
    }
    if (kind === "request_agent_task" && !r.form.properties.repository)
      throw new Error(
        "This saved form predates explicit project selection. Reopen the task form and select a project.",
      );
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
        let result: Task;
        if (kind === "request_agent_task") {
          const [provider, worker_profile] = String(content.worker).split(":");
          result = await this.c.start(owner, {
            ...r.args,
            repository: content.repository,
            task: content.task,
            provider,
            worker_profile,
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
              max_runtime_minutes: content.max_runtime_minutes,
              max_cost_usd:
                (content.use_cost_budget ??
                  r.form.properties.use_cost_budget?.default) === false
                  ? null
                  : content.max_cost_usd,
            },
          });
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
