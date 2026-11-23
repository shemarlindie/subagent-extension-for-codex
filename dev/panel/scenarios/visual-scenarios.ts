// A task whose worker shows visuals: a chart it replaces with a fixed
// version, and a small interactive page with a link.
import { workerToolNames } from "../../../src/service/features/providers/claude/runtime/worker-tool-names";
import type { Task } from "../../../src/shared/tasks/model";
import { at, taskBase, timestamps, worktree } from "./scenario-context";
import { begin, Timeline } from "./timeline";

const TOOL = workerToolNames.find((name) => name.endsWith("show_visual")) ?? "";

const signups = [
  ["Jan", 120],
  ["Feb", 150],
  ["Mar", 90],
  ["Apr", 210],
  ["May", 180],
  ["Jun", 240],
] as const;

/** A bar chart in the panel's theme colors, as workers write them. */
function chart(scale: number) {
  const bars = signups.map(([month, value], i) => {
    const height = value * scale;
    const x = 40 + i * 60;

    return `<rect x="${x}" y="${220 - height}" width="40" height="${height}" rx="4" fill="var(--accent)"/><text x="${x + 20}" y="238" text-anchor="middle" font-size="12" fill="var(--muted)">${month}</text><text x="${x + 20}" y="${214 - height}" text-anchor="middle" font-size="12" fill="var(--text)">${value}</text>`;
  });

  return `<svg viewBox="0 0 420 250" width="100%" role="img" aria-label="Monthly signups, January to June"><text x="20" y="20" font-size="14" font-weight="600" fill="var(--text)">Monthly signups</text><line x1="30" y1="220" x2="400" y2="220" stroke="var(--border)"/>${bars.join("")}</svg>`;
}

const page = `<style>
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; padding: 4px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; cursor: pointer; }
  .card:hover, .card[aria-pressed="true"] { border-color: var(--accent); }
  .value { font-size: 20px; font-weight: 600; }
  .label, p { color: var(--muted); font-size: 12px; }
  a { color: var(--accent); }
</style>
<div class="cards">
  <button class="card" aria-pressed="false"><div class="value">1,014</div><div class="label">Signups this half</div></button>
  <button class="card" aria-pressed="false"><div class="value">+100%</div><div class="label">June over January</div></button>
  <button class="card" aria-pressed="false"><div class="value">March</div><div class="label">Lowest month</div></button>
</div>
<p id="note">Select a card to pin it. Source: <a href="https://example.com/signups">signup dashboard</a>.</p>
<script>
  for (const card of document.querySelectorAll(".card")) {
    card.addEventListener("click", () => {
      const pressed = card.getAttribute("aria-pressed") === "true";
      card.setAttribute("aria-pressed", String(!pressed));
    });
  }
</script>`;

const visuals = new Timeline("preview-visuals", at(184), 7500);
begin(visuals, ["Read"]);

/** A worker's show_visual call, its result and the event the service records. */
function show(visual: number, title: string, code: string, replaces?: number) {
  const input = { title, code, ...(replaces ? { replaces } : {}) };

  visuals.toolDone(
    visuals.toolStart(TOOL, input),
    replaces ? `Visual ${visual} replaced.` : `Shown as visual ${visual}.`,
  );

  visuals.add("agent.visual", { visual, title, code }, 50);
}

visuals.say("Here's the signup trend as a chart.");
// The first version drew the bars four times too tall, so the worker fixed it.
show(1, "Monthly signups", chart(3.2));
show(1, "Monthly signups", chart(0.8), 1);
show(2, "Signup highlights", page);

const reply =
  "Signups doubled from January to June, with a dip in March. The chart and highlight cards are above.";

visuals.say(reply);
visuals.finish(reply, 1, { duration_ms: 52000, total_cost_usd: 0.09 });

export const visualTimelines = [visuals];

export const visualTasks: Task[] = [
  {
    ...taskBase,
    ...worktree(visuals.taskId),
    id: visuals.taskId,
    title: "Visuals: signup chart",
    description:
      "Chart monthly signups from this data: Jan 120, Feb 150, Mar 90, Apr 210, May 180, Jun 240.",
    worker_profile: "researcher",
    status: "completed",
    visuals: 2,
    runtime_ms: 52000,
    cost_usd: 0.09,
    completed_at: at(185),
    ...timestamps(184, 1),
  },
];
