import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createBuildPublisher } from "../src/integrations/build-service/publisher.js";

const python = process.argv[2] || process.env.PYTHON || "python";
const script = fileURLToPath(
  new URL("../test/celery-consumer.py", import.meta.url),
);
const child = spawn(python, ["-X", "utf8", "-u", script], {
  stdio: ["pipe", "pipe", "inherit"],
});
const exited = once(child, "exit");
const lines = createInterface({ input: child.stdout });
const deadline = setTimeout(() => child.kill(), 30000);
let passed = false;

try {
  for await (const line of lines) {
    const event = JSON.parse(line);
    if (event.port) {
      const payload = {
        request_id: randomUUID(),
        application_id: 17,
        owner_id: 42,
        name: "contract-app",
        repository_url: "https://github.com/example/app",
        branch: "main",
        application_type: "node",
        source_directory: null,
        requirements_file: null,
        port: 3000,
        run_command: "printf '\u03bb'; node app.js",
      };
      child.stdin.end(`${JSON.stringify(payload)}\n`);
      await createBuildPublisher({
        redisUrl: `redis://127.0.0.1:${event.port}/0`,
        keyPrefix: "contract-test:",
        timeoutMs: 5000,
        attempts: 1,
      }).publish(payload);
    } else {
      passed = event.result === "passed";
      console.info(event);
    }
  }
  const [code] = await exited;
  if (code !== 0 || !passed)
    throw new Error(
      "Celery interoperability check failed. Install test/requirements-celery.txt in the selected Python environment.",
    );
} finally {
  clearTimeout(deadline);
  lines.close();
  if (child.exitCode === null) child.kill();
}
