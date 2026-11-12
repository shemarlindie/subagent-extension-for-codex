import { useContext, useEffect, useState } from "react";

import type { AboutInfo } from "../../../shared/about/types";
import { useController } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { LoadingSwap } from "../../shared/components/loading-skeleton/loading-swap";
import { errorMessage } from "../../shared/utils/error-message";
import type { settingsSearch } from "./search/settings-search";
import { SettingsSearchContext } from "./search/settings-search-context";
import { SettingsAboutContent } from "./settings-about-content";
import { aboutSearchMatches } from "./settings-about-search";
import { SettingsAboutSkeleton } from "./settings-about-skeleton";
import type { SettingsSectionView } from "./settings-sections";

export function aboutSection(
  search: ReturnType<typeof settingsSearch>,
  selected: string | undefined,
): SettingsSectionView {
  const matches = aboutSearchMatches(search);

  return {
    id: "about",
    title: "About",
    hidden: !matches,
    matches,
    score: 3,
    content:
      selected === "about" || (search.active && matches) ? (
        <SettingsAbout />
      ) : null,
  };
}

/** Read only diagnostics, loaded only while the About section is visible. */
function SettingsAbout() {
  const controller = useController();
  const [info, setInfo] = useState<AboutInfo>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const searching = useContext(SettingsSearchContext).active;

  useEffect(() => {
    let current = true;

    controller.tool<AboutInfo>("app_get_about", { refresh: attempt > 0 }).then(
      (result) => {
        if (current) {
          setInfo(result);
          setPending(false);
        }
      },
      (reason: unknown) => {
        if (current) {
          setError(errorMessage(reason));
          setPending(false);
        }
      },
    );

    return () => {
      current = false;
    };
  }, [controller, attempt]);

  function retry() {
    setError(undefined);
    setPending(true);
    setAttempt((value) => value + 1);
  }

  return (
    <div className="settings-about">
      {!searching && (
        <div className="settings-about-product">
          <span className="settings-about-mark">
            <Icon name="quiet-constellation" size={28} />
          </span>
          <div>
            <h3>Subagent Extension for Codex</h3>
            <p className="muted">Delegate to Claude without leaving Codex.</p>
          </div>
        </div>
      )}
      {error && !info ? (
        <div className="settings-about-error">
          <p className="form-error" role="alert">
            {error}
          </p>
          <Button onClick={retry}>Retry</Button>
        </div>
      ) : (
        <LoadingSwap loading={!info} skeleton={<SettingsAboutSkeleton />}>
          {info && (
            <SettingsAboutContent
              info={info}
              pending={pending}
              error={error}
              onRecheck={retry}
            />
          )}
        </LoadingSwap>
      )}
    </div>
  );
}
