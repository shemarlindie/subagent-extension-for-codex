import { useFormContext, useWatch } from "react-hook-form";

import { providerMetadata } from "../../../../shared/providers/metadata";
import type { Worker } from "../../../app/state/types";
import { Presence } from "../../../shared/components/motion/motion";
import { Field } from "../../../shared/forms/fields";
import { FormSelect } from "../../../shared/forms/form-select";
import type { DelegateValues } from "../delegate-values";
import { workerChoice } from "../delegation";

interface ApprovalFieldProps {
  workers: Worker[];
  disabled?: boolean;
  loading?: boolean;
}

export function ApprovalField({
  workers,
  disabled = false,
  loading = false,
}: ApprovalFieldProps) {
  const { control } = useFormContext<DelegateValues>();
  const worker = useWatch({ control, name: "worker" });
  const { provider } = workerChoice(worker);
  const info = workers.find((item) => item.provider === provider);

  const permissions = providerMetadata(
    provider,
    info?.metadata,
  )?.nativePermissions;

  const unresolved = loading && !info,
    permissionOptions =
      permissions?.options ??
      (unresolved ? [] : [{ value: "inherit", label: "Inherit" }]);

  return (
    <>
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
          options={permissionOptions}
        />
        <p className="help">
          {unresolved
            ? "Loading permission options."
            : (permissions?.help ??
              "Native permission mode selection is available for providers that declare it.")}
        </p>
      </Field>
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
}
