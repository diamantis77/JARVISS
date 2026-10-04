import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default defineConfig([
  ...compat.extends("next/core-web-vitals"),
  globalIgnores([".next/**", ".next-dev/**", ".next-e2e/**", ".desktop-build/**", "desktop/dist/**", "dist-desktop/**", "node_modules/**", "coverage/**"]),
]);
