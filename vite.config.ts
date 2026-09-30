import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      config: "src/config.ts",
      types: "src/types.ts",
    },
    format: "esm",
    dts: true,
    fixedExtension: false,
    clean: true,
  },
  lint: {
    ignorePatterns: ["**/dist/**", "**/node_modules/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["**/dist/**", "**/node_modules/**"],
    printWidth: 120,
    singleQuote: false,
    semi: true,
  },
});
