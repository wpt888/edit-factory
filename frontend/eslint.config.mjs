import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-config-next's core-web-vitals ships eslint-plugin-react-hooks v7's
    // React Compiler "rules of react" preset as hard errors, unconditionally —
    // not gated on actually opting into the compiler. This repo has not adopted
    // React Compiler (no `experimental.reactCompiler` in next.config.ts, no
    // babel-plugin-react-compiler dependency), so these 4 rules flag long-
    // standing, intentional pre-compiler patterns used throughout the app
    // (ref-mirrors updated during render to dodge stale closures in debounced
    // callbacks, setState-in-effect for data fetching/sync-on-mount) as errors.
    // Turning these off is not a correctness rollback: rules-of-hooks and
    // exhaustive-deps (the rules that catch actual hook bugs) stay enabled.
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Every named Next build cache is generated output. Feature-specific
    // preview directories use names such as `.next-attention-slot-ux` and
    // must not be linted as application source.
    ".next*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
