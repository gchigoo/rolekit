#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const declaredMode = process.argv[2];
const knownModes = new Set([
  "cursor",
  "pi",
  "codex",
  "codex-missing-output",
  "codex-malformed-output",
]);
const directArgs = process.argv.slice(2);
const mode = knownModes.has(declaredMode)
  ? declaredMode
  : directArgs[0] === "exec"
    ? "codex"
    : directArgs.includes("--output-format")
      ? "cursor"
      : "pi";
const args = knownModes.has(declaredMode) ? process.argv.slice(3) : directArgs;
const missingFeature = process.env.ROLEKIT_FAKE_MISSING_FEATURE;
const exactArgument = (flag, value) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] === value;
};
const rejectsExactFeature =
  (missingFeature === "pi-mode-json" && exactArgument("--mode", "json")) ||
  (missingFeature === "cursor-stream-json" &&
    exactArgument("--output-format", "stream-json"));
const rejectsInvalidValueCanary =
  exactArgument("--mode", "rolekit-invalid-value-canary") ||
  exactArgument("--output-format", "rolekit-invalid-value-canary");
const configValues = args.flatMap((argument, index) =>
  argument === "-c" && args[index + 1] !== undefined ? [args[index + 1]] : [],
);
const projectDocConfig = configValues.find((value) =>
  value.startsWith("project_doc_max_bytes="),
);
const webSearchConfig = configValues.find((value) =>
  value.startsWith("web_search="),
);
const codexTypedConfigCanary =
  mode.startsWith("codex") &&
  args[0] === "exec" &&
  args.includes("--strict-config") &&
  (projectDocConfig !== undefined || webSearchConfig !== undefined);
const invalidCodexConfigCanary = configValues.some((value) =>
  value.includes("rolekit-invalid-value-canary"),
);
const ignoresCodexConfigCanary =
  (missingFeature === "codex-ignore-project-doc-config" &&
    projectDocConfig !== undefined) ||
  (missingFeature === "codex-ignore-web-search-config" &&
    webSearchConfig !== undefined);
const rejectsCodexConfigCanary =
  (missingFeature === "codex-reject-project-doc-config" &&
    projectDocConfig !== undefined) ||
  (missingFeature === "codex-reject-web-search-config" &&
    webSearchConfig !== undefined);
const ignoresExactOperands =
  (missingFeature === "pi-ignore-extra-operands" && mode === "pi") ||
  (missingFeature === "cursor-ignore-extra-operands" && mode === "cursor");
const piCompatibilityCanary =
  mode === "pi" &&
  args[0] === "--mode" &&
  args.includes("--offline") &&
  !args.includes("--system-prompt");

if (args.includes("--version")) {
  process.stdout.write(`fake-${mode} 1.0.0\n`);
  process.exit(0);
}
if (args.includes("--help")) {
  if (rejectsExactFeature && !ignoresExactOperands) {
    process.stderr.write(
      `unsupported compatibility value rolekit-invalid-value-canary: ${missingFeature ?? "invalid-value-canary"}\n`,
    );
    process.exit(2);
  }
  if (mode === "cursor" && rejectsInvalidValueCanary && !ignoresExactOperands) {
    process.stderr.write(
      "error: invalid value 'rolekit-invalid-value-canary' for '--output-format <OUTPUT_FORMAT>'\n  [possible values: text, json, stream-json]\n\nFor more information, try '--help'.\n",
    );
    process.exit(2);
  }
  const helpTokens = [
    "--mode",
    "--print",
    "--no-session",
    "--no-context-files",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--tools",
    "--system-prompt",
    "--extension",
    "--skill",
    "--prompt-template",
    "--provider",
    "--model",
    "--thinking",
    "--offline",
    "--append-system-prompt",
    "--json",
    "--ephemeral",
    "--color",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "-c",
    "-C",
    "--output-schema",
    "-o",
    "--sandbox",
    "--profile",
    "--output-format",
    "--workspace",
    "--trust",
    "--force",
    "--approve-mcps",
    "--help",
  ].filter(
    (token) => !(missingFeature === "codex-output-schema" && token === "--output-schema"),
  );
  process.stdout.write(`${helpTokens.join(" ")}\n`);
  process.exit(0);
}
if (codexTypedConfigCanary) {
  if (rejectsCodexConfigCanary) {
    process.stderr.write("Error loading config.toml: exact typed config control rejected\n");
    process.exit(2);
  }
  if (!invalidCodexConfigCanary || ignoresCodexConfigCanary) {
    process.stderr.write("Reading prompt from stdin...\nNo prompt provided via stdin.\n");
    process.exit(1);
  }
  if (projectDocConfig !== undefined) {
    process.stderr.write(
      'Error loading config.toml: invalid type: string "rolekit-invalid-value-canary", expected usize\nin `project_doc_max_bytes`\n\n',
    );
  } else {
    process.stderr.write(
      "Error loading config.toml: unknown variant `rolekit-invalid-value-canary`, expected one of `disabled`, `cached`, `indexed`, `live`\nin `web_search`\n\n",
    );
  }
  process.exit(1);
}
if (rejectsExactFeature && !ignoresExactOperands) {
  process.stderr.write(
    `unsupported execution value rolekit-invalid-value-canary: ${missingFeature ?? "invalid-value-canary"}\n`,
  );
  process.exit(2);
}
if (piCompatibilityCanary) {
  if (rejectsInvalidValueCanary && !ignoresExactOperands) {
    process.exit(0);
  }
  process.stdout.write(
    `${JSON.stringify(
      missingFeature === "pi-non-session-json-canary"
        ? { type: "message_end", message: {} }
        : {
            type: "session",
            version: 3,
            id: "rolekit-probe-session",
            timestamp: "2026-01-01T00:00:00.000Z",
            cwd: process.cwd(),
          },
    )}\n`,
  );
  process.exit(0);
}
let prompt = "";
for await (const chunk of process.stdin) {
  prompt += chunk;
}

