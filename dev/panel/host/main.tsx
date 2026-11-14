// Entry for the panel dev host. Mounting lives here, apart from host.tsx, so a
// hot update to the host refreshes the component instead of re-running
// createRoot on the same container.
import { createRoot } from "react-dom/client";

import { Host } from "./host";

const container = document.getElementById("root");
if (!container) throw new Error("The dev host page has no root element.");
createRoot(container).render(<Host />);
