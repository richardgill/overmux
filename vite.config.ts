import { defineConfig } from "vite-plus";

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const formatJsonFiles = (files: string[]) => {
  const targets = files.filter((file) => !file.includes("/dist/"));
  return targets.length > 0
    ? `vp fmt --no-error-on-unmatched-pattern ${targets.map(shellQuote).join(" ")}`
    : [];
};

const ignoredPaths = [
  "**/dist/**",
  "**/node_modules/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/test-results/**",
];

export default defineConfig({
  fmt: {
    ignorePatterns: ignoredPaths,
    printWidth: 80,
    singleQuote: false,
    sortPackageJson: false,
  },
  lint: {
    ignorePatterns: ignoredPaths,
    rules: {
      curly: "error",
      "no-unused-expressions": "off",
      "no-unused-vars": "off",
      "no-unsafe-optional-chaining": "off",
      "unicorn/no-await-in-promise-methods": "off",
    },
  },
  staged: {
    "*.{js,ts,mts,jsx,tsx}": ["vp fmt", "vp lint --fix --deny-warnings"],
    "**/*.json": formatJsonFiles,
    "**/*.{yaml,yml}": "prettier --write",
    "{**/package.json,pnpm-workspace.yaml}": () => "pnpm install",
  },
});
