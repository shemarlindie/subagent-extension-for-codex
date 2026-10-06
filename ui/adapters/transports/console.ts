import type {
  DownloadFile,
  Transport,
  TransportEvents,
} from "../../shared/state/types";
import { saveInBrowser } from "../../shared/utils/download";

export class ConsoleTransport implements Transport {
  readonly embedded = false;
  private events?: TransportEvents;
  private stream?: EventSource;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(
    private origin: string,
    private request: typeof fetch = fetch,
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
        "X-Codex-Subagent-Extension": "1",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      this.events?.login();
      throw new Error("Connect the console to continue.");
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Request failed");

    return result;
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.api("/api/tools/" + name, args)).result as T;
  }

  async login(token: string) {
    await this.api("/api/login", { token });
  }

  async download(file: DownloadFile) {
    saveInBrowser(file);
  }

  watch() {
    if (this.disposed) return;
    this.stream?.close();
    this.stream = this.createStream(this.origin + "/api/events");
    this.stream.onopen = () => this.events?.status("● Live");
    this.stream.onerror = () => this.events?.status("Reconnecting…");

    this.stream.addEventListener("activity", () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.events?.refresh(), 100);
    });
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.stream?.close();
  }
}
