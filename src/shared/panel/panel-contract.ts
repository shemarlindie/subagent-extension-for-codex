/** Correlation, project defaults and selection returned when opening the panel. */
export interface PanelOutput {
  conversation_id?: string | null;
  panel_scope: {
    conversation_id: string | null;
    repository?: string;
    revision?: string;
  };
  panel_project_candidate?: {
    repository: string;
    /** Absent when the folder couldn't be read. */
    git?: "ready" | "no_commits" | "none";
    auto_register: boolean;
  };
  panel_selection?: { task_id: string; tab: "chat" };
  tasks?: Record<string, unknown>[];
  /** Completed tasks the user has read that `tasks` leaves out, by repository. */
  read_completed?: Record<string, number>;
}
