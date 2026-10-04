// Entry for the panel dev host. Mounting lives here, apart from host.tsx, so a
// hot update to the host refreshes the component instead of re-running
// createRoot on the same container.
import { createRoot } from "react-dom/client";
import { Host } from "./host";

createRoot(document.getElementById("root")!).render(<Host />);
