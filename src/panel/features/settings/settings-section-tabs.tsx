import { Tabs } from "@base-ui/react/tabs";
import { type ReactNode, useEffect, useState } from "react";

import { TabList } from "../../shared/components/tabs/tab-list";
import { useActiveTabInView } from "../../shared/components/tabs/use-active-tab-in-view";

export interface SettingsSectionView {
  id: string;
  title: string;
  edits?: number;
  content: ReactNode;
}

interface SettingsSectionTabsProps {
  sections: SettingsSectionView[];
  value: string;
  loading: boolean;
  onValueChange: (section: string) => void;
}

type Orientation = "horizontal" | "vertical";

function useSettingsTabOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>(() =>
    window.matchMedia("(max-width: 640px)").matches ? "horizontal" : "vertical",
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)"),
      update = () => setOrientation(media.matches ? "horizontal" : "vertical");

    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  return orientation;
}

/** Server-defined settings sections with a persistent panel per tab. */
export function SettingsSectionTabs({
  sections,
  value,
  loading,
  onValueChange,
}: SettingsSectionTabsProps) {
  const orientation = useSettingsTabOrientation(),
    listRef = useActiveTabInView(value, {
      getTabId: (section) => `settings-tab-${section}`,
      layoutKey: orientation,
    });

  return (
    <Tabs.Root
      className="settings-section-tabs"
      orientation={orientation}
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      aria-busy={loading || undefined}
    >
      <TabList
        ref={listRef}
        className="settings-section-tabs-list"
        label="Settings sections"
      >
        {sections.map((section) => (
          <Tabs.Tab
            key={section.id}
            value={section.id}
            id={`settings-tab-${section.id}`}
            className="settings-section-tab"
            aria-label={
              section.edits
                ? `${section.title}, ${section.edits} changed`
                : section.title
            }
          >
            <span className="settings-section-tab-label">{section.title}</span>
            {section.edits ? (
              <span className="settings-section-tab-badge">
                {section.edits} changed
              </span>
            ) : null}
          </Tabs.Tab>
        ))}
      </TabList>
      {sections.map((section) => (
        <Tabs.Panel
          key={section.id}
          value={section.id}
          className="settings-section-tab-panel"
          keepMounted
        >
          <div className="settings-section-tab-content">
            <h2 className="settings-section-tab-heading">{section.title}</h2>
            {section.content}
          </div>
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
