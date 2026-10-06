import { join } from "node:path";

import type { Plugin } from "vite";

/**
 * Answers the fixture tools with the real service code, so the panel dev host
 * exercises artifact summaries and thumbnails through the same store as prod.
 */
export function fixtureServicePlugin(): Plugin {
  return {
    name: "fixture-service",
    configureServer(server) {
      server.middlewares.use(
        "/fixture-service/tools",
        (request, response, next) => {
          if (request.method !== "POST") return next();
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));

          request.on("end", async () => {
            const send = (status: number, body: unknown) => {
              response.statusCode = status;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify(body));
            };

            try {
              const name = decodeURIComponent(
                (request.url ?? "").replace(/^\//, ""),
              );

              const args = chunks.length
                ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
                : {};

              const service = (await server.ssrLoadModule(
                join(import.meta.dirname, "../ui/dev/fixture-service.ts"),
              )) as typeof import("../ui/dev/fixture-service");

              send(200, {
                result: await service.fixtureServiceTool(name, args),
              });
            } catch (error) {
              send(400, {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          });
        },
      );
    },
  };
}
