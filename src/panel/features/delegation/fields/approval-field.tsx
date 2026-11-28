import { memo, useEffect } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";

import { providerMetadata } from "../../../../core/shared/providers/metadata";
import {
  allowedPermissionMode,
  withBlockedOptions,
} from "../../../../core/shared/providers/policy";
import type { Worker } from "../../../app/state/types";
import { Presence } from "../../../shared/components/motion/presence";
import { Field } from "../../../shared/forms/fields";
import { FormSelect } from "../../../shared/forms/form-select";
import type { DelegateValues } from "../delegate-values";
import { workerChoice } from "../delegation";
import {
  inheritedPermissionMode,
  withInheritedMode,
} from "../inherited-permission";
import { SandboxField } from "./sandbox-field";

interface ApprovalFieldProps {
  form: UseFormReturn<DelegateValues>;
  workers: Worker[];
  /** Saved settings, which name the mode "Use extension setting" runs. */
  defaults?: unknown;
  disabled?: boolean;
  loading?: boolean;
}

/** The worker's modes, or a stand-in once it's known to have none. */
const fallbackPermissions = (
  options: { value: string; label: string }[] | undefined,
  unresolved: boolean,
) => options ?? (unresolved ? [] : [{ value: "inherit", label: "Inherit" }]);

export const ApprovalField = memo(function ApprovalField({
  form: { control, setValue },
  workers,
  defaults,
  disabled = false,
  loading = false,
}: ApprovalFieldProps) {
  const worker = useWatch({ control, name: "worker" });
  const mode = useWatch({ control, name: "permission_mode" });
  const { provider } = workerChoice(worker);
  const info = workers.find((item) => item.provider === provider);

  const permissions = providerMetadata(
    provider,
    info?.metadata,
  )?.nativePermissions;

  const unresolved = loading && !info;
  const allowedMode = allowedPermissionMode(info?.policy, mode);

  const options = withInheritedMode(
    permissions?.options,
    inheritedPermissionMode(worker, defaults, info),
  );

  // A restored draft or late policy can leave a blocked mode, which won't run.
  useEffect(() => {
    if (allowedMode !== mode) setValue("permission_mode", allowedMode);
  }, [allowedMode, mode, setValue]);

  return (
    <>
      <div className="permission-row">
        <Field id="permission-mode" label="Permission mode">
          <FormSelect
            control={control}
            name="permission_mode"
            id="permission-mode"
            label="Permission mode"
            disabled={disabled || !permissions}
            loading={loading}
            loadingLabel="Loading permission options"
            placeholder={unresolved ? "Loading…" : undefined}
            options={withBlockedOptions(
              fallbackPermissions(options, unresolved),
              info?.policy,
            )}
          />
          <p className="help">
            {unresolved
              ? "Loading permission options."
              : (permissions?.help ?? "This worker has no permission modes.")}
          </p>
        </Field>
        <SandboxField
          control={control}
          permissions={permissions}
          unresolved={unresolved}
          disabled={disabled}
          loading={loading}
        />
      </div>
      <Presence show={Boolean(permissions?.approvalDecider) || unresolved}>
        <Field id="approval-decider" label="Approval decision maker">
          <FormSelect
            control={control}
            name="approval_decider"
            id="approval-decider"
            label="Approval decision maker"
            disabled={disabled}
            loading={loading}
            loadingLabel="Loading approval options"
            placeholder={unresolved ? "Loading…" : undefined}
            options={
              unresolved
                ? []
                : [
                    { value: "user", label: "User" },
                    { value: "parent_agent", label: "Parent agent" },
                  ]
            }
          />
          <p className="help">
            {unresolved
              ? "Loading approval options."
              : permissions?.approvalDeciderHelp}
          </p>
        </Field>
      </Presence>
    </>
  );
});
