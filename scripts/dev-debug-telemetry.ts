import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvFileValue(name: string): string | undefined {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) return undefined;

  const line = fs
    .readFileSync(envPath, "utf-8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${name}=`));
  if (!line) return undefined;

  return unquote(line.slice(line.indexOf("=") + 1));
}

function resolveDebugTelemetryDir(): string {
  const configured =
    process.env.DEBUG_TELEMETRY_DIR ?? readEnvFileValue("DEBUG_TELEMETRY_DIR");

  if (!configured) {
    throw new Error(
      "DEBUG_TELEMETRY_DIR is not set. Add it to .env or use `pnpm dev:telemetry <folder>` for a one-off folder.",
    );
  }

  const telemetryDir = path.resolve(configured);
  if (!fs.existsSync(telemetryDir)) {
    throw new Error(`DEBUG_TELEMETRY_DIR does not exist: ${telemetryDir}`);
  }
  if (!fs.statSync(telemetryDir).isDirectory()) {
    throw new Error(`DEBUG_TELEMETRY_DIR must be a folder: ${telemetryDir}`);
  }

  return telemetryDir;
}

function tsxBinPath(): string {
  return path.join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
}

try {
  const telemetryDir = resolveDebugTelemetryDir();
  // Keep all telemetry-serving behavior in dev-with-telemetry.ts. This wrapper
  // only provides a remembered local shortcut for larger generated debug
  // corpora, without making a machine-specific path part of the open-source app.
  const child = spawn(
    tsxBinPath(),
    ["scripts/dev-with-telemetry.ts", telemetryDir, ...process.argv.slice(2)],
    {
      cwd: projectRoot,
      stdio: "inherit",
    },
  );

  child.on("error", (error) => {
    console.error(`Failed to start debug telemetry server: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
