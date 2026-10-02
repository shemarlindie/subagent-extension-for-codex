import { App } from "@modelcontextprotocol/ext-apps";
import type { Task, Event, Artifact } from "../src/model";
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const origin = (window as any).CODEX_SUBAGENT_EXTENSION_ORIGIN;
const embedded = window.parent !== window;
const bridge = new App(
  { name: "Codex subagent extension", version: "0.1.0" },
  {},
  { autoResize: true },
);
let tasks: Task[] = [],
  selected = location.pathname.match(/\/tasks\/([^/]+)/)?.[1],
  workerRoute = location.pathname.match(/\/workers\/([^/]+)/)?.[1],
  selectedArtifact = location.pathname.match(/\/artifacts\/([^/]+)/)?.[1],
  tab = location.pathname.includes("/artifacts/") ? "artifacts" : "activity",
  filter = "all",
  conversation: string | undefined,
  events: Event[] = [],
  artifacts: Artifact[] = [],
  workers: any[] = [],
  stream: EventSource | undefined,
  pollTimer: ReturnType<typeof setTimeout> | undefined,
  pollGeneration = 0,
  disposed = false;
function error(e: unknown) {
  $("error").textContent = String(e);
  setTimeout(() => ($("error").textContent = ""), 8000);
}
async function api(path: string, body?: unknown) {
  if (embedded)
    throw new Error("Use the host connection for embedded requests.");
  const r = await fetch(origin + path, {
    credentials: "include",
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-Codex-Subagent-Extension": "1",
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) {
    $("login").hidden = false;
    throw new Error("Connect the console to continue.");
  }
  const b = await r.json();
  if (!r.ok) throw new Error(b.error ?? "Request failed");
  return b;
}
async function tool(name: string, args: unknown = {}) {
  if (disposed) throw new Error("The console has closed.");
  if (embedded) {
    const r = await bridge.callServerTool({
      name,
      arguments: args as Record<string, unknown>,
    });
    if (r.isError) throw new Error(JSON.stringify(r.content));
    return name.endsWith("_agent_settings")
      ? r.structuredContent
      : (r.structuredContent as any)?.result;
  }
  return (await api("/api/tools/" + name, args)).result;
}
async function refresh() {
  tasks = await tool("list_agent_tasks", { conversation_id: conversation });
  if (disposed) return;
  renderList();
  if (selected && !tasks.some((t) => t.id === selected)) selected = undefined;
  if (!selected && !workerRoute && tasks.length) {
    selected = tasks[0].id;
    selectedArtifact = undefined;
  }
  await loadDetail();
}
async function select(id: string) {
  selected = id;
  workerRoute = undefined;
  ($("worker-view") as HTMLSelectElement).value = "";
  selectedArtifact = undefined;
  tab = "activity";
  if (!embedded) history.replaceState({}, "", `/tasks/${id}`);
  if (embedded)
    void bridge
      .updateModelContext({
        structuredContent: {
          selected_worker: null,
          selected_task: id,
          selected_artifact: null,
          summary: tasks.find((t) => t.id === id)?.task.slice(0, 500),
        },
      })
      .catch(error);
  await loadDetail();
  renderList();
}
function renderList() {
  const search = ($("search") as HTMLInputElement).value.toLowerCase();
  const scoped = tasks.filter(
    (t) => !workerRoute || `${t.provider}.${t.worker_profile}` === workerRoute,
  );
  const visible = scoped.filter(
    (t) =>
      (!search ||
        (t.task + " " + t.worker_profile).toLowerCase().includes(search)) &&
      (filter === "all" ||
        (filter === "completed"
          ? t.status === "completed"
          : !["completed", "failed", "cancelled"].includes(t.status))),
  );
  $("count").textContent =
    `${scoped.length} TASK${scoped.length === 1 ? "" : "S"}`;
  $("task-list").innerHTML = visible.length
    ? visible
        .map(
          (t) =>
            `<button class="task-row ${selected === t.id ? "selected" : ""}" data-id="${esc(t.id)}"><span class="title">${esc(t.task.slice(0, 100))}</span><span class="row-meta"><span class="badge ${t.status}">${esc(t.status)}</span>${esc(t.provider)} · ${esc(t.worker_profile.replaceAll("_", " "))}</span></button>`,
        )
        .join("")
    : '<p class="empty">No tasks here yet.</p>';
  document
    .querySelectorAll<HTMLButtonElement>("[data-id]")
    .forEach(
      (b) => (b.onclick = () => void select(b.dataset.id!).catch(error)),
    );
}
async function loadDetail() {
  if (workerRoute) {
    renderWorker();
    return;
  }
  if (!selected) {
    $("detail").innerHTML =
      '<div class="empty"><span class="eyebrow">Ready when you are</span><h2>A second perspective.<br>A separate workspace.</h2><p>Delegate a review, investigation, or implementation. Each worker gets an isolated worktree and returns inspectable results.</p><button class="primary" id="empty-delegate">Delegate your first task</button></div>';
    $("empty-delegate").onclick = () => void delegate();
    return;
  }
  [events, artifacts] = await Promise.all([
    tool("get_agent_events", { task_id: selected }),
    tool("get_agent_artifacts", { task_id: selected }),
  ]);
  if (disposed) return;
  renderDetail();
}
function renderWorker() {
  const worker = workers.find((w) =>
    w.profiles.some((p: string) => `${w.provider}.${p}` === workerRoute),
  );
  if (!worker) {
    $("detail").innerHTML =
      '<div class="empty"><h2>Worker unavailable</h2><p>Select an available worker from the list.</p></div>';
    return;
  }
  const profile = workerRoute!.slice(worker.provider.length + 1);
  const readOnly = ["researcher", "reviewer", "security_reviewer"].includes(
    profile,
  );
  $("detail").innerHTML =
    `<span class="eyebrow">Available worker</span><h2>${esc(worker.provider)} · ${esc(profile.replaceAll("_", " "))}</h2><p>${readOnly ? "Inspects an isolated worktree without editing source files." : "Can edit the isolated worktree and request execution permission."}</p><button id="worker-delegate" class="primary">Delegate to this worker</button><h3>Capabilities</h3><div class="metadata">${Object.entries(
      worker.capabilities,
    )
      .map(
        ([name, supported]) =>
          `<div><span>${esc(name.replaceAll("_", " "))}</span>${supported ? "Supported" : "Unavailable"}</div>`,
      )
      .join(
        "",
      )}</div><p>Tasks for this worker appear in the work queue. Runtime limits and provider budget capabilities apply to every task.</p>`;
  $("worker-delegate").onclick = () =>
    void delegate(`${worker.provider}:${profile}`);
}
async function chooseWorker(id?: string) {
  workerRoute = id;
  selected = undefined;
  selectedArtifact = undefined;
  if (!embedded) history.replaceState({}, "", id ? `/workers/${id}` : "/");
  if (embedded) {
    void bridge
      .updateModelContext({
        structuredContent: {
          selected_worker: id ?? null,
          selected_task: null,
          selected_artifact: null,
        },
      })
      .catch(error);
  }
  await refresh();
}
function selectArtifact(id?: string) {
  selectedArtifact = id;
  tab = "artifacts";
  if (!embedded && selected)
    history.replaceState(
      {},
      "",
      `/tasks/${selected}${id ? `/artifacts/${id}` : ""}`,
    );
  if (embedded)
    void bridge
      .updateModelContext({
        structuredContent: {
          selected_task: selected,
          selected_artifact: id ?? null,
          summary: id
            ? artifacts.find((a) => a.id === id)?.title.slice(0, 500)
            : tasks.find((t) => t.id === selected)?.task.slice(0, 500),
        },
      })
      .catch(error);
  renderDetail();
}
function renderDetail() {
  const t = tasks.find((t) => t.id === selected);
  if (!t) return;
  const controlsLocked =
    ["completed", "failed", "cancelled"].includes(t.status) ||
    t.waiting_reason === "termination_unconfirmed";
  $("detail").innerHTML =
    `<div class="detail-top"><span class="eyebrow">${esc(t.provider)} / ${esc(t.worker_profile.replaceAll("_", " "))}</span><span class="badge ${t.status}">${t.status}</span></div><h2>${esc(t.task)}</h2><div class="metadata"><div><span>Workspace</span>${esc(t.workspace?.split("/").at(-1) ?? "Preparing worktree")}</div><div><span>Runtime budget</span>${t.budget.max_runtime_minutes} min · ${t.budget.max_cost_usd === null ? "No cost limit" : `$${t.budget.max_cost_usd}`}</div><div><span>Session</span>${esc(t.session_id?.slice(0, 18) ?? "Not started")}</div><div><span>Repository</span>${esc(t.repository.split("/").at(-1))} · ${esc(t.revision)}</div><div><span>Dependencies</span>${t.depends_on.length ? esc(t.depends_on.map((d) => tasks.find((x) => x.id === d)?.task.slice(0, 25) ?? d).join(", ")) : "None"}</div><div><span>Started</span>${new Date(t.created_at).toLocaleString()}</div></div>${t.error ? `<div class="notice">${esc(t.error)}</div>` : ""}${t.pending_input ? `<div class="notice"><span class="eyebrow">Worker needs ${t.waiting_reason === "waiting_for_permission" ? "permission" : "your input"}</span><p>${esc(t.pending_input.tool)}</p><pre class="artifact">${esc(JSON.stringify(t.pending_input.input, null, 2))}</pre><button id="answer" class="primary">Respond to worker</button></div>` : ""}<div class="controls"><button data-control="steer" ${controlsLocked ? "disabled" : ""}>Steer</button><button data-control="interrupt" ${controlsLocked || t.status === "interrupted" ? "disabled" : ""}>Interrupt</button><button data-control="continue" ${t.status !== "interrupted" ? "disabled" : ""}>Continue</button><button data-control="retry" ${!["failed", "cancelled"].includes(t.status) ? "disabled" : ""}>Retry</button><button data-control="cancel" ${controlsLocked ? "disabled" : ""}>Stop</button><button id="workspace">Workspace path</button><button id="handoff">${embedded ? "Send to conversation" : "Copy for Codex"}</button></div><nav class="tabs"><button data-tab="activity" class="${tab === "activity" ? "active" : ""}">Activity <small>${events.length}</small></button><button data-tab="result" class="${tab === "result" ? "active" : ""}">Result</button><button data-tab="artifacts" class="${tab === "artifacts" ? "active" : ""}">Artifacts <small>${artifacts.length}</small></button></nav><div id="panel"></div><p class="task-id">${esc(t.id)} · Attempt ${t.attempt}</p>`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-control]")
    .forEach(
      (b) =>
        (b.onclick = () => void control(b.dataset.control!, t).catch(error)),
    );
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab!;
        renderDetail();
      }),
  );
  $("workspace").onclick = () =>
    modal(
      "Task workspace",
      `<p>The worktree is retained for inspection and session continuation.</p><pre class="artifact">${esc(t.workspace ?? "Not created yet")}</pre>`,
      async () => {},
      "Done",
    );
  $("handoff").onclick = () => handoff(t);
  if (t.pending_input) $("answer").onclick = () => answer(t);
  if (tab === "activity")
    $("panel").innerHTML = events.length
      ? events
          .slice()
          .reverse()
          .map(
            (e) =>
              `<div class="event"><time>${new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><div><strong>${esc(e.type.replaceAll(".", " / "))}</strong>${Object.keys(e.data).length ? `<pre>${esc(e.data.text ?? JSON.stringify(e.data, null, 2))}</pre>` : ""}</div></div>`,
          )
          .join("")
      : '<p class="empty">Waiting for worker activity.</p>';
  if (tab === "result")
    $("panel").innerHTML = t.result
      ? `<div class="report"><p>${esc(t.result.summary)}</p>${["findings", "evidence", "changes", "tests", "recommendations"].map((k) => `<h3>${k.toUpperCase()}</h3><ul>${(t.result![k as keyof typeof t.result] as string[]).map((v) => `<li>${esc(v)}</li>`).join("") || "<li>None reported</li>"}</ul>`).join("")}</div>`
      : '<p class="empty">Results appear when the worker completes.</p>';
  if (tab === "artifacts") {
    const shown = selectedArtifact
      ? artifacts.filter((a) => a.id === selectedArtifact)
      : artifacts;
    $("panel").innerHTML =
      (selectedArtifact
        ? '<button id="all-artifacts">All artifacts</button>'
        : "") +
      (shown.length
        ? shown
            .map(
              (a) =>
                `<h3>${esc(a.title)}</h3>${selectedArtifact ? "" : `<button data-artifact="${esc(a.id)}">Open ${esc(a.type)}</button>`}<button data-download="${esc(a.id)}">Download ${esc(a.type)}</button><pre class="artifact">${esc(a.content)}</pre>`,
            )
            .join("")
        : `<p class="empty">${selectedArtifact ? "This artifact is unavailable for the selected task." : "Reports and diffs will appear here."}</p>`);
    if (selectedArtifact) $("all-artifacts").onclick = () => selectArtifact();
    document
      .querySelectorAll<HTMLButtonElement>("[data-artifact]")
      .forEach((b) => (b.onclick = () => selectArtifact(b.dataset.artifact!)));
    document.querySelectorAll<HTMLButtonElement>("[data-download]").forEach(
      (b) =>
        (b.onclick = () => {
          const a = artifacts.find((a) => a.id === b.dataset.download)!;
          const url = URL.createObjectURL(
            new Blob([a.content], { type: a.mime_type }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = a.id + (a.type === "diff" ? ".patch" : ".json");
          link.click();
          URL.revokeObjectURL(url);
        }),
    );
  }
}
function handoff(t: Task) {
  const message = `Review delegated task ${t.id} (${t.provider}, ${t.status}).
Retrieve its current state with get_agent_task({"task_id":${JSON.stringify(t.id)}}), its full result with get_agent_result, and its reports and patches with get_agent_artifacts. Inspect the evidence before proposing next steps or applying changes.

Task excerpt: ${t.task.slice(0, 1500)}${t.task.length > 1500 ? "… (truncated)" : ""}
Worker summary excerpt: ${t.result?.summary.slice(0, 2500) ?? "No result yet."}${(t.result?.summary.length ?? 0) > 2500 ? "… (truncated)" : ""}`;
  modal(
    embedded ? "Send task to conversation" : "Copy task for Codex",
    `<p>${embedded ? "Review the message before sending it to the current conversation." : "Copy this message into your Codex conversation. You can also select and copy the text directly."}</p><label for="handoff-message">Message</label><textarea id="handoff-message" rows="12" required>${esc(message)}</textarea>`,
    async () => {
      const text = value("handoff-message");
      if (embedded) {
        const result = await bridge.sendMessage({
          role: "user",
          content: [{ type: "text", text }],
        });
        if (result.isError)
          throw new Error(
            "The host declined the message. Select and copy it to the conversation instead.",
          );
      } else {
        await navigator.clipboard.writeText(text);
      }
    },
    embedded ? "Send message" : "Copy message",
  );
}
function modal(
  title: string,
  body: string,
  submit: () => Promise<void>,
  label = "Send",
) {
  const m = $("modal");
  m.hidden = false;
  m.innerHTML = `<form class="dialog"><h2>${esc(title)}</h2>${body}<div id="form-error" class="error" role="alert"></div><footer><button type="button" id="dismiss">Cancel</button><button class="primary" id="submit">${esc(label)}</button></footer></form>`;
  $("dismiss").onclick = () => (m.hidden = true);
  m.querySelector("form")!.onsubmit = async (e) => {
    e.preventDefault();
    ($("submit") as HTMLButtonElement).disabled = true;
    try {
      await submit();
      m.hidden = true;
      await refresh();
    } catch (e) {
      $("form-error").textContent = String(e);
    } finally {
      ($("submit") as HTMLButtonElement).disabled = false;
    }
  };
  m.querySelector<HTMLInputElement>("input,textarea,select")?.focus();
}
const value = (id: string) => ($(id) as HTMLInputElement).value;
async function delegate(preferredWorker?: string) {
  let defaults: any;
  try {
    defaults = (await tool("get_agent_settings")).values;
  } catch (e) {
    error(e);
    return;
  }
  modal(
    "Delegate a task",
    `<p>Work runs asynchronously in a separate Git worktree.</p><label for="task">What should the worker do?</label><textarea id="task" required placeholder="Independently review the authentication changes…"></textarea><div class="two"><div><label for="worker">Worker</label><select id="worker">${workers.flatMap((w) => w.profiles.map((p: string) => `<option value="${esc(w.provider)}:${esc(p)}">${esc(w.provider)} · ${esc(p.replaceAll("_", " "))}</option>`)).join("")}</select></div><div><label for="revision">Revision</label><input id="revision" value="HEAD" required></div></div><div class="two"><div><label for="runtime">Runtime limit (minutes)</label><input id="runtime" type="number" min="1" max="120" value="20" required></div><div><label for="cost-enabled"><input id="cost-enabled" type="checkbox" checked style="width:auto"> Apply cost limit</label><label for="cost">Cost budget (USD)</label><input id="cost" aria-describedby="cost-note" type="number" min="0.01" max="100" value="5" step="0.01" required><p id="cost-note" hidden>Claude stops after a response reaches the budget. A response can exceed it; interrupted usage may be missing.</p></div></div><label for="deps">Wait for tasks</label><select id="deps" multiple>${tasks.map((t) => `<option value="${esc(t.id)}">${esc(t.task.slice(0, 70))}</option>`).join("")}</select>`,
    async () => {
      const [provider, worker_profile] = value("worker").split(":");
      const task = await tool("start_agent_task", {
        task: value("task"),
        provider,
        worker_profile,
        revision: value("revision"),
        conversation_id: conversation,
        depends_on: [...($("deps") as HTMLSelectElement).selectedOptions].map(
          (o) => o.value,
        ),
        budget: {
          max_runtime_minutes: Number(value("runtime")),
          max_cost_usd: ($("cost-enabled") as HTMLInputElement).checked
            ? Number(value("cost"))
            : null,
        },
      });
      selected = task.id;
      workerRoute = undefined;
      ($("worker-view") as HTMLSelectElement).value = "";
      if (!embedded) history.replaceState({}, "", `/tasks/${task.id}`);
    },
    "Start task",
  );
  const worker = $("worker") as HTMLSelectElement;
  const preferred =
    preferredWorker ??
    `${defaults.default_provider}:${defaults.default_worker_profile}`;
  if ([...worker.options].some((o) => o.value === preferred))
    worker.value = preferred;
  ($("runtime") as HTMLInputElement).value = String(
    defaults.max_runtime_minutes,
  );
  const cost = $("cost") as HTMLInputElement;
  const enabled = $("cost-enabled") as HTMLInputElement;
  cost.value = String(defaults.max_cost_usd ?? 5);
  enabled.checked = defaults.max_cost_usd !== null;
  const updateCost = () => {
    cost.disabled = !enabled.checked;
    const provider = workers.find(
      (w) => w.provider === worker.value.split(":")[0],
    );
    $("cost-note").hidden = !enabled.checked || provider?.provider !== "claude";
    cost.setCustomValidity(
      enabled.checked && provider?.capabilities.cost_budget === false
        ? "This provider cannot enforce a cost limit. Uncheck Apply cost limit to continue without one."
        : "",
    );
  };
  enabled.onchange = updateCost;
  worker.onchange = updateCost;
  updateCost();
}
async function control(action: string, t: Task) {
  if (action === "steer") {
    modal(
      "Steer the worker",
      '<label for="instruction">New instruction</label><textarea id="instruction" required></textarea>',
      async () => {
        await tool("send_agent_instruction", {
          task_id: t.id,
          message: value("instruction"),
        });
      },
    );
    return;
  }
  await tool(
    (
      {
        interrupt: "interrupt_agent_task",
        continue: "continue_agent_task",
        retry: "retry_agent_task",
        cancel: "cancel_agent_task",
      } as any
    )[action],
    { task_id: t.id },
  );
  await refresh();
}
function answer(t: Task) {
  const r = t.pending_input!;
  if (r.tool === "AskUserQuestion") {
    const questions = (
      Array.isArray(r.input.questions)
        ? r.input.questions
        : [{ question: r.input.question ?? "Your response", options: [] }]
    ) as Array<{
      question: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>;
    modal(
      "Respond to worker",
      questions
        .map(
          (q, i) =>
            `<label for="answer-${i}">${esc(q.question)}</label>${q.options?.length ? `<select id="answer-${i}" ${q.multiSelect ? "multiple" : ""}>${q.options.map((o) => `<option value="${esc(o.label)}">${esc(o.label)}${o.description ? " — " + esc(o.description) : ""}</option>`).join("")}</select><label for="custom-${i}">Or enter your own answer</label><input id="custom-${i}">` : `<textarea id="answer-${i}" required></textarea>`}`,
        )
        .join(""),
      async () => {
        const answers = Object.fromEntries(
          questions.map((q, i) => [
            q.question,
            (document.getElementById(`custom-${i}`) && value(`custom-${i}`)) ||
              (q.multiSelect
                ? [...($(`answer-${i}`) as HTMLSelectElement).selectedOptions]
                    .map((o) => o.value)
                    .join(", ")
                : value(`answer-${i}`)),
          ]),
        );
        await tool("submit_agent_input", {
          task_id: t.id,
          request_id: r.id,
          approved: true,
          input: { ...r.input, answers },
        });
      },
    );
    return;
  }
  const wholeTurn = r.tool === "CodexExecution";
  modal(
    wholeTurn ? "Codex execution permission" : "Permission request",
    `<p>${wholeTurn ? "Allow this Codex turn to execute in its task workspace? Approval covers the entire turn, including shell commands; there are no separate command approval prompts. Review the workspace and execution policy below." : "Allow this command to run on this machine? Review the complete command before approving."}</p><pre class="artifact">${esc(JSON.stringify(r.input, null, 2))}</pre><label for="approved">Decision</label><select id="approved"><option value="no">Deny</option><option value="yes">${wholeTurn ? "Approve this execution turn" : "Approve this command once"}</option></select><label for="response">Message (optional)</label><textarea id="response"></textarea>`,
    async () => {
      await tool("submit_agent_input", {
        task_id: t.id,
        request_id: r.id,
        approved: value("approved") === "yes",
        message: value("response"),
      });
    },
  );
}
function live() {
  if (disposed) return;
  stream?.close();
  clearTimeout(pollTimer);
  const generation = ++pollGeneration;
  if (embedded) {
    // The host owns MCP authentication. Browser HTTP/SSE cannot reach the
    // loopback service from a sandboxed MCP App.
    $("connection").textContent = "● Connected";
    const poll = async () => {
      if (disposed || generation !== pollGeneration) return;
      try {
        if (!document.hidden) {
          await refresh();
          if (disposed) return;
          $("connection").textContent = "● Connected";
        }
      } catch (e) {
        if (disposed) return;
        $("connection").textContent = "Reconnecting…";
        error(e);
      } finally {
        if (generation === pollGeneration)
          pollTimer = setTimeout(() => void poll(), 3000);
      }
    };
    pollTimer = setTimeout(() => void poll(), 3000);
    return;
  }
  stream = new EventSource(origin + "/api/events", { withCredentials: true });
  stream.onopen = () => ($("connection").textContent = "● Live");
  stream.onerror = () => ($("connection").textContent = "Reconnecting…");
  let timer: ReturnType<typeof setTimeout> | undefined;
  stream.addEventListener("activity", () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh().catch(error), 100);
  });
}
async function ready() {
  if (disposed) return;
  $("error").textContent = "";
  workers = await tool("list_available_workers");
  if (disposed) return;
  const picker = $("worker-view") as HTMLSelectElement;
  picker.innerHTML =
    '<option value="">All workers</option>' +
    workers
      .flatMap((w) =>
        w.profiles.map(
          (p: string) =>
            `<option value="${esc(`${w.provider}.${p}`)}">${esc(w.provider)} · ${esc(p.replaceAll("_", " "))}</option>`,
        ),
      )
      .join("");
  if (workerRoute && [...picker.options].some((o) => o.value === workerRoute))
    picker.value = workerRoute;
  picker.onchange = () =>
    void chooseWorker(picker.value || undefined).catch(error);
  $("provider-status").textContent = workers
    .map((w) =>
      w.provider === "fixture"
        ? "Fixture · no model calls"
        : w.provider === "codex"
          ? "Codex · OpenAI Agents API"
          : "Claude Agent SDK",
    )
    .join(" · ");
  await refresh();
  live();
}
$("delegate").onclick = () => void delegate();
$("search").oninput = renderList;
document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter!;
      renderList();
    }),
);
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("/api/login", { token: value("token") });
    ($("token") as HTMLInputElement).value = "";
    $("login").hidden = true;
    await ready();
  } catch (e) {
    $("login-error").textContent = String(e);
  }
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("modal").hidden = true;
});
if (embedded) {
  $("display").hidden = false;
  $("display").onclick = () =>
    void bridge.requestDisplayMode({ mode: "fullscreen" }).catch(error);
  let connected = false;
  bridge.ontoolresult = (r) => {
    if (disposed) return;
    if (!Array.isArray((r.structuredContent as any)?.tasks)) return;
    const meta = r._meta as any;
    // Apply scope before the first read when the result arrives during connect.
    // Later notifications also update the scope without exchanging credentials.
    conversation = meta?.conversation_id;
    if (connected) void ready().catch(connectionError);
  };
  bridge.onteardown = async () => {
    // Pending startup and reads may resolve after the host closes the frame.
    // They must not start another polling loop or issue subsequent tool calls.
    disposed = true;
    connected = false;
    ++pollGeneration;
    clearTimeout(pollTimer);
    stream?.close();
    return {};
  };
  const connectionError = (e: unknown) => {
    if (disposed) return;
    $("connection").textContent = "Connection failed";
    error(e);
  };
  void bridge
    .connect()
    .then(async () => {
      if (disposed) return;
      if (!bridge.getHostCapabilities()?.serverTools)
        throw new Error("This host does not support the console's MCP tools.");
      connected = true;
      $("login").hidden = true;
      // Sidebar hosts need not deliver an opening tool-result notification.
      await ready();
    })
    .catch(connectionError);
} else void ready().catch(error);
