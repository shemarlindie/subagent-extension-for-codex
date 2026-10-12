import { Tabs } from "@base-ui/react/tabs";
import { forwardRef, type ReactNode } from "react";

interface TabListProps {
  label: string;
  children: ReactNode;
  className?: string;
}

/** Shared Base UI tab list with the panel's standard animated indicator. */
export const TabList = forwardRef<HTMLDivElement, TabListProps>(
  function TabList({ label, children, className }, ref) {
    return (
      <Tabs.List
        ref={ref}
        activateOnFocus
        className={["tabs", className].filter(Boolean).join(" ")}
        aria-label={label}
      >
        {children}
        <Tabs.Indicator className="tab-indicator" />
      </Tabs.List>
    );
  },
);
