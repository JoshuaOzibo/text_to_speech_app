/**
 * Runs the backend API server and the frontend Vite dev server together.
 * Zero-dependency replacement for concurrently, so `npm run dev` works at the
 * repo root without an extra install.
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const targets = [
  { name: "backend", color: "\x1b[36m", cwd: path.join(root, "backend") },
  { name: "frontend", color: "\x1b[35m", cwd: path.join(root, "frontend") },
];

const children = [];
let shuttingDown = false;

const shutdown = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exit(code);
};

for (const { name, color, cwd } of targets) {
  const child = spawn(npm, ["run", "dev"], {
    cwd,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };

  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on("exit", (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });

  children.push(child);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
