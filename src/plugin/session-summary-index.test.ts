import * as assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";
import { createProductionServer } from "../../server.ts";
import type { SessionSummary, TelemetrySession } from "../types/telemetry.ts";
import { deduplicateSessions } from "../utils/deduplicateSessions.ts";
import { toSlug } from "../utils/parseFilename.ts";
import { buildSessionSummary } from "../utils/sessionSummary.ts";
import {
  createSessionSummaryIndex,
  SESSION_INDEX_FORMAT_VERSION,
  type SessionSummaryIndex,
} from "./session-summary-index.ts";
import { normalizeSessionRelativePath } from "./session-summary-index-files.ts";
import { telemetryServer } from "./telemetry-server.ts";

const RACE_DEMO = fileURLToPath(
  new URL(
    "../../public/demo/race-spa-2026-01-26-22-14-52.json",
    import.meta.url,
  ),
);
const QUALIFYING_DEMO = fileURLToPath(
  new URL(
    "../../public/demo/short-qualifying-zandvoort-2026-02-07-11-33-48.json",
    import.meta.url,
  ),
);
const BENCHMARK_SCRIPT = fileURLToPath(
  new URL("../../scripts/benchmark-session-index.ts", import.meta.url),
);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const RACE_FILE = "Race_Spa_2026_01_26_22_14_52.json";
const QUALIFYING_FILE = "Short_Qualifying_Zandvoort_2026_02_07_11_33_48.json";

interface Harness {
  rootDir: string;
  telemetryDir: string;
  indexFile: string;
  logs: string[];
  logger: Pick<Console, "info" | "warn" | "error">;
}

type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => void;

async function createHarness(t: TestContext): Promise<Harness> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "f1-session-index-test-"));
  const telemetryDir = path.join(rootDir, "telemetry");
  const indexFile = path.join(rootDir, "cache", "session-index.json");
  const logs: string[] = [];
  const record = (...values: unknown[]) => {
    logs.push(values.map(String).join(" "));
  };

  await mkdir(telemetryDir, { recursive: true });
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  return {
    rootDir,
    telemetryDir,
    indexFile,
    logs,
    logger: { info: record, warn: record, error: record },
  };
}

async function copyFixture(
  telemetryDir: string,
  relativePath: string,
  source = RACE_DEMO,
): Promise<string> {
  const destination = path.join(telemetryDir, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  return destination;
}

async function persistenceSignature(filePath: string): Promise<string[]> {
  const fileStat = await stat(filePath, { bigint: true });
  return [
    fileStat.dev,
    fileStat.ino,
    fileStat.size,
    fileStat.mtimeNs,
    fileStat.ctimeNs,
  ].map(String);
}

function compareRelativePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function buildBaseline(
  telemetryDir: string,
  relativePaths: string[],
): Promise<SessionSummary[]> {
  const built = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const raw = await readFile(path.join(telemetryDir, relativePath), "utf8");
      return buildSessionSummary(
        normalizeSessionRelativePath(relativePath),
        JSON.parse(raw) as TelemetrySession,
        Buffer.byteLength(raw),
      );
    }),
  );

  const summaries = built
    .filter((entry) => entry.valid)
    .map((entry) => entry.summary)
    .sort(
      (a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime() ||
        compareRelativePaths(a.relativePath, b.relativePath),
    );

  return deduplicateSessions(summaries).sort(
    (a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime() ||
      compareRelativePaths(a.relativePath, b.relativePath),
  );
}

async function checksum(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function openSessionPath(
  index: SessionSummaryIndex,
  slug: string,
): Promise<string | undefined> {
  const sessionFile = await index.openSession(slug);
  if (!sessionFile) return undefined;
  await sessionFile.handle.close();
  return sessionFile.path;
}

function checksumBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function listenOnEphemeralPort(
  t: TestContext,
  server: Server,
): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  t.after(async () => {
    server.closeAllConnections();
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function createVitePluginServer(plugin: Plugin): Server {
  let middleware: ConnectMiddleware | undefined;
  const configureServer = plugin.configureServer;
  assert.equal(typeof configureServer, "function");
  (configureServer as unknown as (server: ViteDevServer) => void)({
    middlewares: {
      use: (handler: ConnectMiddleware) => {
        middleware = handler;
      },
    },
  } as unknown as ViteDevServer);
  assert.ok(middleware);

  return createHttpServer((req, res) => {
    middleware!(req, res, () => {
      res.statusCode = 404;
      res.end("Not handled");
    });
  });
}

function createTempCachedVitePlugin(
  workingDirectory: string,
  telemetryDir: string | undefined,
  base: string,
): Plugin {
  const previousWorkingDirectory = process.cwd();
  try {
    process.chdir(workingDirectory);
    return telemetryServer(telemetryDir, base);
  } finally {
    process.chdir(previousWorkingDirectory);
  }
}

async function suppressExpectedServerError<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    return await operation();
  } finally {
    console.error = originalError;
  }
}

async function runNodeScript(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", script, ...args],
      {
        cwd: REPOSITORY_ROOT,
        env,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr }));
  });
}

