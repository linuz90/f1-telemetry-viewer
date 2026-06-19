import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ParsedArgs {
  folderPath: string | null;
  viteArgs: string[];
  help: boolean;
}

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function printUsage(exitCode: number): never {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`Usage: pnpm dev:telemetry <folder> [vite args]

Examples:
  pnpm dev:telemetry "/Users/linuz90/PC Stuff/Pits & Giggles/debug data"
  pnpm dev:telemetry --source "/path/to/telemetry folder" -- --host 127.0.0.1 --port 5174

`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): ParsedArgs {
  let folderPath: string | null = null;
  const viteArgs: string[] = [];
  let passthrough = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (passthrough) {
      viteArgs.push(arg);
      continue;
    }

    if (arg === "--") {
      passthrough = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { folderPath, viteArgs, help: true };
    }

    if (arg === "--source" || arg === "-s") {
      const next = argv[i + 1];
      if (!next) printUsage(1);
      folderPath = next;
      i++;
      continue;
    }

    if (arg.startsWith("--source=")) {
      folderPath = arg.slice("--source=".length);
      continue;
    }

    if (!folderPath) {
      folderPath = arg;
      continue;
    }

    viteArgs.push(arg);
  }

  return { folderPath, viteArgs, help: false };
}

function resolveTelemetryDir(folderPath: string): string {
  const telemetryDir = path.resolve(folderPath);

  if (!fs.existsSync(telemetryDir)) {
    throw new Error(`Telemetry folder does not exist: ${telemetryDir}`);
  }

  if (!fs.statSync(telemetryDir).isDirectory()) {
    throw new Error(
      `dev:telemetry only accepts a folder. Put repro JSON files in a folder and pass that path: ${telemetryDir}`,
    );
  }

  return telemetryDir;
}

function viteBinPath(): string {
  return path.join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vite.cmd" : "vite",
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) printUsage(0);
  if (!args.folderPath) printUsage(1);

  const telemetryDir = resolveTelemetryDir(args.folderPath);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TELEMETRY_DIR: telemetryDir,
  };
  delete env.VITE_SKIP_API;

  console.log(`Starting Vite with TELEMETRY_DIR=${telemetryDir}`);

  const child = spawn(viteBinPath(), args.viteArgs, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`Failed to start Vite: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
