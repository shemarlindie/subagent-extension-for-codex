import type { EventPayloadMap } from "./event-contract.js";

export type EventType = keyof EventPayloadMap;

type RequiredKeys<T> = {
  [K in keyof T]-?: Pick<T, K> extends Partial<Pick<T, K>> ? never : K;
}[keyof T];

export type HasNoPayload<T> = [RequiredKeys<T>] extends [never] ? true : false;

export type EventEmitter = <K extends EventType, D extends EventPayloadMap[K]>(
  type: K,
  data: D,
) => void;

export type OpaqueEventEmitter = (
  type: string,
  data: Record<string, unknown>,
) => void;

/** Known typed payloads are discriminated separately from opaque events. */
export type EventView =
  | {
      [K in EventType]: {
        kind: "known";
        type: K;
        data: EventPayloadMap[K];
      };
    }[EventType]
  | { kind: "opaque"; type: string; data: Record<string, unknown> };