function replaceRequired(
  value: string,
  search: string,
  replacement: string,
): string {
  assert.equal(
    Buffer.byteLength(search),
    Buffer.byteLength(replacement),
    "same-size replacement must preserve the fixture byte length",
  );
  assert.ok(value.includes(search), `fixture is missing ${search}`);
  return value.replace(search, replacement);
}

async function makeSameSizeAtomicReplacement(
  filePath: string,
  search: string,
  replacement: string,
): Promise<void> {
  const before = await stat(filePath, { bigint: true });
  const current = await readFile(filePath, "utf8");
  const updated = replaceRequired(current, search, replacement);
  assert.equal(Buffer.byteLength(updated), Number(before.size));

  const temporaryPath = `${filePath}.replacement`;
  await writeFile(temporaryPath, updated);
  await rename(temporaryPath, filePath);

  // Restoring mtime makes the test exercise inode/ctime invalidation instead
  // of accidentally passing only because the replacement received a new mtime.
  await utimes(
    filePath,
    Number(before.atimeNs) / 1_000_000_000,
    Number(before.mtimeNs) / 1_000_000_000,
  );
}

test("cold, warm, and restart refreshes preserve exact summary output", async (t) => {
  const harness = await createHarness(t);
  const relativePath = path.posix.join("2026_01_26", "race-info", RACE_FILE);
  await copyFixture(harness.telemetryDir, relativePath);
  if (process.platform !== "win32") {
    await mkdir(path.dirname(harness.indexFile), {
      recursive: true,
      mode: 0o755,
    });
    await chmod(path.dirname(harness.indexFile), 0o755);
  }

  const baseline = await buildBaseline(harness.telemetryDir, [relativePath]);
  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });

  const cold = await index.refresh();
  const serializedBaseline = JSON.parse(JSON.stringify(baseline)) as unknown;
  assert.deepEqual(cold.sessions, baseline);
  assert.deepEqual(JSON.parse(cold.serializedSessions), serializedBaseline);
  assert.equal(cold.stats.discovered, 1);
  assert.equal(cold.stats.reused, 0);
  assert.equal(cold.stats.filesRead, 1);
  assert.equal(cold.stats.parsed, 1);
  assert.equal(cold.stats.invalid, 0);
  assert.equal(cold.stats.malformed, 0);
  assert.equal(cold.stats.unstable, 0);
  assert.equal(cold.stats.ioFailures, 0);
  assert.equal(cold.stats.deleted, 0);
  assert.equal(cold.stats.rawBytesRead, (await stat(RACE_DEMO)).size);
  assert.ok(cold.stats.durationMs >= 0);

  const persistedBefore = await persistenceSignature(harness.indexFile);
  const warm = await index.refresh();
  assert.equal(warm.stats.discovered, 1);
  assert.equal(warm.stats.reused, 1);
  assert.equal(warm.stats.filesRead, 0);
  assert.equal(warm.stats.parsed, 0);
  assert.equal(warm.stats.rawBytesRead, 0);
  assert.deepEqual(warm.sessions, baseline);
  assert.deepEqual(
    await persistenceSignature(harness.indexFile),
    persistedBefore,
    "an unchanged warm refresh must not rewrite the cache",
  );

  const restarted = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  const restartWarm = await restarted.refresh();
  assert.equal(restartWarm.stats.discovered, 1);
  assert.equal(restartWarm.stats.reused, 1);
  assert.equal(restartWarm.stats.filesRead, 0);
  assert.equal(restartWarm.stats.parsed, 0);
  assert.equal(restartWarm.stats.rawBytesRead, 0);
  assert.deepEqual(restartWarm.sessions, serializedBaseline);

  if (process.platform !== "win32") {
    const cacheDirectoryStat = await stat(path.dirname(harness.indexFile), {
      bigint: true,
    });
    const cacheFileStat = await stat(harness.indexFile, { bigint: true });
    assert.equal(Number(cacheDirectoryStat.mode & 0o777n), 0o700);
    assert.equal(Number(cacheFileStat.mode & 0o777n), 0o600);
  }

  assert.ok(
    !harness.indexFile.startsWith(`${harness.telemetryDir}${path.sep}`),
  );
  assert.deepEqual(await readdir(harness.telemetryDir), ["2026_01_26"]);
});

