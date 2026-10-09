/** Correlation, project defaults and selection returned when opening the panel. */
export interface PanelOutput {
  conversation_id?: string | null;
  panel_scope: {
    conversation_id: string | null;
    repository?: string;
    revision?: string;
  };
  panel_project_candidate?: { repository: string; auto_register: boolean };
  panel_selection?: { task_id: string; tab: "chat" };
  tasks?: Record<string, unknown>[];
}
