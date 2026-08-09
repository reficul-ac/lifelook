# Security policy

Dependency advisories block CI unless they are explicitly scoped below. Production JavaScript dependencies (`npm audit --omit=dev`) and all Rust dependencies (`cargo audit`) must remain free of known advisories.

## Temporary development-only exception

| Owner | Reason | Scope | Review deadline |
|---|---|---|---|
| LifeLook maintainers | WebdriverIO's Mocha adapter currently brings in Mocha and `serialize-javascript`; npm's proposed remediation downgrades `@wdio/mocha-framework` from 9.x to 7.7.3. The vulnerable serialization APIs are not used by the shipped application. | Development-only native WebDriver tests: `@wdio/mocha-framework` → `mocha` → `serialize-javascript`; GHSA-5c6j-r48x-rmvq and GHSA-qj8w-gfj5-8c6v only. No production or Rust dependency is excepted. | 2026-11-09 |

The full npm audit remains visible in CI. `scripts/check-npm-audit.mjs` fails for any package or advisory outside this exact chain, so this exception cannot silently expand.