test("add, modify, and delete refresh only the affected file", async (t) => {
  const harness = await createHarness(t);
  const raceRelativePath = path.posix.join("race", RACE_FILE);
  const qualifyingRelativePath = path.posix.join("qualifying", QUALIFYING_FILE);
  await copyFixture(harness.telemetryDir, raceRelativePath);

  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  await index.refresh();

  const qualifyingPath = await copyFixture(
    harness.telemetryDir,
    qualifyingRelativePath,
    QUALIFYING_DEMO,
  );
  const added = await index.refresh();
  assert.equal(added.stats.discovered, 2);
  assert.equal(added.stats.reused, 1);
  assert.equal(added.stats.filesRead, 1);
  assert.equal(added.stats.parsed, 1);
  assert.equal(added.sessions.length, 2);

  await makeSameSizeAtomicReplacement(
    qualifyingPath,
    '"track-id":"Zandvoort"',
    '"track-id":"zandvoort"',
  );
  const modified = await index.refresh();
  assert.equal(modified.stats.discovered, 2);
  assert.equal(modified.stats.reused, 1);
  assert.equal(modified.stats.filesRead, 1);
  assert.equal(modified.stats.parsed, 1);
  assert.equal(
    modified.sessions.find(
      (session) => session.slug === toSlug(qualifyingRelativePath),
    )?.track,
    "zandvoort",
  );

  await unlink(qualifyingPath);
  const deleted = await index.refresh();
  assert.equal(deleted.stats.discovered, 1);
  assert.equal(deleted.stats.reused, 1);
  assert.equal(deleted.stats.filesRead, 0);
  assert.equal(deleted.stats.parsed, 0);
  assert.equal(deleted.stats.deleted, 1);
  assert.equal(deleted.sessions.length, 1);
});

test("deletion removes stale slugs and resurrects a dominated PnG auto-save", async (t) => {
  const harness = await createHarness(t);
  const autoRelativePath = path.posix.join(
    "race",
    "Race_Spa_Just_in_case_2026_01_26_21_00_00.json",
  );
  const manualRelativePath = path.posix.join(
    "race",
    "Race_Spa_Manual_2026_01_26_22_14_52.json",
  );
  await copyFixture(harness.telemetryDir, autoRelativePath);
  const manualPath = await copyFixture(
    harness.telemetryDir,
    manualRelativePath,
  );

  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  const initial = await index.refresh();
  assert.equal(initial.sessions.length, 1);
  assert.equal(initial.sessions[0]?.relativePath, manualRelativePath);

  await unlink(manualPath);
  const afterDelete = await index.refresh();
  assert.equal(afterDelete.stats.deleted, 1);
  assert.equal(afterDelete.stats.filesRead, 0);
  assert.equal(afterDelete.stats.parsed, 0);
  assert.equal(afterDelete.sessions.length, 1);
  assert.equal(afterDelete.sessions[0]?.relativePath, autoRelativePath);
  assert.equal(
    await openSessionPath(index, toSlug(manualRelativePath)),
    undefined,
  );
  assert.equal(
    await openSessionPath(index, toSlug(autoRelativePath)),
    path.join(harness.telemetryDir, autoRelativePath),
  );
});

test("hidden PnG caches and hidden directories never become candidates", async (t) => {
  const harness = await createHarness(t);
  const visibleRelativePath = path.posix.join("visible", RACE_FILE);
  await copyFixture(harness.telemetryDir, visibleRelativePath);
  await copyFixture(harness.telemetryDir, ".png_session_cache.json");
  await copyFixture(harness.telemetryDir, ".hidden.json");
  await copyFixture(
    harness.telemetryDir,
    path.posix.join(".internal", QUALIFYING_FILE),
    QUALIFYING_DEMO,
  );

  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  const snapshot = await index.refresh();
  assert.equal(snapshot.stats.discovered, 1);
  assert.equal(snapshot.stats.filesRead, 1);
  assert.equal(snapshot.stats.parsed, 1);
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0]?.relativePath, visibleRelativePath);
});

test("classified races remain valid without timed lap history", async (t) => {
  const harness = await createHarness(t);
  const fixture = JSON.parse(await readFile(RACE_DEMO, "utf8")) as Record<
    string,
    unknown
  >;
  const drivers = fixture["classification-data"] as Array<
    Record<string, unknown>
  >;
  const player = drivers.find((driver) => driver["is-player"] === true);
  assert.ok(player);
  const history = player["session-history"] as Record<string, unknown>;
  history["lap-history-data"] = [];

  await writeFile(
    path.join(harness.telemetryDir, RACE_FILE),
    JSON.stringify(fixture),
  );
  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  const snapshot = await index.refresh();
  assert.equal(snapshot.stats.parsed, 1);
  assert.equal(snapshot.stats.invalid, 0);
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0]?.validLapCount, 0);
  assert.ok(snapshot.sessions[0]?.playerRaceResult);
});

