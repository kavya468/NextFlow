import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Root test-*.ts files are manual scripts that contact real services.
    // Discover intentional source tests, never compiled copies under dist/.
    include: ["{app,components,hooks,lib,server,src,tests}/**/*.{test,spec}.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "**/generated/**", "tests/integration/**"],
  },
  resolve: {
    // Keep test imports on TypeScript source if a local compiler emits siblings.
    extensions: [".mts", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
