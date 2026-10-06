export interface Event {
  id: number;
  task_id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}
