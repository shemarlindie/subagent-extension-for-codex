import { setTimeout } from "node:timers/promises";

import type { ProviderTaskPolicy } from "../../src/service/features/providers/task-policy.js";
import type {
  Provider,
  RunContext,
  TurnOutput,
} from "../../src/service/features/providers/types.js";
import type { ProviderMetadata } from "../../src/shared/providers/metadata.js";
import type {
  ModelChoice,
  ProviderReadiness,
} from "../../src/shared/providers/types.js";
import type { Task } from "../../src/shared/tasks/model.js";
import {
  cloneFixtureModel,
  createFixtureProviderMetadata,
  fixtureModels,
  fixtureProviderCapabilities,
} from "./fixture-provider-metadata.js";
import { fixtureTaskPolicy } from "./fixture-provider-policy.js";
import {
  type FixtureProviderRunState,
  runFixtureTurn,
} from "./fixture-provider-runner.js";

export interface FixtureProviderOptions {
  readiness?: "ready" | "unavailable" | "error";
  readinessDelayMs?: number;
  models?: "default" | "empty" | "error" | "error-once";
  modelsDelayMs?: number;
  modelChoices?: ModelChoice[];
  deleteSessionError?: boolean;
  closeError?: boolean;
}

/**
 * A development-only worker that makes no model calls, for the demo service
 * (dev/service/demo-service.ts) and tests. It is outside src/, so it never ships.
 */
export class FixtureProvider implements Provider {
  id = "fixture";
  metadata: ProviderMetadata = createFixtureProviderMetadata();
  capabilities = { ...fixtureProviderCapabilities };

  private runState: FixtureProviderRunState = {
    sessions: new Map(),
    invalidatedTasks: new Set(),
  };

  taskPolicy: ProviderTaskPolicy;
  private modelsMode: NonNullable<FixtureProviderOptions["models"]>;
  private readinessMode: NonNullable<FixtureProviderOptions["readiness"]>;
  private readinessDelayMs: number;
  private modelsDelayMs: number;
  private modelChoices: ModelChoice[];
  private modelFailurePending: boolean;
  private deleteSessionError: boolean;
  private closeError: boolean;

  constructor(options: FixtureProviderOptions = {}) {
    this.modelsMode = options.models ?? "default";
    this.readinessMode = options.readiness ?? "ready";
    this.readinessDelayMs = Math.max(0, options.readinessDelayMs ?? 0);
    this.modelsDelayMs = Math.max(0, options.modelsDelayMs ?? 0);

    this.modelChoices = (options.modelChoices ?? fixtureModels).map(
      cloneFixtureModel,
    );

    this.modelFailurePending = this.modelsMode === "error-once";
    this.deleteSessionError = options.deleteSessionError ?? false;
    this.closeError = options.closeError ?? false;

    this.taskPolicy = {
      ...fixtureTaskPolicy,
      validateSession: async (task) => {
        const session = task.session_id
          ? this.runState.sessions.get(task.session_id)
          : undefined;

        if (!session || session.stateRef !== task.session_state_ref) {
          throw new Error(
            "Fixture session is unavailable in this service process",
          );
        }
      },
    };
  }

  async readiness(): Promise<ProviderReadiness> {
    if (this.readinessDelayMs) await setTimeout(this.readinessDelayMs);

    if (this.readinessMode === "error") {
      throw new Error("Fixture readiness check failed.");
    }

    if (this.readinessMode === "unavailable") {
      return {
        ready: false,
        message: "Fixture readiness was configured as unavailable.",
        details: { runtime: "fixture", configured: "unavailable" },
      };
    }

    return {
      ready: true,
      details: { runtime: "fixture", model_calls: "none" },
    };
  }

  async models() {
    if (this.modelsDelayMs) await setTimeout(this.modelsDelayMs);

    if (this.modelsMode === "error") {
      throw new Error("Fixture model discovery failed.");
    }

    if (this.modelsMode === "error-once" && this.modelFailurePending) {
      this.modelFailurePending = false;
      throw new Error("Fixture model discovery failed once.");
    }

    if (this.modelsMode === "empty") return [];

    return this.modelChoices.map(cloneFixtureModel);
  }

  async deleteSession(task: Task) {
    if (this.deleteSessionError) {
      throw new Error("Fixture session deletion failed.");
    }

    if (task.session_id) this.runState.sessions.delete(task.session_id);
    this.runState.invalidatedTasks.delete(task.id);
  }

  async close() {
    if (this.closeError) throw new Error("Fixture provider close failed.");
    this.runState.sessions.clear();
    this.runState.invalidatedTasks.clear();
  }

  async run(c: RunContext, prompt: string): Promise<TurnOutput> {
    return runFixtureTurn(c, prompt, this.runState);
  }
}
