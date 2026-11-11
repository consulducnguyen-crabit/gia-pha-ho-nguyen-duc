import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["dist/**", "**/node_modules/**", "functions/lib/**", "*-debug.log"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/scripts/**/*.mjs", "**/scripts/**/*.ts"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        document: "readonly",
        innerWidth: "readonly",
      },
    },
  },
);