test("symlink files and directories are ignored and cannot become detail paths", async (t) => {
  if (process.platform === "win32") {
    t.skip(
      "creating symlinks requires elevated privileges on some Windows hosts",
    );
    return;
  }

  const harness = await createHarness(t);
  const visibleRelativePath = path.posix.join("visible", RACE_FILE);
  const visiblePath = await copyFixture(
    harness.telemetryDir,
    visibleRelativePath,
  );
  const externalDirectory = path.join(harness.rootDir, "external");
  const externalFile = await copyFixture(
    externalDirectory,
    QUALIFYING_FILE,
    QUALIFYING_DEMO,
  );

  try {
    await symlink(
      externalFile,
      path.join(harness.telemetryDir, "linked-session.json"),
      "file",
    );
    await symlink(
      externalDirectory,
      path.join(harness.telemetryDir, "linked-directory"),
      "dir",
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      t.skip(`symlinks are unavailable on this host (${code})`);
      return;
    }
    throw error;
  }

  let swapBeforeOpen = false;
  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
    testHooks: {
      afterResolveBeforeOpen: async (candidatePath) => {
        if (swapBeforeOpen && candidatePath === visibleRelativePath) {
          swapBeforeOpen = false;
          await unlink(visiblePath);
          await symlink(externalFile, visiblePath, "file");
        }
      },
    },
  });
  const initial = await index.refresh();
  assert.equal(initial.stats.discovered, 1);
  assert.equal(initial.sessions.length, 1);

  swapBeforeOpen = true;
  assert.equal(
    await openSessionPath(index, toSlug(visibleRelativePath)),
    undefined,
  );
  assert.equal((await index.refresh()).sessions.length, 0);
});

test("invalid and malformed JSON are cached until their signatures change", async (t) => {
  const harness = await createHarness(t);
  const visibleRelativePath = path.posix.join("visible", RACE_FILE);
  const invalidRelativePath = "Practice_Invalid_2026_02_08_10_00_00.json";
  const malformedRelativePath =
    "Short_Qualifying_Broken_2026_02_08_11_00_00.json";
  await copyFixture(harness.telemetryDir, visibleRelativePath);
  await writeFile(path.join(harness.telemetryDir, invalidRelativePath), "{}");
  await writeFile(
    path.join(harness.telemetryDir, malformedRelativePath),
    '{"incomplete":',
  );

  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  const cold = await index.refresh();
  assert.equal(cold.stats.discovered, 3);
  assert.equal(cold.stats.filesRead, 3);
  assert.equal(cold.stats.parsed, 3);
  assert.equal(cold.stats.invalid, 1);
  assert.equal(cold.stats.malformed, 1);
  assert.equal(cold.sessions.length, 1);

  const warm = await index.refresh();
  assert.equal(warm.stats.reused, 3);
  assert.equal(warm.stats.filesRead, 0);
  assert.equal(warm.stats.parsed, 0);
  assert.equal(warm.stats.invalid, 0);
  assert.equal(warm.stats.malformed, 0);

  await copyFixture(
    harness.telemetryDir,
    malformedRelativePath,
    QUALIFYING_DEMO,
  );
  const recovered = await index.refresh();
  assert.equal(recovered.stats.filesRead, 1);
  assert.equal(recovered.stats.parsed, 1);
  assert.equal(recovered.stats.malformed, 0);
  assert.equal(recovered.sessions.length, 2);
});

test("a stably corrupt indexed file expires its last-good row and later recovers", async (t) => {
  const harness = await createHarness(t);
  const relativePath = path.posix.join("race", RACE_FILE);
  const filePath = await copyFixture(harness.telemetryDir, relativePath);
  const slug = toSlug(relativePath);
  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  const initial = await index.refresh();
  assert.equal(initial.sessions.length, 1);
  assert.equal(initial.sessions[0]?.track, "Spa");

  await writeFile(filePath, '{"incomplete":');
  const firstMalformed = await index.refresh();
  assert.equal(firstMalformed.stats.filesRead, 1);
  assert.equal(firstMalformed.stats.parsed, 1);
  assert.equal(firstMalformed.stats.malformed, 1);
  assert.equal(firstMalformed.sessions.length, 1);
  assert.equal(firstMalformed.sessions[0]?.track, "Spa");

  const withinSettleWindow = await index.refresh();
  assert.equal(withinSettleWindow.stats.reused, 1);
  assert.equal(withinSettleWindow.stats.filesRead, 0);
  assert.equal(withinSettleWindow.stats.parsed, 0);
  assert.equal(withinSettleWindow.stats.malformed, 1);
  assert.equal(withinSettleWindow.sessions.length, 1);

  await delay(5_100);
  const expired = await index.refresh();
  assert.equal(expired.stats.filesRead, 0);
  assert.equal(expired.stats.parsed, 0);
  assert.equal(expired.stats.malformed, 1);
  assert.equal(expired.sessions.length, 0);
  assert.equal(await openSessionPath(index, slug), undefined);

  await copyFixture(harness.telemetryDir, relativePath);
  const recovered = await index.refresh();
  assert.equal(recovered.stats.filesRead, 1);
  assert.equal(recovered.stats.parsed, 1);
  assert.equal(recovered.stats.malformed, 0);
  assert.equal(recovered.sessions.length, 1);
  assert.equal(recovered.sessions[0]?.track, "Spa");
  assert.equal(await openSessionPath(index, slug), filePath);
});

