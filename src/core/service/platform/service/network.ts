import { networkInterfaces } from "node:os";

/** LAN origins are explicit interface addresses, never arbitrary request Host values. */
export function networkOrigins(port: number) {
  return [
    ...new Set(
      Object.values(networkInterfaces()).flatMap((addresses) =>
        (addresses ?? [])
          .filter((address) => address.family === "IPv4" && !address.internal)
          .map((address) => `http://${address.address}:${port}`),
      ),
    ),
  ];
}
