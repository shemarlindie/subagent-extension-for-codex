/** Help text in order: plain text, or a link naming the setting it opens. */
export type HelpPart = string | { text: string; setting: string };

export interface SettingOption {
  value: string;
  label: string;
  description?: string;
}

export interface ModelScope {
  label: string;
  model: {
    key: string;
    label: string;
    /** Without a discovered catalog the model ID is typed instead. */
    options?: SettingOption[];
  };
  effort: {
    key: string;
    label: string;
    options: SettingOption[];
    /** The saved effort is not supported by the scope's effective model. */
    unsupported: boolean;
  };
}

interface SettingRowBase {
  key: string;
  label: string;
  help?: HelpPart[];
}

export interface SelectSettingRow extends SettingRowBase {
  kind: "select";
  options: SettingOption[];
}

export interface SwitchSettingRow extends SettingRowBase {
  kind: "switch";
}

export interface TextSettingRow extends SettingRowBase {
  kind: "text";
  maxLength: number;
  /** A regular expression the whole value must match. */
  pattern: string;
}

export interface BudgetSettingRow extends SettingRowBase {
  kind: "budget";
  /** The update tool's on/off key for this limit. */
  toggle: string;
  unit: string;
  min: number;
  max?: number;
  /** The amount shown while the limit is off, restored when it turns on. */
  amount: number;
}

export interface ModelsSettingRow {
  kind: "models";
  scopes: ModelScope[];
}

/** @discriminator kind */
export type SettingRow =
  | SelectSettingRow
  | SwitchSettingRow
  | TextSettingRow
  | BudgetSettingRow
  | ModelsSettingRow;

/** The settings dialog renders these sections as given. */
export interface SettingSection {
  id: string;
  title: string;
  help?: HelpPart[];
  rows: SettingRow[];
}