test("corrupt, incompatible, and unsafe persisted caches rebuild cleanly", async (t) => {
  const harness = await createHarness(t);
  const relativePath = path.posix.join("visible", RACE_FILE);
  await copyFixture(harness.telemetryDir, relativePath);

  const buildFreshCache = async () => {
    const index = createSessionSummaryIndex({
      telemetryDir: harness.telemetryDir,
      indexFile: harness.indexFile,
      logger: harness.logger,
    });
    const snapshot = await index.refresh();
    assert.equal(snapshot.stats.filesRead, 1);
    assert.equal(snapshot.stats.parsed, 1);
  };
  const assertRebuild = async () => {
    const index = createSessionSummaryIndex({
      telemetryDir: harness.telemetryDir,
      indexFile: harness.indexFile,
      logger: harness.logger,
    });
    const snapshot = await index.refresh();
    assert.equal(snapshot.stats.discovered, 1);
    assert.equal(snapshot.stats.reused, 0);
    assert.equal(snapshot.stats.filesRead, 1);
    assert.equal(snapshot.stats.parsed, 1);
    assert.equal(snapshot.stats.rawBytesRead, (await stat(RACE_DEMO)).size);
    assert.equal(snapshot.sessions.length, 1);
  };
  const readEnvelope = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(harness.indexFile, "utf8")) as Record<
      string,
      unknown
    >;

  await buildFreshCache();

  await writeFile(harness.indexFile, "{not-json");
  await assertRebuild();

  const wrongFormat = await readEnvelope();
  wrongFormat.formatVersion = SESSION_INDEX_FORMAT_VERSION + 1;
  await writeFile(harness.indexFile, JSON.stringify(wrongFormat));
  await assertRebuild();

  const wrongSummary = await readEnvelope();
  assert.equal(typeof wrongSummary.summaryVersion, "number");
  wrongSummary.summaryVersion = (wrongSummary.summaryVersion as number) + 1;
  await writeFile(harness.indexFile, JSON.stringify(wrongSummary));
  await assertRebuild();

  const wrongRoot = await readEnvelope();
  wrongRoot.rootHash = `${String(wrongRoot.rootHash)}-other`;
  await writeFile(harness.indexFile, JSON.stringify(wrongRoot));
  await assertRebuild();

  const outsidePath = path.join(harness.rootDir, "outside.json");
  await copyFile(RACE_DEMO, outsidePath);
  const outsideChecksum = await checksum(outsidePath);
  const unsafeEntry = await readEnvelope();
  const entries = unsafeEntry.entries as unknown[];
  assert.ok(Array.isArray(entries) && entries.length > 0);
  const firstEntry = entries[0] as [string, unknown];
  unsafeEntry.entries = [["../outside.json", firstEntry[1]]];
  await writeFile(harness.indexFile, JSON.stringify(unsafeEntry));
  await assertRebuild();
  assert.equal(await checksum(outsidePath), outsideChecksum);
});

test("cache persistence failures leave a reusable in-memory index", async (t) => {
  const harness = await createHarness(t);
  await copyFixture(harness.telemetryDir, RACE_FILE);
  const blockedParent = path.join(harness.rootDir, "not-a-directory");
  const blockedIndexFile = path.join(blockedParent, "session-index.json");
  await writeFile(blockedParent, "block cache directory creation");

  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: blockedIndexFile,
    logger: harness.logger,
  });
  const cold = await index.refresh();
  assert.equal(cold.stats.filesRead, 1);
  assert.equal(cold.stats.parsed, 1);
  assert.equal(cold.sessions.length, 1);

  await unlink(blockedParent);
  await mkdir(blockedParent);
  const warm = await index.refresh();
  assert.equal(warm.stats.reused, 1);
  assert.equal(warm.stats.filesRead, 0);
  assert.equal(warm.stats.parsed, 0);
  assert.equal(warm.sessions.length, 1);
  assert.equal(
    harness.logs.filter((message) =>
      message.includes("Unable to persist the session summary index"),
    ).length,
    1,
    "memory-only fallback must not retry the failed write on every refresh",
  );
  await assert.rejects(stat(blockedIndexFile), { code: "ENOENT" });
});

