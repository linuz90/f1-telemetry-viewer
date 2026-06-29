import { DEFAULT_VITE_PORT, resolveDevServerPort } from "./dev-server-port.ts";

function printUsage(exitCode: number): never {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`Usage: pnpm dev:port [--url|--json]

Print the expected Vite dev-server port for the current checkout.

Options:
  --url   Print http://localhost:<port>
  --json  Print port, URL, source, and strict-port metadata

`);
  process.exit(exitCode);
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.includes("--help") || args.includes("-h")) {
  printUsage(0);
}

const unknownArg = args.find((arg) => arg !== "--url" && arg !== "--json");
if (unknownArg) {
  console.error(`Unknown option: ${unknownArg}`);
  printUsage(1);
}

const resolution = resolveDevServerPort();
const port = resolution.port ?? DEFAULT_VITE_PORT;
const url = `http://localhost:${port}`;

if (args.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        port,
        url,
        source: resolution.source,
        strict: resolution.strict,
      },
      null,
      2,
    ),
  );
} else if (args.includes("--url")) {
  console.log(url);
} else {
  console.log(port);
}
