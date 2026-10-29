import { createContext } from "react";

import { settingsSearch } from "./settings-search";

export const SettingsSearchContext = createContext(settingsSearch(""));
