import { createServer } from "node:net";

/** Another program already listens on the service port. */
export class PortInUseError extends Error {
  constructor(
    readonly port: number,
    options?: ErrorOptions,
  ) {
    super(
      `Port ${port} is already in use by another program. Stop that program, or set PORT to a free port.`,
      options,
    );

    this.name = "PortInUseError";
  }
}

/** How many ports after the default the launcher tries before asking the system for one. */
const nearbyPorts = 10;

/** Whether a loopback listener can bind `port` right now. */
function available(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/**
 * A loopback port that was free a moment ago: the first free one after
 * `start`, so a relocated service keeps a predictable address, or one the
 * system picks when those are all taken.
 */
export async function freeLoopbackPort(start: number, skip: number) {
  for (let port = start; port < start + nearbyPorts; port++) {
    if (port !== skip && (await available(port))) return port;
  }

  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as import("node:net").AddressInfo;
      server.close(() => resolve(port));
    });
  });
}
