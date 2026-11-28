/** A visual the worker showed in Chat, or a new version that replaces one. */
export interface AgentVisualPayload {
  /** The visual's number in its task. A new version keeps the number. */
  visual: number;
  title: string;
  /** Self-contained SVG or HTML. */
  code: string;
}
