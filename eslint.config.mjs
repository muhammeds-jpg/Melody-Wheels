import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // ANY alternate dist dir (NEXT_DIST_DIR=.next-build, .next-verify, …).
      // Naming them one at a time meant an unlisted one got linted as source:
      // a stray `.next-verify` produced 4851 problems from minified bundles,
      // which buries the handful of real findings completely.
      ".next-*/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
