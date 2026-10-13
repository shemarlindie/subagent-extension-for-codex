import { glob, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ESLint } from "eslint";
import { format, resolveConfig } from "prettier";
import { generate } from "ts-to-zod";
import tseslint from "typescript-eslint";

const check = process.argv.includes("--check");

// Generated output may not exist on disk yet, so it can't join a tsconfig
// program; `npm run lint` applies the type-aware rules afterwards.
const eslint = new ESLint({
  fix: true,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function discover(pattern) {
  const paths = [];

  for await (const path of glob(pattern)) paths.push(resolve(path));

  return paths.sort();
}

const contracts = (await discover("src/**/*-contract.ts")).map((input) => ({
  input,
  output: input.replace(/\.ts$/, ".generated.ts"),
}));

if (!contracts.length) {
  throw new Error(
    "No schema contracts found under src. Run this command from the project root.",
  );
}

const schemaMappings = [...contracts];
const inputs = new Set(contracts.map(({ input }) => input));
const outputs = new Set(contracts.map(({ output }) => output));

if (inputs.size !== contracts.length || outputs.size !== contracts.length) {
  throw new Error("Duplicate discovered schema input or output");
}

// Resolve every feature mapping before any generated files are written.
for (const file of await discover("src/**/schema-generation.mjs")) {
  const { default: config } = await import(pathToFileURL(file).href);

  if (!config || !Array.isArray(config.mappings)) {
    throw new Error(
      `Invalid schema mappings in ${relative(process.cwd(), file)}`,
    );
  }

  for (const mapping of config.mappings) {
    if (
      !mapping ||
      typeof mapping.input !== "string" ||
      typeof mapping.output !== "string" ||
      (mapping.getSchemaName !== undefined &&
        typeof mapping.getSchemaName !== "function")
    ) {
      throw new Error(
        `Invalid schema mapping in ${relative(process.cwd(), file)}`,
      );
    }

    const input = resolve(dirname(file), mapping.input);
    const output = resolve(dirname(file), mapping.output);

    if (inputs.has(input)) {
      throw new Error(
        `Duplicate schema mapping for ${relative(process.cwd(), input)}`,
      );
    }

    if (outputs.has(output)) {
      throw new Error(
        `Schema mapping conflicts with generated output ${relative(process.cwd(), output)}`,
      );
    }

    inputs.add(input);
    schemaMappings.push({ ...mapping, input, output });
  }
}

// ts-to-zod exports schemas for every exported type, including helper types
// used only inside another generated schema. Keep those helpers private unless
// another module imports the schema directly.
const publicSchemas = new Map(
  [...outputs].map((output) => [output, new Set()]),
);

for (const file of await discover("src/**/*.{ts,tsx,js,mjs}")) {
  const source = await readFile(file, "utf8");

  const imports =
    /(?:import|export)\s+(?:type\s+)?(?:\{([^}]+)\}|\*\s+as\s+[\w$]+)\s+from\s+["']([^"']+)["']/gs;

  for (const match of source.matchAll(imports)) {
    const [, namedImports, specifier] = match;

    const importedPath = resolve(
      dirname(file),
      specifier.replace(/\.js$/, ".ts"),
    );

    const schemas = publicSchemas.get(importedPath);

    if (!schemas) continue;

    if (namedImports === undefined) {
      schemas.add("*");
      continue;
    }

    for (const name of namedImports.split(",")) {
      const imported = name
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];

      if (imported) schemas.add(imported);
    }
  }
}

const generatedOutputByInput = new Map(
  contracts.map(({ input, output }) => [input, output]),
);

for (const { input } of contracts) {
  const source = await readFile(input, "utf8");

  const imports = /import\s+type\s*\{([^}]+)\}\s*from\s+["']([^"']+)["']/gs;

  for (const match of source.matchAll(imports)) {
    const [, names, specifier] = match;

    const importedPath = resolve(
      dirname(input),
      specifier.replace(/\.js$/, ".ts"),
    );

    const importedOutput = generatedOutputByInput.get(importedPath);
    const schemas = importedOutput && publicSchemas.get(importedOutput);

    if (!schemas) continue;

    for (const name of names.split(",")) {
      const imported = name
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];

      if (imported) {
        schemas.add(imported[0].toLowerCase() + imported.slice(1) + "Schema");
      }
    }
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

  const publicNames = publicSchemas.get(output) ?? new Set();

  const generated = result
    .getZodSchemasFile(modulePath(output, input))
    .replaceAll("z.ZodSchema<", "z.ZodType<");

  const declarations = [...generated.matchAll(/^export const (\w+Schema)\b/gm)];

  const internalSchemas = new Set();

  for (const [index, declaration] of declarations.entries()) {
    const next = declarations[index + 1];

    const body = generated.slice(
      declaration.index + declaration[0].length,
      next?.index ?? generated.length,
    );

    for (const [, name] of declarations) {
      if (
        name !== declaration[1] &&
        new RegExp("\\b" + name + "\\b").test(body)
      ) {
        internalSchemas.add(name);
      }
    }
  }

  const source = generated.replace(
    /^export const (\w+Schema)\b/gm,
    (declaration, name) =>
      publicNames.has("*") ||
      publicNames.has(name) ||
      !internalSchemas.has(name)
        ? declaration
        : declaration.replace(/^export /, ""),
  );

  // Unconfigured imported types fall back to any; never silently lose validation.
  if (/\bz\.any\(\)/.test(source)) {
    throw new Error(
      `Permissive validator in ${input}; configure its type references.`,
    );
  }

  const [linted] = await eslint.lintText(source, { filePath: output });

  if (linted.errorCount) {
    throw new Error(`Generated schema failed lint: ${output}`);
  }

  const formatted = await format(linted.output ?? source, {
    ...(await resolveConfig(output)),
    filepath: output,
  });

  if (check) {
    const current = await readFile(output, "utf8").catch((error) => {
      if (error.code === "ENOENT") return undefined;

      throw error;
    });

    if (current !== formatted) {
      throw new Error(
        `${current === undefined ? "Missing" : "Stale"} schema: ${relative(process.cwd(), output)}. Run npm run schemas:generate.`,
      );
    }
  } else {
    await writeFile(output, formatted);
  }
}