test("default cache paths inside telemetry stay memory-only", async (t) => {
  const harness = await createHarness(t);
  await copyFixture(harness.telemetryDir, RACE_FILE);

  const previousWorkingDirectory = process.cwd();
  let index: SessionSummaryIndex;
  try {
    process.chdir(harness.telemetryDir);
    index = createSessionSummaryIndex({
      telemetryDir: harness.telemetryDir,
      logger: harness.logger,
    });
  } finally {
    process.chdir(previousWorkingDirectory);
  }

  const snapshot = await index.refresh();
  assert.equal(snapshot.stats.cacheState, "rejected");
  assert.equal(snapshot.stats.persisted, false);
  assert.equal(snapshot.sessions.length, 1);
  assert.ok(
    harness.logs.some((message) =>
      message.includes("Session summary cache overlaps protected data"),
    ),
  );
  await assert.rejects(stat(path.join(harness.telemetryDir, ".cache")), {
    code: "ENOENT",
  });
});

test("benchmark rejects nested scratch paths before creating them", async (t) => {
  const harness = await createHarness(t);
  const scratchRoot = path.join(harness.telemetryDir, "benchmark-output");
  const result = await runNodeScript(
    BENCHMARK_SCRIPT,
    ["--source-dir", harness.telemetryDir, "--scratch-root", scratchRoot],
    { ...process.env, TELEMETRY_DIR: harness.telemetryDir },
  );

  assert.notEqual(result.code, 0, result.stderr);
  await assert.rejects(stat(scratchRoot), { code: "ENOENT" });
});

test("benchmark rejects symlinked scratch parents before creating them", async (t) => {
  if (process.platform === "win32") {
    t.skip(
      "creating symlinks requires elevated privileges on some Windows hosts",
    );
    return;
  }

  const harness = await createHarness(t);
  const linkedSource = path.join(harness.rootDir, "telemetry-link");
  try {
    await symlink(harness.telemetryDir, linkedSource, "dir");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      t.skip(`symlinks are unavailable on this host (${code})`);
      return;
    }
    throw error;
  }

  const childName = "benchmark-via-link";
  const result = await runNodeScript(
    BENCHMARK_SCRIPT,
    [
      "--source-dir",
      harness.telemetryDir,
      "--scratch-root",
      path.join(linkedSource, childName),
    ],
    { ...process.env, TELEMETRY_DIR: harness.telemetryDir },
  );

  assert.notEqual(result.code, 0, result.stderr);
  await assert.rejects(stat(path.join(harness.telemetryDir, childName)), {
    code: "ENOENT",
  });
});

test("a file changed during its read never replaces the last-good summary", async (t) => {
  const harness = await createHarness(t);
  const relativePath = path.posix.join("race", RACE_FILE);
  const filePath = await copyFixture(harness.telemetryDir, relativePath);
  const original = await readFile(filePath, "utf8");
  const firstChange = replaceRequired(
    original,
    '"track-id":"Spa"',
    '"track-id":"SPA"',
  );
  const secondChange = replaceRequired(
    original,
    '"track-id":"Spa"',
    '"track-id":"SpA"',
  );
  let mutateAfterRead = false;

  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
    testHooks: {
      afterReadBeforeRestat: async (candidatePath) => {
        if (mutateAfterRead && candidatePath === relativePath) {
          mutateAfterRead = false;
          await writeFile(filePath, secondChange);
        }
      },
    },
  });
  const initial = await index.refresh();
  assert.equal(initial.sessions[0]?.track, "Spa");

  await writeFile(filePath, firstChange);
  mutateAfterRead = true;
  const unstable = await index.refresh();
  assert.equal(unstable.stats.filesRead, 1);
  assert.equal(unstable.stats.unstable, 1);
  assert.equal(unstable.sessions[0]?.track, "Spa");

  const recovered = await index.refresh();
  assert.equal(recovered.stats.filesRead, 1);
  assert.equal(recovered.stats.parsed, 1);
  assert.equal(recovered.stats.unstable, 0);
  assert.equal(recovered.sessions[0]?.track, "SpA");
});

