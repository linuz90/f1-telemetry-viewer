import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { telemetryServer } from "./src/plugin/telemetry-server";
import { changelogPlugin } from "./src/plugin/changelog";
import { resolveDevServerPort } from "./scripts/dev-server-port.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devServerPort = resolveDevServerPort();
  const rawBase = env.VITE_BASE_PATH || "/";
  const leadingSlashBase = rawBase.startsWith("/") ? rawBase : `/${rawBase}`;
  const base = leadingSlashBase.endsWith("/")
    ? leadingSlashBase
    : `${leadingSlashBase}/`;
  // index.html reads %VITE_THEME%; a default keeps Vite from warning about
  // an undefined variable on every build that doesn't force a theme.
  process.env.VITE_THEME ??= env.VITE_THEME || "system";

  return {
    base,
    server: {
      open: true,
      ...(devServerPort.port
        ? {
            port: devServerPort.port,
            strictPort: devServerPort.strict,
          }
        : {}),
    },
    plugins: [
      react(),
      tailwindcss(),
      changelogPlugin(),
      telemetryServer(env.TELEMETRY_DIR, base),
    ],
  };
});
