import type { PanelSettings } from "../../../core/shared/settings/settings-schema";
import type { Snapshot } from "../../app/state/types";
import { errorMessage } from "../../shared/utils/error-message";

interface PanelSettingsSaverContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

/** Saves panel settings changed outside the Settings page, such as a menu toggle. */
export class PanelSettingsSaver {
  constructor(private context: PanelSettingsSaverContext) {}

  /** Shows the value at once, then saves it on the service. */
  async set<K extends keyof PanelSettings>(key: K, value: PanelSettings[K]) {
    const previous = this.context.snapshot().panelSettings[key];

    const show = (next: PanelSettings[K]) =>
      this.context.patch({
        panelSettings: {
          ...this.context.snapshot().panelSettings,
          [key]: next,
        },
      });

    show(value);

    try {
      await this.context.tool("update_settings", {
        set: { panel: { [key]: value } },
      });
    } catch (error) {
      if (this.context.closed()) return;

      // Restore the saved value unless a later change replaced it.
      if (this.context.snapshot().panelSettings[key] === value) show(previous);

      this.context.patch({
        actionFailure: `The setting could not be saved: ${errorMessage(error)}`,
      });
    }
  }
}
