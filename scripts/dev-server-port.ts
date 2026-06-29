import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_VITE_PORT = 5173;

const WORKTREE_PORT_BASE = 5200;
const WORKTREE_PORT_RANGE = 1000;

export interface DevServerPortResolution {
  port: number | undefined;
  source: "manual" | "conductor" | "codex-worktree" | "vite-default";
  strict: boolean;
}

function parsePort(value: string | undefined) {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid dev server port: ${value}`);
  }

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid dev server port: ${value}`);
  }

  return port;
}

function isInsideDirectory(target: string, parent: string) {
  const relative = path.relative(parent, target);
  return (
    relative === "" ||
    (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isCodexManagedWorktree(cwd: string, env: NodeJS.ProcessEnv) {
  const codexHome = path.resolve(
    env.CODEX_HOME ?? path.join(homedir(), ".codex"),
  );
  const worktreesRoot = path.join(codexHome, "worktrees");

  return isInsideDirectory(path.resolve(cwd), worktreesRoot);
}

function stableWorktreePort(cwd: string) {
  const digest = createHash("sha256").update(path.resolve(cwd)).digest();
  const offset = digest.readUInt32BE(0) % WORKTREE_PORT_RANGE;

  return WORKTREE_PORT_BASE + offset;
}

export function resolveDevServerPort(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): DevServerPortResolution {
  const manualPort = parsePort(env.VITE_DEV_PORT);
  if (manualPort) {
    return { port: manualPort, source: "manual", strict: true };
  }

  const conductorPort = parsePort(env.CONDUCTOR_PORT);
  if (conductorPort) {
    return { port: conductorPort, source: "conductor", strict: true };
  }

  // Codex app worktrees do not currently provide a reserved port like
  // Conductor does, so hash the checkout path to avoid Vite's run-order-based
  // auto-increment behavior while keeping normal local checkouts on 5173.
  if (isCodexManagedWorktree(cwd, env)) {
    return {
      port: stableWorktreePort(cwd),
      source: "codex-worktree",
      strict: true,
    };
  }

  return { port: undefined, source: "vite-default", strict: false };
}