test("overlapping refresh and resolver calls share one read/finalization flight", async (t) => {
  const harness = await createHarness(t);
  const relativePath = path.posix.join("race", RACE_FILE);
  await copyFixture(harness.telemetryDir, relativePath);

  let hookCalls = 0;
  let markEntered: (() => void) | undefined;
  let releaseRead: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
    testHooks: {
      afterReadBeforeRestat: async () => {
        hookCalls += 1;
        markEntered?.();
        await readGate;
      },
    },
  });

  const firstRefresh = index.refresh();
  await entered;
  const otherRefreshes = [index.refresh(), index.refresh(), index.refresh()];
  const resolver = openSessionPath(index, toSlug(relativePath));
  releaseRead?.();

  const [first, ...others] = await Promise.all([
    firstRefresh,
    ...otherRefreshes,
  ]);
  const resolvedPath = await resolver;
  assert.equal(hookCalls, 1);
  for (const snapshot of others) assert.strictEqual(snapshot, first);
  assert.equal(resolvedPath, path.join(harness.telemetryDir, relativePath));
});

test("slug collisions have one deterministic, addressable winner", async (t) => {
  const harness = await createHarness(t);
  const basename = "Race_Collision_2026_03_01_12_00_00.json";
  const firstRelativePath = path.posix.join("a", basename);
  const secondRelativePath = path.posix.join("b", basename);

  // Create in reverse order so discovery order cannot accidentally decide the
  // collision. The two telemetry payloads belong to distinct dedupe buckets.
  await copyFixture(harness.telemetryDir, secondRelativePath, QUALIFYING_DEMO);
  const firstPath = await copyFixture(
    harness.telemetryDir,
    firstRelativePath,
    RACE_DEMO,
  );

  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  const snapshot = await index.refresh();
  assert.equal(snapshot.stats.discovered, 2);
  assert.equal(snapshot.stats.parsed, 2);
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0]?.relativePath, firstRelativePath);

  const slug = toSlug(basename);
  const resolved = await openSessionPath(index, slug);
  assert.equal(resolved, firstPath);
  assert.equal(await checksum(resolved!), await checksum(firstPath));
  assert.ok(
    harness.logs.some(
      (message) =>
        message.includes(firstRelativePath) &&
        message.includes(secondRelativePath),
    ),
    "collision warning should identify paths without logging telemetry content",
  );

  const restarted = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  const restartSnapshot = await restarted.refresh();
  assert.equal(restartSnapshot.stats.filesRead, 0);
  assert.equal(restartSnapshot.sessions[0]?.relativePath, firstRelativePath);
  assert.equal(await openSessionPath(restarted, slug), firstPath);
});

test("unknown slugs reconcile once and unsafe lookup text cannot escape the root", async (t) => {
  const harness = await createHarness(t);
  await copyFixture(harness.telemetryDir, RACE_FILE);
  const index = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  await index.refresh();

  const addedRelativePath = path.posix.join("new", QUALIFYING_FILE);
  const addedPath = await copyFixture(
    harness.telemetryDir,
    addedRelativePath,
    QUALIFYING_DEMO,
  );
  assert.equal(
    await openSessionPath(index, toSlug(addedRelativePath)),
    addedPath,
  );

  const warmAfterResolver = await index.refresh();
  assert.equal(warmAfterResolver.stats.discovered, 2);
  assert.equal(warmAfterResolver.stats.filesRead, 0);
  assert.equal(warmAfterResolver.stats.parsed, 0);
  assert.equal(await openSessionPath(index, "missing-session"), undefined);
  assert.equal(await openSessionPath(index, "../../outside"), undefined);
});

