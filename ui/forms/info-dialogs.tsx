import type { ReactNode } from "react";

import { useController } from "../components/controller-context";
import { defineDialog } from "./dialog-definition";
import { FormFooter } from "./form-footer";

function InfoForm({ children }: { children: ReactNode }) {
  const controller = useController();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void controller.submit(async () => {});
      }}
    >
      {children}
      <FormFooter label="Done" />
    </form>
  );
}

export const artifactDialog = defineDialog<"artifact">({
  title: ({ artifact }) => artifact.title,
  render: ({ artifact }) => (
    <InfoForm>
      <pre>{artifact.content}</pre>
    </InfoForm>
  ),
});
