// Entry for the showcase page (dev/panel/host/showcase.html). Mounting lives
// apart from showcase.tsx so Fast Refresh can swap the component in place.
import { createRoot } from "react-dom/client";

import { Showcase } from "./showcase";

const container = document.getElementById("root");
if (!container) throw new Error("The showcase page has no root element.");
createRoot(container).render(<Showcase />);
