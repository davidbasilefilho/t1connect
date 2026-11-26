# Development checks

Use the Node version in .node-version for reproducible measurements, OpenSSL 3,
and an unprivileged Linux account. Dependencies below are for development only.

    npm ci --ignore-scripts --no-audit --no-fund
    npm run verify
    npm run demo
    npm run bench -- compare 3 4
    npm run bench:restart -- 6

npm run check runs Oxlint, Oxfmt in check mode, and TypeScript no-emit checkJs.
npm run verify then runs the unit and integration suite. npm run fmt is the
explicit formatting command that changes files. CI runs the same verify command
on the exact PR head before the demo and bounded benchmark smoke runs.
Benchmark timings from shared CI runners are smoke evidence, not small-effect
performance comparisons. No npm dependency is needed to run the lab itself.

Oxlint uses the pinned oxlint-tsgolint backend and enables the type-aware
no-floating-promises rule on the current .mjs source and tests. TypeScript uses
allowJs and checkJs over the same runtime, fixtures and tests. The prototype
uses inferred types and targeted annotations, rather than requiring every JS
parameter to have an explicit type. This is not a proof of authorization or
validation of parsed network data; the boundary tests remain required.

## Git hooks

With hk 2.14.0 on PATH, run:

    hk validate
    hk install

The first hk invocation may fetch its pinned Pkl schema. pre-commit runs
npm run check, and pre-push runs npm run verify. They check the working copy
without formatting or staging changes. CI rechecks the committed snapshot.
