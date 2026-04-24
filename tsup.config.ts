import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "node20",
  dts: true,
  sourcemap: true,
  clean: true,
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  }
});
