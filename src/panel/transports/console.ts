import { SendRejectedError } from "../../shared/tasks/conversation/send-errors";
import { CONNECTION } from "../app/state/connection";
import type { Transport, TransportEvents } from "../app/state/types";
import { downloadJson } from "../shared/utils/download-json";
import { decodePanelToolResult } from "./event-decoding";

export class ConsoleTransport implements Transport {
  readonly embedded = false;
  // Revisions and drafts arrive as `change` and `delta` events on the event stream.
  readonly streamsChanges = true;
  readonly streamsDrafts = true;
  private events?: TransportEvents;
  private stream?: EventSource;
  private disposed = false;
  constructor(
    private origin: string,
    private request: typeof fetch = fetch.bind(globalThis),
    private createStream = (url: string) =>
      new EventSource(url, { withCredentials: true }),
  ) {}

  async connect(events: TransportEvents) {
    this.events = events;
  }

  private async api(path: string, body: unknown) {
    if (this.disposed) throw new Error("The console has closed.");

    const response = await this.request(this.origin + path, {
      credentials: "include",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Subagent-Extension-For-Codex": "1",
      },
      body: JSON.stringify(body),
    });

    // Authentication rejects a request before any tool runs, so a send was
    // not accepted and its retry identity can go.
    if (response.status === 401) {
      this.events?.login();
      throw new SendRejectedError("Connect the console to continue.");
    }

    const result = await response.json();

    if (!response.ok) {
      const Failure = result.send_rejected === true ? SendRejectedError : Error;
      throw new Failure(result.error ?? "Request failed");
    }

    return result;
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    return decodePanelToolResult<T>(
      name,
      (await this.api("/api/tools/" + name, args)).result,
      this.events?.timing,
    );
  }

  async login(token: string) {
    await this.api("/api/login", { token });
  }

  async saveJson(name: string, text: string) {
    downloadJson(name, text);

    return true;
  }

  watch() {
    if (this.disposed) return;
    this.stream?.close();
    this.stream = this.createStream(this.origin + "/api/events");
    this.stream.onopen = () => this.events?.status(CONNECTION.connected);
    this.stream.onerror = () => this.events?.status(CONNECTION.reconnecting);

    this.stream.addEventListener("change", (event) =>
      this.events?.revision(event.data),
    );

    this.stream.addEventListener("delta", (event) =>
      this.events?.draft(JSON.parse(event.data)),
    );
  }

  dispose() {
    this.disposed = true;
    this.stream?.close();
  }
}
