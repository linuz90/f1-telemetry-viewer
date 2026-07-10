import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { telemetryServer } from "./src/plugin/telemetry-server";
import { changelogPlugin } from "./src/plugin/changelog";
import { resolveDevServerPort } from "./scripts/dev-server-port.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devServerPort = resolveDevServerPort();

  return {
    base: env.VITE_BASE_PATH || "/",
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
      telemetryServer(env.TELEMETRY_DIR),
    ],
  };
});
