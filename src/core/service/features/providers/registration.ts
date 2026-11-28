import type { Store } from "../tasks/storage/store.js";
import type { Provider } from "./types.js";

export interface ProviderRegistration {
  id: string;
  create: (store: Store, data: string) => Provider;
}
