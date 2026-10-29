/** Help text in order: plain text, or a link naming the setting path it opens. */
export type HelpPart = string | { text: string; setting: string };

export interface SettingOption {
  value: string;
  label: string;
  description?: string;
}

export interface ModelScope {
  /** `global`, a provider or a worker profile. */
  id: string;
  label: string;
  model: {
    path: string;
    label: string;
    /** Without a discovered catalog the model ID is typed instead. */
    options?: SettingOption[];
  };
  effort: {
    path: string;
    label: string;
    options: SettingOption[];
    /** The saved effort is not supported by the scope's effective model. */
    unsupported: boolean;
  };
  /** A worker profile's custom instructions, shown collapsed under its models. */
  instructions?: ProseSetting;
}

/** Several lines of free text, such as instructions. */
export interface ProseSetting extends SettingRowBase {
  maxLength: number;
}

interface SettingRowBase {
  /** The setting's dotted path, such as `task.worker_profile`. */
  path: string;
  label: string;
  help?: HelpPart[];
  /** Other words settings search matches, such as synonyms. */
  keywords?: string[];
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

/** A limit whose `enabled` and `amount` settings sit under its path. */
export interface BudgetSettingRow extends SettingRowBase {
  kind: "budget";
  unit: string;
  min: number;
  max?: number;
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
