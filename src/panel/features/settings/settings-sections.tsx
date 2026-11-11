import { Tabs } from "@base-ui/react/tabs";
import { type ReactNode, useEffect, useState } from "react";

import { TabList } from "../../shared/components/tabs/tab-list";
import { useActiveTabInView } from "../../shared/components/tabs/use-active-tab-in-view";
import { SettingsSearchHighlight } from "./search/settings-search-highlight";

export interface SettingsSectionView {
  id: string;
  title: string;
  edits?: number;
  hidden?: boolean;
  matches?: number;
  score?: number;
  content: ReactNode;
}

interface SettingsSectionsProps {
  sections: SettingsSectionView[];
  value: string;
  loading: boolean;
  searching?: boolean;
  onValueChange: (section: string) => void;
}

type Orientation = "horizontal" | "vertical";

function useSettingsTabOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>(() =>
    window.matchMedia("(max-width: 640px)").matches ? "horizontal" : "vertical",
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");

    const update = () =>
      setOrientation(media.matches ? "horizontal" : "vertical");

    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  return orientation;
}

/**
 * Keep one set of controls mounted for browsing and search. Search exposes the
 * same panels as named regions, overriding tab visibility and inertness.
 */
export function SettingsSections({
  sections,
  value,
  loading,
  searching = false,
  onValueChange,
}: SettingsSectionsProps) {
  const orientation = useSettingsTabOrientation();

  const listRef = useActiveTabInView(value, {
    getTabId: (section) => `settings-tab-${section}`,
    layoutKey: orientation,
  });

  return (
    <Tabs.Root
      className={`settings-section-tabs${searching ? " settings-search-results" : ""}`}
      orientation={orientation}
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      aria-busy={loading || undefined}
    >
      <div className="settings-section-navigation" hidden={searching}>
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
              <span className="settings-section-tab-label">
                {section.title}
              </span>
              {section.edits ? (
                <span className="settings-section-tab-badge">
                  {section.edits} changed
                </span>
              ) : null}
            </Tabs.Tab>
          ))}
        </TabList>
      </div>
      {(searching
        ? sections.toSorted((a, b) => (a.score ?? 0) - (b.score ?? 0))
        : sections
      ).map((section) => (
        <Tabs.Panel
          key={section.id}
          value={section.id}
          className="settings-section-tab-panel"
          hidden={searching ? section.hidden : section.id !== value}
          inert={searching ? section.hidden : section.id !== value}
          role={searching ? "region" : "tabpanel"}
          aria-labelledby={
            searching
              ? `settings-result-${section.id}`
              : `settings-tab-${section.id}`
          }
          tabIndex={searching ? -1 : 0}
          keepMounted
        >
          <div className="settings-section-tab-content">
            <h2
              id={`settings-result-${section.id}`}
              className="settings-section-tab-heading"
            >
              <SettingsSearchHighlight text={section.title} />
            </h2>
            {section.content}
          </div>
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
