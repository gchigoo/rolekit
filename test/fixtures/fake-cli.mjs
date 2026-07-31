import { readFile, writeFile } from "node:fs/promises";

const mode = process.argv[2];
const args = process.argv.slice(3);

if (args.includes("--version")) {
  process.stdout.write(`fake-${mode} 1.0.0\n`);
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

const capturePath = process.env.ROLEKIT_FAKE_CAPTURE;
if (capturePath) {
  await writeFile(capturePath, JSON.stringify({ mode, args, prompt }), "utf8");
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
  case "codex": {
    const outputIndex = args.indexOf("-o");
    const outputPath = args[outputIndex + 1];
    if (!outputPath) {
      throw new Error("Missing Codex output path.");
    }
    await writeFile(outputPath, JSON.stringify(payload), "utf8");
    const schemaIndex = args.indexOf("--output-schema");
    const schemaPath = args[schemaIndex + 1];
    if (schemaPath) {
      await readFile(schemaPath, "utf8");
    }
    process.stdout.write(`${JSON.stringify({ type: "thread.started", model: "codex/actual-model" })}\n`);
    process.stdout.write(`${JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
    })}\n`);
    break;
  }
  default:
    throw new Error(`Unknown fixture mode: ${mode}`);
}
