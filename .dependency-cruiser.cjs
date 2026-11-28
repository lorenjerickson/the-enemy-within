/**
 * Coupling rules, checked in CI (productization, Phase 0): `pnpm deps`.
 * - No import cycles. The two that exist today are known violations (.dependency-cruiser-known-violations.json),
 *   tolerated until Phase 1 breaks them; a new cycle fails.
 * - Shared packages (packages/*, e.g. the domain model and the engine from Phase 1) import nothing from the apps, the
 *   database, Next.js or React: they stay pure.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Import cycles couple modules into one; break them (move the shared part down a level).",
      from: {},
      to: { circular: true },
    },
    {
      name: "packages-stay-pure",
      severity: "error",
      comment: "A shared package depends only on other shared packages and plain libraries: never on an app, the database, Next.js or React.",
      from: { path: "^packages/" },
      to: { path: ["^apps/", "node_modules/(next|react|react-dom|better-sqlite3)/"] },
    },
    {
      name: "no-orphans-in-packages",
      severity: "warn",
      comment: "A module in a shared package nothing imports (and that isn't an entry point) is probably dead.",
      from: { orphan: true, path: "^packages/", pathNot: "(^|/)(index|[^/]+\\.test)\\.ts$" },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(\\.next|\\.turbo|node_modules)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "apps/web/tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"], extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs"] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
