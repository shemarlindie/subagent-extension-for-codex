// Checked by tsconfig.test.json without running a Vitest suite.
import { expectTypeOf } from "vitest";
import { z } from "zod";

import { panelOutputSchema } from "../../src/shared/panel/panel-contract.generated.js";
import type { PanelOutput } from "../../src/shared/panel/panel-contract.js";
import {
  claudeStartOptionsSchema,
  claudeTaskOptionsSchema,
} from "../../src/shared/providers/claude/task-options-contract.generated.js";
import type {
  ClaudeStartOptions,
  ClaudeTaskOptions,
} from "../../src/shared/providers/claude/task-options-contract.js";
import {
  budgetSettingRowSchema,
  helpPartSchema,
  modelScopeSchema,
  modelsSettingRowSchema,
  selectSettingRowSchema,
  settingOptionSchema,
  settingRowSchema,
  settingSectionSchema,
  switchSettingRowSchema,
  textSettingRowSchema,
} from "../../src/shared/settings/document-contract.generated.js";
import type {
  BudgetSettingRow,
  HelpPart,
  ModelScope,
  ModelsSettingRow,
  SelectSettingRow,
  SettingOption,
  SettingRow,
  SettingSection,
  SwitchSettingRow,
  TextSettingRow,
} from "../../src/shared/settings/document-contract.js";

expectTypeOf<z.output<typeof panelOutputSchema>>().toEqualTypeOf<PanelOutput>();

expectTypeOf<
  z.output<typeof claudeStartOptionsSchema>
>().toEqualTypeOf<ClaudeStartOptions>();

expectTypeOf<
  z.output<typeof claudeTaskOptionsSchema>
>().toEqualTypeOf<ClaudeTaskOptions>();

expectTypeOf<z.output<typeof helpPartSchema>>().toEqualTypeOf<HelpPart>();

expectTypeOf<
  z.output<typeof settingOptionSchema>
>().toEqualTypeOf<SettingOption>();

expectTypeOf<z.output<typeof modelScopeSchema>>().toEqualTypeOf<ModelScope>();
expectTypeOf<z.output<typeof settingRowSchema>>().toEqualTypeOf<SettingRow>();

expectTypeOf<
  z.output<typeof selectSettingRowSchema>
>().toEqualTypeOf<SelectSettingRow>();

expectTypeOf<
  z.output<typeof switchSettingRowSchema>
>().toEqualTypeOf<SwitchSettingRow>();

expectTypeOf<
  z.output<typeof textSettingRowSchema>
>().toEqualTypeOf<TextSettingRow>();

expectTypeOf<
  z.output<typeof budgetSettingRowSchema>
>().toEqualTypeOf<BudgetSettingRow>();

expectTypeOf<
  z.output<typeof modelsSettingRowSchema>
>().toEqualTypeOf<ModelsSettingRow>();

expectTypeOf<
  z.output<typeof settingSectionSchema>
>().toEqualTypeOf<SettingSection>();
