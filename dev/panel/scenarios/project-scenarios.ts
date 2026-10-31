import type { Task } from "../../../src/shared/tasks/model";
import { docsSite, mobileApp, taskBase, timestamps } from "./scenario-context";

// Projects of uneven sizes, so All projects shows long groups stopping at
// "Show more" beside short ones. Their own thread keeps dev-thread unchanged.
const PROJECTS_THREAD = "projects-thread";

const project = (
  repository: string,
  id: string,
  title: string,
  status: Task["status"],
  start: number,
) =>
  ({
    ...taskBase,
    id,
    title,
    description: title,
    repository,
    conversation_id: PROJECTS_THREAD,
    status,
    runtime_ms: status === "queued" ? 0 : 60000,
    ...timestamps(start, 1),
  }) satisfies Task;

export const projectTasks: Task[] = [
  project(
    mobileApp.repository,
    "preview-mobile-1",
    "Add offline sync",
    "completed",
    30,
  ),
  project(
    mobileApp.repository,
    "preview-mobile-2",
    "Fix the login crash on Android",
    "failed",
    31,
  ),
  project(
    mobileApp.repository,
    "preview-mobile-3",
    "Trim the app bundle",
    "completed",
    32,
  ),
  project(
    mobileApp.repository,
    "preview-mobile-4",
    "Update push notification copy",
    "completed",
    33,
  ),
  project(
    mobileApp.repository,
    "preview-mobile-5",
    "Migrate to the new navigation API",
    "completed",
    34,
  ),
  project(
    mobileApp.repository,
    "preview-mobile-6",
    "Profile cold start time",
    "completed",
    35,
  ),
  project(
    mobileApp.repository,
    "preview-mobile-7",
    "Review the tablet layouts",
    "queued",
    36,
  ),
  project(
    mobileApp.repository,
    "preview-mobile-8",
    "Audit app permissions",
    "completed",
    37,
  ),
  project(
    docsSite.repository,
    "preview-docs-1",
    "Rewrite the quickstart",
    "completed",
    38,
  ),
];