const payload = {
  status: "completed",
  summary: `${mode} completed`,
  output: { message: mode },
  artifacts: [{ name: "report", kind: "text", content: `${mode} report` }],
  evidence: [{ kind: "note", value: `${mode} fixture` }],
};

const codexWirePayload = {
  status: "completed",
  summary: `${mode} completed`,
  output: { message: mode },
  artifacts: [
    {
      name: "report",
      kind: "text",
      uri: null,
      contentJson: JSON.stringify(`${mode} report`),
      mediaType: null,
    },
  ],
  evidence: [{ kind: "note", value: `${mode} fixture`, description: null }],
  error: null,
};

let observedPrompt = prompt;
let observedOutputSchema = null;
if (mode === "pi") {
  if (!args.includes("--no-context-files")) {
    try {
      observedPrompt += `\n${await readFile(new URL(`file://${process.cwd()}/AGENTS.md`), "utf8")}`;
    } catch {}
  }
  const piDirectory = process.env.PI_CODING_AGENT_DIR;
  if (piDirectory) {
    for (const name of ["SYSTEM.md", "settings.json"]) {
      try {
        observedPrompt += `\n${await readFile(new URL(`file://${piDirectory}/${name}`), "utf8")}`;
      } catch {}
    }
  }
}

switch (mode) {
  case "cursor":
    process.stdout.write(`${JSON.stringify({
      type: "system",
      subtype: "init",
      model: "cursor/actual-model",
    })}\n`);
    process.stdout.write(`${JSON.stringify({
      type: "result",
      subtype: "success",
      result: JSON.stringify(payload),
      duration_ms: 12,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    })}\n`);
    break;
  case "pi":
    process.stdout.write(`${JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        provider: "fixture",
        model: "pi-model",
        content: [{ type: "text", text: JSON.stringify(payload) }],
        usage: { input: 11, output: 6, totalTokens: 17, cost: { total: 0.01 } },
      },
    })}\n`);
    break;
  case "codex":
  case "codex-missing-output":
  case "codex-malformed-output": {
    const outputIndex = args.indexOf("-o");
    const outputPath = args[outputIndex + 1];
    if (!outputPath) {
      throw new Error("Missing Codex output path.");
    }
    const schemaIndex = args.indexOf("--output-schema");
    const schemaPath = args[schemaIndex + 1];
    if (schemaPath) {
      observedOutputSchema = JSON.parse(await readFile(schemaPath, "utf8"));
    }
    const usesCodexWireSchema =
      observedOutputSchema?.type === "object" &&
      !Object.hasOwn(observedOutputSchema, "anyOf") &&
      Object.hasOwn(observedOutputSchema.properties ?? {}, "error");
    if (mode !== "codex-missing-output") {
      await writeFile(
        outputPath,
        mode === "codex-malformed-output"
          ? "not-json"
          : JSON.stringify(usesCodexWireSchema ? codexWirePayload : payload),
        "utf8",
      );
    }
    const codexEventsPath = process.env.ROLEKIT_FAKE_CODEX_EVENTS_PATH;
    if (codexEventsPath) {
      process.stdout.write(await readFile(codexEventsPath, "utf8"));
    } else {
      process.stdout.write(
        `${JSON.stringify({ type: "thread.started", thread_id: "fixture-thread" })}\n`,
      );
      process.stdout.write(`${JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 5,
          cached_input_tokens: 1,
          output_tokens: 3,
          reasoning_output_tokens: 2,
        },
      })}\n`);
      process.stdout.write(`${JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 12,
          cached_input_tokens: 4,
          output_tokens: 7,
          reasoning_output_tokens: 3,
          total_tokens: 999,
          cost_usd: 99,
          durationMs: 9876543,
        },
      })}\n`);
      process.stdout.write(`${JSON.stringify({
        type: "item.completed",
        usage: { input_tokens: 900, output_tokens: 800, total_tokens: 1700 },
      })}\n`);
    }
    break;
  }
  default:
    throw new Error(`Unknown fixture mode: ${mode}`);
}

const capturePath = process.env.ROLEKIT_FAKE_CAPTURE;
if (capturePath) {
  const environmentKeys = [
    "CURSOR_API_KEY",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "CODEX_HOME",
    "ROLEKIT_AMBIENT_SENTINEL",
  ];
  const environment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key] ?? null]),
  );
  await writeFile(
    capturePath,
    JSON.stringify({
      mode,
      args,
      prompt: observedPrompt,
      environment,
      outputSchema: observedOutputSchema,
    }),
    "utf8",
  );
}
