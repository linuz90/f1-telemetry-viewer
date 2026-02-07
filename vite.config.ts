import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { telemetryServer } from "./src/plugin/telemetry-server";
import { changelogPlugin } from "./src/plugin/changelog";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      tailwindcss(),
      changelogPlugin(),
      telemetryServer(env.TELEMETRY_DIR),
    ],
  };
});
