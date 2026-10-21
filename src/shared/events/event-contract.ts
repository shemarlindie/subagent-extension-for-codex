import type { ActivityContent } from "../providers/activity/presentation-contract.js";
import type { TaskEventPayloadMap } from "../tasks/event-contract.js";

export interface EventEnvelope {
  id: number;
  task_id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface ToolStartedPayload {
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ToolCompletedPayload {
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  error?: boolean;
  content?: string | ActivityContent[];
}

interface AgentMessageFields {
  message_id?: string;
  parent_tool_use_id?: string | null;
}

interface AgentMessagePayload extends AgentMessageFields {
  role: "assistant";
  text: string;
  content?: ActivityContent | ActivityContent[];
}

interface AgentContentPayload extends AgentMessageFields {
  role: "assistant" | "user";
  content: ActivityContent | ActivityContent[];
  text?: string;
}

interface AgentReplyPayload {
  text: string;
  turn: number;
}

interface AgentStartedPayload {
  model?: string;
  tools?: string[];
}

interface AgentCompletedPayload {
  cost_usd?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  result?: string;
  subtype?: string;
  is_error?: boolean;
  errors?: string[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface AgentInputRequiredPayload {
  request?: {
    id: string;
    tool: string;
    kind: "question" | "permission";
    input: Record<string, unknown>;
  };
}

interface AgentInputSubmittedPayload {
  approved: boolean;
}

interface AgentPermissionDecidedPayload {
  tool: string;
  input: Record<string, unknown>;
  approval_mode: "ask_user" | "parent_agent" | "auto_approve" | "deny";
  approved: boolean;
  authority: "policy";
}

interface AgentInputDecisionPayload {
  request_id: string;
  approved: boolean;
  authority: "user" | "parent";
}

export interface EventPayloadMap extends TaskEventPayloadMap {
  "tool.started": ToolStartedPayload;
  "tool.completed": ToolCompletedPayload;
  "agent.message": AgentMessagePayload;
  "agent.content": AgentContentPayload;
  "agent.reply": AgentReplyPayload;
  "agent.started": AgentStartedPayload;
  "agent.completed": AgentCompletedPayload;
  "agent.input_required": AgentInputRequiredPayload;
  "agent.input_submitted": AgentInputSubmittedPayload;
  "agent.permission_decided": AgentPermissionDecidedPayload;
  "agent.input_decision": AgentInputDecisionPayload;
}
