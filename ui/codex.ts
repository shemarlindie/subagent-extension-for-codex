import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import type { Task, Event, Artifact, Capabilities } from "../src/model";
import {
  previewTasks,
  previewEvents,
  previewArtifacts,
} from "./codex-fixtures";
const $ = (id: string) => document.getElementById(id)!;
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const preview =
  window.parent === window &&
  new URLSearchParams(location.search).get("preview") === "1";
const app = new App(
  { name: "Delegated work", version: "0.1.0" },
  {},
  { autoResize: true },
);
type Worker = {
  provider: string;
  profiles: string[];
  capabilities: Capabilities;
};
let tasks: Task[] = [],
  workers: Worker[] = [],
  selected: string | undefined,
  conversation: string | undefined;
let events: Event[] = [],
  artifacts: Artifact[] = [],
  filter = "all",
  tab = "result",
  connected = false,
  busy = false,
  refreshing = false,
  generation = 0,
  scopeVersion = 0,
  detailSignature = "";
const dialog = $("dialog") as HTMLDialogElement;
const button = (id: string) => $(id) as HTMLButtonElement;
const value = (id: string) => ($(id) as HTMLInputElement).value;
const terminal = (t: Task) =>
  ["completed", "failed", "cancelled"].includes(t.status);
const locked = (t: Task) => t.waiting_reason === "termination_unconfirmed";
const label = (t: Task) =>
  locked(t)
    ? "Shutdown unconfirmed"
    : t.pending_input
      ? "Needs input"
      : t.waiting_reason === "waiting_for_dependency"
        ? "Waiting on dependency"
        : t.status[0].toUpperCase() + t.status.slice(1);
