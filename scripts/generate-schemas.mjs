import { glob, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ESLint } from "eslint";
import { format, resolveConfig } from "prettier";
import { generate } from "ts-to-zod";

const check = process.argv.includes("--check");
const eslint = new ESLint({ fix: true });

async function discover(pattern) {
  const paths = [];

  for await (const path of glob(pattern)) paths.push(resolve(path));

  return paths.sort();
}

const contracts = (await discover("src/**/*-contract.ts")).map((input) => ({
  input,
  output: input.replace(/\.ts$/, ".generated.ts"),
}));

if (!contracts.length)
  throw new Error(
    "No schema contracts found under src. Run this command from the project root.",
  );

const schemaMappings = [...contracts];
const inputs = new Set(contracts.map(({ input }) => input));
const outputs = new Set(contracts.map(({ output }) => output));

if (inputs.size !== contracts.length || outputs.size !== contracts.length)
  throw new Error("Duplicate discovered schema input or output");

// Resolve every feature mapping before any generated files are written.
for (const file of await discover("src/**/schema-generation.mjs")) {
  const { default: config } = await import(pathToFileURL(file).href);

  if (!config || !Array.isArray(config.mappings))
    throw new Error(
      `Invalid schema mappings in ${relative(process.cwd(), file)}`,
    );

  for (const mapping of config.mappings) {
    if (
      !mapping ||
      typeof mapping.input !== "string" ||
      typeof mapping.output !== "string" ||
      (mapping.getSchemaName !== undefined &&
        typeof mapping.getSchemaName !== "function")
    )
      throw new Error(
        `Invalid schema mapping in ${relative(process.cwd(), file)}`,
      );
    const input = resolve(dirname(file), mapping.input);
    const output = resolve(dirname(file), mapping.output);

    if (inputs.has(input))
      throw new Error(
        `Duplicate schema mapping for ${relative(process.cwd(), input)}`,
      );
    if (outputs.has(output))
      throw new Error(
        `Schema mapping conflicts with generated output ${relative(process.cwd(), output)}`,
      );
    inputs.add(input);
    schemaMappings.push({ ...mapping, input, output });
  }
}

function modulePath(from, to) {
  // Module imports need forward slashes even when filesystem paths use backslashes.
  const path = relative(dirname(from), to)
    .replaceAll("\\", "/")
    .replace(/\.ts$/, ".js");

  return path.startsWith(".") ? path : `./${path}`;
}

for (const { input, output } of contracts) {
  const result = generate({
    sourceText: await readFile(input, "utf8"),
    inputOutputMappings: schemaMappings.map((mapping) => ({
      ...mapping,
      input: modulePath(input, mapping.input),
      output: modulePath(output, mapping.output),
    })),
  });

  if (result.errors.length) throw new Error(result.errors.join("\n"));

  const source = result.getZodSchemasFile(modulePath(output, input));

  // Unconfigured imported types fall back to any; never silently lose validation.
  if (/\bz\.any\(\)/.test(source))
    throw new Error(
      `Permissive validator in ${input}; configure its type references.`,
    );
  const [linted] = await eslint.lintText(source, { filePath: output });

  if (linted.errorCount)
    throw new Error(`Generated schema failed lint: ${output}`);

  const formatted = await format(linted.output ?? source, {
    ...(await resolveConfig(output)),
    filepath: output,
  });

  if (check) {
    const current = await readFile(output, "utf8").catch((error) => {
      if (error.code === "ENOENT") return undefined;

      throw error;
    });

    if (current !== formatted)
      throw new Error(
        `${current === undefined ? "Missing" : "Stale"} schema: ${relative(process.cwd(), output)}. Run npm run schemas:generate.`,
      );
  } else {
    await writeFile(output, formatted);
  }
}
