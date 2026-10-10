import { parseArgs } from "node:util";

import { startService } from "./platform/service/startup.js";

const { values } = parseArgs({ options: { host: { type: "boolean" } } });

await startService({ network: values.host });