function error(e: unknown) {
  $("error").hidden = false;
  $("error").textContent = e instanceof Error ? e.message : String(e);
}
function clearError() {
  $("error").hidden = true;
}
function act(fn: () => Promise<unknown>) {
  return () => void fn().catch(error);
}
async function tool<T = any>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (preview) {
    if (name === "list_agent_tasks") return previewTasks as T;
    if (name === "get_agent_events")
      return previewEvents.filter(
        (e) => e.task_id === args.task_id && e.id > Number(args.after ?? 0),
      ) as T;
    if (name === "get_agent_artifacts")
      return previewArtifacts.filter((a) => a.task_id === args.task_id) as T;
    if (name === "list_available_workers")
      return [
        {
          provider: "claude",
          profiles: ["reviewer", "researcher", "implementer", "debugger"],
          capabilities: {
            cost_budget: true,
            interrupt: true,
            session_continue: true,
            interactive_input: true,
          },
        },
      ] as T;
    if (name === "get_agent_settings")
      return {
        values: {
          default_provider: "claude",
          default_worker_profile: "reviewer",
          max_runtime_minutes: 20,
          max_cost_usd: 5,
        },
      } as T;
    throw new Error(
      "Design preview only. No worker or service action was executed.",
    );
  }
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError)
    throw new Error(
      result.content
        ?.map((c) => (c.type === "text" ? c.text : ""))
        .join("\n") || "The tool failed.",
    );
  const body = result.structuredContent as Record<string, any> | undefined;
  if (!body) throw new Error("The service returned no structured data.");
  return (name.endsWith("_agent_settings") ? body : body.result) as T;
}
function renderList() {
  const search = value("search").toLowerCase();
  const visible = tasks.filter(
    (t) =>
      (!search ||
        `${t.task} ${t.worker_profile} ${t.id}`
          .toLowerCase()
          .includes(search)) &&
      (filter === "all" ||
        (filter === "active" && !terminal(t)) ||
        (filter === "attention" && (t.pending_input || locked(t))) ||
        (filter === "completed" && t.status === "completed")),
  );
  const signature =
    JSON.stringify(
      visible.map((t) => [
        t.id,
        t.task,
        t.status,
        t.waiting_reason,
        t.worker_profile,
      ]),
    ) + selected;
  $("scope").textContent = conversation
    ? "This conversation"
    : "All conversations";
  $("count").textContent = String(visible.length);
  if ($("task-list").dataset.signature === signature) return;
  $("task-list").dataset.signature = signature;
  $("task-list").innerHTML =
    visible
      .map(
        (t) =>
          `<button class="row" data-task="${esc(t.id)}" aria-current="${selected === t.id}"><span class="row-title">${esc(t.task)}</span><span class="row-meta"><span class="dot ${t.status}"></span>${esc(label(t))} · ${esc(t.worker_profile.replaceAll("_", " "))}</span></button>`,
      )
      .join("") ||
    '<p class="help" style="padding:12px">No matching tasks. Start a task or change the filter.</p>';
  // The inspector also has data-task; its evidence clicks must not select a task.
  $("task-list")
    .querySelectorAll<HTMLButtonElement>("[data-task]")
    .forEach((b) => (b.onclick = act(() => select(b.dataset.task!))));
}
async function refresh() {
  if (!connected || refreshing) return;
  refreshing = true;
  const currentGeneration = generation;
  try {
    if (!workers.length) {
      workers = await tool<Worker[]>("list_available_workers");
      button("delegate").disabled = busy;
    }
    const next = await tool<Task[]>(
      "list_agent_tasks",
      conversation ? { conversation_id: conversation } : {},
    );
    if (currentGeneration !== generation) return;
    tasks = next;
    if (selected && !tasks.some((t) => t.id === selected)) {
      selected = undefined;
      generation++;
    }
    if (!selected && tasks.length && window.innerWidth > 640) {
      selected = tasks.find((t) => t.pending_input)?.id ?? tasks[0].id;
      tab = tasks.find((t) => t.id === selected)?.result
        ? "result"
        : "activity";
    }
    renderList();
    await loadDetail();
    $("connection").textContent = preview
      ? "Fixture preview"
      : "Connected · refreshes every 5s";
    clearError();
  } catch (e) {
    $("connection").textContent = "Connection interrupted";
    throw e;
  } finally {
    refreshing = false;
  }
}
async function select(id: string) {
  selected = id;
  generation++;
  events = [];
  artifacts = [];
  detailSignature = "";
  tab = tasks.find((t) => t.id === id)?.result ? "result" : "activity";
  renderList();
  await loadDetail();
  void shareSelection().catch(error);
}
async function shareSelection(artifactId?: string) {
  if (
    preview ||
    !app.getHostCapabilities()?.updateModelContext?.structuredContent
  )
    return;
  // Selection is context, never an automatic follow-up or a patch application.
  await app.updateModelContext({
    structuredContent: {
      selected_task: selected ?? null,
      selected_artifact: artifactId ?? null,
    },
  });
}
async function loadDetail() {
  const id = selected,
    currentGeneration = generation;
  if (!id) {
    renderDetail();
    return;
  }
  const [nextEvents, nextArtifacts] = await Promise.all([
    loadEvents(id),
    tool<Artifact[]>("get_agent_artifacts", { task_id: id }),
  ]);
  if (id !== selected || currentGeneration !== generation) return;
  events = nextEvents;
  artifacts = nextArtifacts;
  renderDetail();
}
async function loadEvents(id: string) {
  // Drain the service's 1,000-event pages, retaining only the visible tail.
  let recent = events.filter((e) => e.task_id === id),
    after = recent.at(-1)?.id ?? 0;
  for (;;) {
    const page = await tool<Event[]>("get_agent_events", {
      task_id: id,
      after,
    });
    if (!page.length) return recent;
    recent = [...recent, ...page].slice(-200);
    const cursor = page.at(-1)!.id;
    if (page.length < 1000 || cursor <= after || selected !== id) return recent;
    after = cursor;
  }
}
function renderDetail() {
  const t = tasks.find((t) => t.id === selected);
  document.body.dataset.selected = String(Boolean(t));
  if (!t) {
    // A cleared view must not reuse the previous task's render signature.
    detailSignature = "";
    delete $("detail").dataset.task;
    $("detail").innerHTML =
      '<div class="empty"><span class="eyebrow">A separate workspace. A focused task.</span><h1>Keep your flow.<br>Delegate the next step.</h1><p>Give Claude a review, investigation, or implementation to work on while you stay in Codex.</p><button id="empty-start" class="primary">New task</button></div>';
    button("empty-start").disabled = !connected || busy;
    button("empty-start").onclick = act(delegate);
    return;
  }
  const signature = JSON.stringify([
    t,
    events,
    artifacts,
    tab,
    busy,
    app.getHostCapabilities()?.message,
  ]);
  if (signature === detailSignature) return;
  detailSignature = signature;
  const previousTask = $("detail").dataset.task;
  const keepView = previousTask === t.id;
  const detailsOpen =
    keepView && Boolean($("detail").querySelector("details")?.open);
  const focused =
    keepView && $("detail").contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
  const focusedId = focused?.id,
    focusedAction = focused?.dataset.action;
  const scrollPositions = new Map<string, number>();
  if (keepView)
    $("detail")
      .querySelectorAll<HTMLElement>("pre[data-scroll]")
      .forEach((p) => scrollPositions.set(p.dataset.scroll!, p.scrollTop));
  $("detail").dataset.task = t.id;
  const can = workers.find((w) => w.provider === t.provider)?.capabilities;
  const controls = !terminal(t) && !locked(t) && !busy;
  $("detail").innerHTML =
    `<button id="back" class="back quiet">← Tasks</button><div class="eyebrow"><span class="dot ${t.status}"></span>${esc(label(t))}<span> / ${esc(t.provider)} · ${esc(t.worker_profile.replaceAll("_", " "))}</span></div><h1>${esc(t.task)}</h1><div class="meta"><span>${esc(t.revision)} · isolated worktree</span><span>${t.budget.max_runtime_minutes} min limit</span><span>${t.budget.max_cost_usd === null ? "No cost limit" : `$${t.budget.max_cost_usd} budget`}</span></div>${locked(t) ? '<div class="callout attention"><strong>Worker shutdown needs investigation</strong><p>Termination is unconfirmed. Controls are locked. Bring this task to Codex to inspect the worker before continuing.</p></div>' : t.pending_input ? `<div class="callout attention"><strong>${t.pending_input.tool === "AskUserQuestion" ? "Claude has a question" : "Permission needed"}</strong><p>${esc(t.pending_input.tool === "AskUserQuestion" ? "Review the worker’s question and respond to this request." : (t.pending_input.input.description ?? t.pending_input.tool))}</p><button id="respond" class="primary" ${busy ? "disabled" : ""}>Review request</button></div>` : ""}${t.error && !locked(t) ? `<div class="callout attention">${esc(t.error)}</div>` : ""}<div class="actions">${controls ? `<button data-action="steer">Steer</button>${can?.interrupt && t.status !== "interrupted" ? '<button data-action="interrupt">Interrupt</button>' : ""}${t.status === "interrupted" && can?.session_continue ? '<button data-action="continue">Continue</button>' : ""}<button data-action="cancel">Cancel task</button>` : ""}${["failed", "cancelled"].includes(t.status) && !locked(t) ? `<button data-action="retry" ${busy ? "disabled" : ""}>New attempt</button>` : ""}<button id="handoff">${!preview && app.getHostCapabilities()?.message?.text ? "Bring to Codex" : "Prepare handoff"}</button></div><nav class="tabs" role="tablist" aria-label="Task evidence">${["result", "changes", "activity"].map((k) => `<button id="tab-${k}" role="tab" aria-controls="panel" aria-selected="${tab === k}" data-tab="${k}">${k === "result" ? "Result" : k === "changes" ? `Artifacts (${artifacts.length})` : `Activity (${events.length})`}</button>`).join("")}</nav><div id="panel" role="tabpanel" aria-labelledby="tab-${tab}"></div><details><summary>Task details</summary><dl class="facts">${Object.entries(
      {
        "Task ID": t.id,
        Workspace: t.workspace ?? "Preparing",
        Repository: t.repository,
        "Base commit": t.base_commit ?? t.revision,
        Session: t.session_id ?? "Not started",
        Dependencies: t.depends_on.join(", ") || "None",
        Attempt: t.attempt,
        "Runtime used": `${Math.round(t.runtime_ms / 1000)}s`,
        "Reported cost":
          t.cost_usd === undefined
            ? "Unavailable"
            : `$${t.cost_usd.toFixed(3)}`,
      },
    )
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join("")}</dl></details>`;
  $("back").onclick = () => {
    selected = undefined;
    generation++;
    detailSignature = "";
    renderList();
    renderDetail();
    void shareSelection().catch(error);
  };
  document
    .querySelectorAll<HTMLButtonElement>("[data-action]")
    .forEach((b) => (b.onclick = act(() => control(b.dataset.action!, t))));
  const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  tabs.forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab!;
        renderDetail();
        $(b.id).focus();
      }),
  );
  tabs.forEach((b, index) => {
    b.tabIndex = b.dataset.tab === tab ? 0 : -1;
    b.onkeydown = (e) => {
      const next =
        e.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : e.key === "ArrowLeft"
            ? (index + tabs.length - 1) % tabs.length
            : e.key === "Home"
              ? 0
              : e.key === "End"
                ? tabs.length - 1
                : undefined;
      if (next === undefined) return;
      e.preventDefault();
      tabs[next].click();
    };
  });
  $("handoff").onclick = () => handoff(t);
  if (t.pending_input && !locked(t)) $("respond").onclick = () => respond(t);
  if (tab === "result")
    $("panel").innerHTML = t.result
      ? `<div class="report"><p>${esc(t.result.summary)}</p>${(["findings", "evidence", "changes", "tests", "recommendations"] as const).map((k) => `<h3>${k[0].toUpperCase() + k.slice(1)}</h3>${t.result![k].length ? `<ul>${t.result![k].map((v) => `<li>${esc(v)}</li>`).join("")}</ul>` : '<p class="help">None reported</p>'}`).join("")}</div>`
      : '<p class="muted">The worker’s summary and evidence appear here when the task finishes.</p>';
  if (tab === "activity")
    $("panel").innerHTML = events.length
      ? events
          .slice()
          .reverse()
          .map(
            (e) =>
              `<div class="event"><time>${esc(new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</time><div><strong>${esc(e.type.replaceAll(".", " / "))}</strong>${Object.keys(e.data).length ? `<pre data-scroll="event-${e.id}">${esc(e.data.text ?? JSON.stringify(e.data, null, 2))}</pre>` : ""}</div></div>`,
          )
          .join("")
      : '<p class="muted">Waiting for worker activity.</p>';
  if (tab === "activity" && events.length === 200)
    $("panel").insertAdjacentHTML(
      "afterbegin",
      '<p class="help">Showing the most recent 200 events.</p>',
    );
  if (tab === "changes") {
    $("panel").innerHTML =
      '<p class="help">Inspect reports and patches here. Applying changes is a separate step in Codex.</p>' +
      (artifacts.length
        ? artifacts
            .map(
              (a) =>
                `<article class="artifact"><div class="artifact-head"><strong>${esc(a.title)}</strong><small>${esc(a.type)}</small><button data-artifact="${esc(a.id)}">Inspect</button></div><pre data-scroll="artifact-${esc(a.id)}">${
                  a.type === "diff"
                    ? a.content
                        .split("\n")
                        .map(
                          (line) =>
                            `<span class="diff-line ${line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : ""}">${esc(line)}</span>`,
                        )
                        .join("")
                    : esc(a.content)
                }</pre></article>`,
            )
            .join("")
        : '<p class="muted">No artifacts yet.</p>');
    document.querySelectorAll<HTMLButtonElement>("[data-artifact]").forEach(
      (b) =>
        (b.onclick = act(async () => {
          const a = artifacts.find((a) => a.id === b.dataset.artifact)!;
          modal(
            a.title,
            `<pre>${esc(a.content)}</pre>`,
            async () => {},
            "Done",
          );
          void shareSelection(a.id).catch(error);
        })),
    );
  }
  if (detailsOpen) $("detail").querySelector("details")!.open = true;
  $("detail")
    .querySelectorAll<HTMLElement>("pre[data-scroll]")
    .forEach((p) => {
      p.scrollTop = scrollPositions.get(p.dataset.scroll!) ?? 0;
    });
  if (focusedId)
    document.getElementById(focusedId)?.focus({ preventScroll: true });
  else if (focusedAction)
    [...$("detail").querySelectorAll<HTMLElement>("[data-action]")]
      .find((b) => b.dataset.action === focusedAction)
      ?.focus({ preventScroll: true });
}
function modal(
  title: string,
  body: string,
  submit: () => Promise<void>,
  submitLabel = "Send",
) {
  if (dialog.open) return;
  const trigger = document.activeElement as HTMLElement | null;
  const formScope = scopeVersion;
  const triggerId = trigger?.id,
    triggerAction = trigger?.dataset.action,
    triggerArtifact = trigger?.dataset.artifact;
  dialog.innerHTML = `<form><h2 id="dialog-title">${esc(title)}</h2>${body}<div id="form-error" class="form-error" role="alert"></div><footer><button type="button" id="dismiss">Cancel</button><button id="submit" class="primary">${esc(submitLabel)}</button></footer></form>`;
  dialog.showModal();
  dialog.onclose = () => {
    let replacement: HTMLElement | null | undefined;
    if (formScope === scopeVersion) {
      if (trigger?.isConnected) replacement = trigger;
      else if (triggerId) replacement = document.getElementById(triggerId);
      else
        replacement = [
          ...$("detail").querySelectorAll<HTMLElement>(
            "[data-action],[data-artifact]",
          ),
        ].find(
          (b) =>
            (triggerAction && b.dataset.action === triggerAction) ||
            (triggerArtifact && b.dataset.artifact === triggerArtifact),
        );
    }
    (replacement ?? $("delegate")).focus({ preventScroll: true });
  };
  $("dismiss").onclick = () => dialog.close();
  dialog.querySelector("form")!.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    // Keep mutations and messages bound to the scope reviewed in this form.
    if (formScope !== scopeVersion) {
      $("form-error").textContent =
        "The conversation changed. Close this form and reopen it in the current scope.";
      button("submit").disabled = true;
      return;
    }
    busy = true;
    button("submit").disabled = true;
    button("dismiss").disabled = true;
    button("delegate").disabled = true;
    dialog.oncancel = (e) => e.preventDefault();
    renderDetail();
    let succeeded = false;
    try {
      await submit();
      // A dispatched operation cannot be undone by a later host scope change.
      if (formScope !== scopeVersion)
        throw new Error(
          "The conversation changed while this request was in progress. Inspect its outcome in the original scope before retrying.",
        );
      succeeded = true;
      dialog.close();
    } catch (e) {
      $("form-error").textContent = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      button("submit").disabled = formScope !== scopeVersion;
      button("dismiss").disabled = false;
      button("delegate").disabled = !connected;
      dialog.oncancel = null;
      renderDetail();
    }
    if (succeeded) await refresh().catch(error);
  };
  dialog.querySelector<HTMLElement>("textarea,input,select,button")?.focus();
}
async function delegate() {
  if (dialog.open || busy) return;
  const formScope = scopeVersion,
    formConversation = conversation;
  const defaults = (await tool("get_agent_settings")).values;
  if (dialog.open || busy || formScope !== scopeVersion) return;
  const choices = workers
    .flatMap((w) =>
      w.profiles.map(
        (p) =>
          `<option value="${esc(w.provider)}:${esc(p)}">${esc(w.provider)} · ${esc(p.replaceAll("_", " "))}</option>`,
      ),
    )
    .join("");
  if (!choices)
    throw new Error(
      "No workers are available. Check service configuration in Codex.",
    );
  modal(
    "New delegated task",
    `<p class="form-note">Give the worker a focused outcome and the evidence you expect back. Work starts from a committed revision in a separate worktree.</p><label for="task">Task</label><textarea id="task" required maxlength="20000" placeholder="Review the authentication boundary. Cite findings with file paths and suggest next steps."></textarea><div class="two"><div><label for="worker">Worker</label><select id="worker">${choices}</select></div><div><label for="revision">Revision</label><input id="revision" value="HEAD" required></div></div><label for="context">Context to include (optional)</label><textarea id="context" maxlength="20000" placeholder="Relevant files, constraints, or prior findings. Conversation context is not attached automatically."></textarea><div class="two"><div><label for="runtime">Runtime limit · minutes</label><input id="runtime" type="number" min="0.1" max="120" step="any" value="${esc(defaults.max_runtime_minutes)}" required></div><div><label for="cost-mode">Cost limit</label><select id="cost-mode"><option value="limited">Apply cost budget</option><option value="none">No cost limit</option></select></div></div><label for="cost">Cost budget · USD</label><input id="cost" type="number" min="0.01" max="100" step="0.01" value="${esc(defaults.max_cost_usd ?? 5)}" required><p id="cost-note" class="help"></p><label for="deps">Wait for tasks (optional)</label><select id="deps" multiple>${tasks.map((t) => `<option value="${esc(t.id)}">${esc(t.task.slice(0, 80))}</option>`).join("")}</select>`,
    async () => {
      const [provider, worker_profile] = value("worker").split(":");
      const task = await tool<Task>("start_agent_task", {
        task: value("task"),
        provider,
        worker_profile,
        revision: value("revision"),
        ...(formConversation ? { conversation_id: formConversation } : {}),
        context: value("context").trim() ? [value("context")] : [],
        depends_on: [...($("deps") as HTMLSelectElement).selectedOptions].map(
          (o) => o.value,
        ),
        budget: {
          max_runtime_minutes: Number(value("runtime")),
          max_cost_usd:
            value("cost-mode") === "none" ? null : Number(value("cost")),
        },
      });
      if (formScope !== scopeVersion) return;
      tasks = [task, ...tasks.filter((t) => t.id !== task.id)];
      selected = task.id;
      generation++;
      events = [];
      artifacts = [];
      tab = "activity";
      detailSignature = "";
    },
    "Start task",
  );
  const worker = $("worker") as HTMLSelectElement,
    mode = $("cost-mode") as HTMLSelectElement,
    cost = $("cost") as HTMLInputElement;
  const preferred = `${defaults.default_provider}:${defaults.default_worker_profile}`;
  if ([...worker.options].some((o) => o.value === preferred))
    worker.value = preferred;
  mode.value = defaults.max_cost_usd === null ? "none" : "limited";
  const update = () => {
    const w = workers.find((w) => w.provider === worker.value.split(":")[0]);
    cost.disabled = mode.value === "none";
    mode.setCustomValidity(
      mode.value === "limited" && !w?.capabilities.cost_budget
        ? "This worker cannot enforce a cost budget. Choose No cost limit."
        : "",
    );
    $("cost-note").textContent =
      mode.value === "none"
        ? "Only the runtime limit applies."
        : w?.provider === "claude"
          ? "Claude checks cost after a response. The budget may be exceeded; interrupted usage may be missing."
          : w?.capabilities.cost_budget
            ? "Provider cost budget applies."
            : "This provider requires No cost limit.";
  };
  worker.onchange = update;
  mode.onchange = update;
  update();
}
async function control(action: string, t: Task) {
  const formScope = scopeVersion;
  if (action === "steer" || action === "continue") {
    modal(
      action === "steer" ? "Steer task" : "Continue task",
      `<p class="form-note">${action === "steer" ? "A running turn will be interrupted and continued with your instruction." : "Continue in the existing workspace and native session."}</p><label for="instruction">${action === "steer" ? "New instruction" : "Instruction (optional)"}</label><textarea id="instruction" maxlength="20000" ${action === "steer" ? "required" : ""}></textarea>`,
      async () => {
        await tool(
          action === "steer" ? "send_agent_instruction" : "continue_agent_task",
          {
            task_id: t.id,
            ...(value("instruction").trim()
              ? { message: value("instruction") }
              : {}),
          },
        );
      },
      action === "steer" ? "Send instruction" : "Continue",
    );
    return;
  }
  modal(
    action === "cancel"
      ? "Cancel task?"
      : action === "retry"
        ? "Start a new attempt?"
        : "Interrupt task?",
    `<p>${action === "cancel" ? "Stop this task. Its workspace and artifacts will be retained." : action === "retry" ? "Create another task from the original request. This starts a new worker attempt with the original budgets." : "Stop current execution and preserve the workspace and session for continuation."}</p><p class="form-note">${esc(t.task)}</p>`,
    async () => {
      const next = await tool<Task>(
        (
          {
            cancel: "cancel_agent_task",
            interrupt: "interrupt_agent_task",
            retry: "retry_agent_task",
          } as Record<string, string>
        )[action],
        { task_id: t.id },
      );
      if (action === "retry" && formScope === scopeVersion) {
        selected = next.id;
        tasks = [next, ...tasks.filter((t) => t.id !== next.id)];
        generation++;
        tab = "activity";
      }
    },
    action === "cancel"
      ? "Cancel task"
      : action === "retry"
        ? "Start new attempt"
        : "Interrupt",
  );
}
function respond(t: Task) {
  const request = t.pending_input!;
  if (request.tool === "AskUserQuestion") {
    const questions = (
      Array.isArray(request.input.questions)
        ? request.input.questions
        : [{ question: request.input.question ?? "Your response" }]
    ) as {
      question: string;
      options?: { label: string; description?: string }[];
      multiSelect?: boolean;
    }[];
    modal(
      "Respond to Claude",
      questions
        .map(
          (q, i) =>
            `<label for="answer-${i}">${esc(q.question)}</label>${q.options?.length ? `<select id="answer-${i}" ${q.multiSelect ? "multiple" : ""} required>${q.multiSelect ? "" : '<option value="" selected disabled>Choose an answer</option>'}${q.options.map((o) => `<option value="${esc(o.label)}">${esc(o.label)}${o.description ? ` — ${esc(o.description)}` : ""}</option>`).join("")}</select><label for="custom-${i}">Or write your own answer</label><input id="custom-${i}">` : `<textarea id="answer-${i}" required></textarea>`}`,
        )
        .join(""),
      async () => {
        const answers = Object.fromEntries(
          questions.map((q, i) => {
            const custom = document.getElementById(`custom-${i}`)
              ? value(`custom-${i}`).trim()
              : "";
            const answer =
              custom ||
              (q.multiSelect
                ? [...($(`answer-${i}`) as HTMLSelectElement).selectedOptions]
                    .map((o) => o.value)
                    .join(", ")
                : value(`answer-${i}`).trim());
            if (!answer)
              throw new Error("Answer each question before sending.");
            return [q.question, answer];
          }),
        );
        await tool("submit_agent_input", {
          task_id: t.id,
          request_id: request.id,
          approved: true,
          input: { ...request.input, answers },
        });
      },
      "Send answer",
    );
    questions.forEach((_q, i) => {
      const custom = document.getElementById(
        `custom-${i}`,
      ) as HTMLInputElement | null;
      if (custom)
        custom.oninput = () =>
          (($(`answer-${i}`) as HTMLSelectElement).required =
            !custom.value.trim());
    });
    return;
  }
  modal(
    "Review permission request",
    `<p class="form-note">${request.tool === "CodexExecution" ? "Approval covers the entire execution turn, including shell commands." : "Review the full request before allowing the worker to proceed."}</p><pre>${esc(JSON.stringify(request.input, null, 2))}</pre><label for="decision">Decision</label><select id="decision"><option value="deny">Deny</option><option value="approve">${request.tool === "CodexExecution" ? "Approve this execution turn" : "Approve this request once"}</option></select><label for="response">Message (optional)</label><textarea id="response" maxlength="20000"></textarea>`,
    async () => {
      await tool("submit_agent_input", {
        task_id: t.id,
        request_id: request.id,
        approved: value("decision") === "approve",
        message: value("response"),
      });
    },
    "Submit decision",
  );
}
function handoff(t: Task) {
  const canSend = !preview && Boolean(app.getHostCapabilities()?.message?.text);
  const message = `Review delegated task ${t.id} (${t.provider}, ${t.status}).\nRetrieve current state with get_agent_task, full results with get_agent_result, and reports/patches with get_agent_artifacts using task_id=${JSON.stringify(t.id)}. Inspect the evidence before proposing next steps or applying changes.\n\nTask excerpt: ${t.task.slice(0, 1500)}\nSummary excerpt: ${t.result?.summary.slice(0, 2500) ?? "No result yet."}`;
  modal(
    "Bring task to Codex",
    `<p class="form-note">${canSend ? "Review or edit the message before sending it to this conversation." : "This host has not advertised message delivery. Select and copy this message into Codex."}</p><label for="handoff-message">Message</label><textarea id="handoff-message" rows="12" required>${esc(message)}</textarea>`,
    async () => {
      if (!canSend) return;
      const result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: value("handoff-message") }],
      });
      if (result.isError)
        throw new Error(
          "The host declined delivery. Select and copy the message into Codex instead.",
        );
    },
    canSend ? "Send to conversation" : "Done",
  );
}
function hostContext() {
  const ctx = app.getHostContext();
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  const mode = ctx?.displayMode === "fullscreen" ? "inline" : "fullscreen";
  $("expand").hidden = !ctx?.availableDisplayModes?.includes(mode);
  $("expand").textContent =
    ctx?.displayMode === "fullscreen" ? "Collapse" : "Expand";
}
$("delegate").onclick = act(delegate);
$("refresh").onclick = act(refresh);
$("search").oninput = renderList;
document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter!;
      document
        .querySelectorAll<HTMLButtonElement>("[data-filter]")
        .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderList();
    }),
);
$("expand").onclick = act(async () => {
  const ctx = app.getHostContext();
  const mode = ctx?.displayMode === "fullscreen" ? "inline" : "fullscreen";
  if (!ctx?.availableDisplayModes?.includes(mode)) return;
  await app.requestDisplayMode({
    mode,
  });
});
app.onhostcontextchanged = () => hostContext();
app.ontoolresult = (r) => {
  // Only opener results carry this marker; ordinary tool output cannot reset scope.
  const data = r.structuredContent as Record<string, unknown> | undefined;
  const scope = data?.panel_scope as { conversation_id?: unknown } | undefined;
  if (
    !scope ||
    !(
      typeof scope.conversation_id === "string" ||
      scope.conversation_id === null
    )
  )
    return;
  const next = scope.conversation_id ?? undefined;
  if (conversation !== next) {
    conversation = next;
    scopeVersion++;
    generation++;
    tasks = [];
    selected = undefined;
    events = [];
    artifacts = [];
    detailSignature = "";
    if (dialog.open) {
      if (!busy) dialog.close();
      else {
        $("form-error").textContent =
          "The conversation changed while a request is in progress. Inspect its outcome before retrying.";
        button("submit").disabled = true;
      }
    }
    renderList();
    renderDetail();
  }
  if (connected) void refresh().catch(error);
};
async function start() {
  if (preview) {
    $("preview").hidden = false;
    applyDocumentTheme(
      new URLSearchParams(location.search).get("theme") === "dark"
        ? "dark"
        : "light",
    );
  } else if (window.parent === window) {
    $("connection").textContent = "Open through MCP";
    $("task-list").innerHTML =
      '<p class="help">Ask Codex to call open_codex_subagent_extension. For a standalone design preview, add ?preview=1 to this file’s URL.</p>';
    return;
  } else {
    await app.connect();
    hostContext();
    if (!app.getHostCapabilities()?.serverTools)
      throw new Error(
        "This host does not advertise MCP Apps tool calls. Use the existing task tools in Codex.",
      );
  }
  connected = true;
  if (!preview)
    setInterval(() => {
      if (!document.hidden && !busy) void refresh().catch(error);
    }, 5000);
  await refresh();
}
void start().catch(error);