test("production HTTP server preserves list/detail contracts and reports refresh failure", async (t) => {
  const harness = await createHarness(t);
  const relativePath = path.posix.join("race", RACE_FILE);
  const fixturePath = await copyFixture(harness.telemetryDir, relativePath);
  const distDir = path.join(harness.rootDir, "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(
    path.join(distDir, "index.html"),
    "<!doctype html><title>test</title>",
  );

  const sessionIndex = createSessionSummaryIndex({
    telemetryDir: harness.telemetryDir,
    indexFile: harness.indexFile,
    logger: harness.logger,
  });
  const server = createProductionServer({
    telemetryDir: harness.telemetryDir,
    distDir,
    sessionIndex,
  });
  const origin = await listenOnEphemeralPort(t, server);

  const listResponse = await fetch(`${origin}/api/sessions`);
  assert.equal(listResponse.status, 200);
  assert.match(
    listResponse.headers.get("content-type") ?? "",
    /application\/json/,
  );
  const sessions = (await listResponse.json()) as SessionSummary[];
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.relativePath, relativePath);

  const slug = sessions[0]!.slug;
  const detailResponse = await fetch(`${origin}/api/sessions/${slug}`);
  assert.equal(detailResponse.status, 200);
  assert.match(
    detailResponse.headers.get("content-type") ?? "",
    /application\/json/,
  );
  assert.equal(
    checksumBytes(new Uint8Array(await detailResponse.arrayBuffer())),
    await checksum(fixturePath),
  );

  const unknownResponse = await fetch(
    `${origin}/api/sessions/not-a-real-session`,
  );
  assert.equal(unknownResponse.status, 404);

  const previousWorkingDirectory = process.cwd();
  let defaultIndexServer!: Server;
  try {
    process.chdir(distDir);
    defaultIndexServer = createProductionServer({
      telemetryDir: harness.telemetryDir,
      distDir,
    });
  } finally {
    process.chdir(previousWorkingDirectory);
  }
  const defaultIndexOrigin = await listenOnEphemeralPort(t, defaultIndexServer);
  const defaultIndexResponse = await fetch(
    `${defaultIndexOrigin}/api/sessions`,
  );
  assert.equal(defaultIndexResponse.status, 200);
  assert.equal(
    ((await defaultIndexResponse.json()) as SessionSummary[]).length,
    1,
  );
  await assert.rejects(stat(path.join(distDir, ".cache")), { code: "ENOENT" });

  const missingTelemetryDir = path.join(harness.rootDir, "missing-telemetry");
  const brokenIndex = createSessionSummaryIndex({
    telemetryDir: missingTelemetryDir,
    indexFile: path.join(harness.rootDir, "broken-cache", "index.json"),
    logger: harness.logger,
  });
  const brokenServer = createProductionServer({
    telemetryDir: missingTelemetryDir,
    distDir,
    sessionIndex: brokenIndex,
  });
  const brokenOrigin = await listenOnEphemeralPort(t, brokenServer);
  const brokenResponse = await suppressExpectedServerError(() =>
    fetch(`${brokenOrigin}/api/sessions`),
  );
  assert.equal(brokenResponse.status, 500);
  assert.deepEqual(await brokenResponse.json(), {
    error: "Failed to load telemetry sessions",
  });
});

test("Vite telemetry middleware preserves base-path APIs and reports missing data", async (t) => {
  const harness = await createHarness(t);
  const relativePath = path.posix.join("race", RACE_FILE);
  const fixturePath = await copyFixture(harness.telemetryDir, relativePath);
  const base = "/save-viewer/";
  const plugin = createTempCachedVitePlugin(
    harness.rootDir,
    harness.telemetryDir,
    base,
  );
  const server = createVitePluginServer(plugin);
  const origin = await listenOnEphemeralPort(t, server);

  const listResponse = await fetch(
    `${origin}/save-viewer/api/sessions?refresh=1`,
  );
  assert.equal(listResponse.status, 200);
  assert.match(
    listResponse.headers.get("content-type") ?? "",
    /application\/json/,
  );
  const sessions = (await listResponse.json()) as SessionSummary[];
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.relativePath, relativePath);

  const slug = sessions[0]!.slug;
  const detailResponse = await fetch(
    `${origin}/save-viewer/api/sessions/${slug}`,
  );
  assert.equal(detailResponse.status, 200);
  assert.match(
    detailResponse.headers.get("content-type") ?? "",
    /application\/json/,
  );
  assert.equal(
    checksumBytes(new Uint8Array(await detailResponse.arrayBuffer())),
    await checksum(fixturePath),
  );

  const unknownResponse = await fetch(
    `${origin}/save-viewer/api/sessions/not-a-real-session`,
  );
  assert.equal(unknownResponse.status, 404);
  assert.deepEqual(await unknownResponse.json(), {
    error: "Session not found",
  });

  const missingConfigPlugin = createTempCachedVitePlugin(
    harness.rootDir,
    undefined,
    base,
  );
  const missingConfigServer = createVitePluginServer(missingConfigPlugin);
  const missingConfigOrigin = await listenOnEphemeralPort(
    t,
    missingConfigServer,
  );
  const missingConfigResponse = await fetch(
    `${missingConfigOrigin}/save-viewer/api/sessions`,
  );
  assert.equal(missingConfigResponse.status, 500);
  assert.deepEqual(await missingConfigResponse.json(), {
    error: "TELEMETRY_DIR not set in .env",
  });

  const brokenPlugin = createTempCachedVitePlugin(
    harness.rootDir,
    path.join(harness.rootDir, "missing-telemetry"),
    base,
  );
  const brokenServer = createVitePluginServer(brokenPlugin);
  const brokenOrigin = await listenOnEphemeralPort(t, brokenServer);
  const brokenResponse = await suppressExpectedServerError(() =>
    fetch(`${brokenOrigin}/save-viewer/api/sessions`),
  );
  assert.equal(brokenResponse.status, 500);
  assert.deepEqual(await brokenResponse.json(), {
    error: "Failed to load telemetry sessions",
  });
});

test("Windows-style nested relative paths normalize to parser-safe separators", () => {
  assert.equal(
    normalizeSessionRelativePath(`season\\race-info\\${RACE_FILE}`),
    `season/race-info/${RACE_FILE}`,
  );
});
