import type { ReactNode } from "react";
export function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      {children}
    </>
  );
}
