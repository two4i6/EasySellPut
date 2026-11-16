# Upstream compatibility — 2026-11-16

The local `work` branch incorporates upstream `627a875` through merge `3de30b6`.
Previous uncommitted work was preserved as `bbb2f23` and in
`/workspace/qqq-migration-backups/before-upstream-20261116.tar.gz`
(SHA-256 `b31df9f3f29411c603c174c27f47f2a30215d8bf99fb30eb42054de19662d05f`).
The earlier bf4d77d integration is merge `04e0e13`; subsequent GEX work is `8d33943`.
The 627a875 merge retained both language dictionaries' additions. No checkout,
source repository edits, push, deployment or history deletion occurred.

Final read-only remote check found `cbd0c4ef8183d0215b82d0096a065cd8ff743767`.
Its three newer commits add liquidity, theme sampling and quote alignment (85
changed files); they have **not** been merged into this tested migration baseline.
They overlap the catalog/fixtures/skill, model, smoke selector and theme files and
require another protected merge plus tests. The tracking ref does not necessarily
advance under this repository's fetch configuration; `FETCH_HEAD` was inspected.

The parent reported CI #92 at 627a875: both Windows packaged smoke jobs failed at
`page:DataSources` with `Sequence contains no matching element`; native WebView,
Windows regressions/package builds and CLI/MCP/cache checks passed, uploads were
skipped. These are reported remote results, not a claim of local native execution.
The local selector was verified to search `BuiltinRail.Single` after DataSources
moved to the footer. It now targets the actual footer command; a component test
checks that identity and the smoke selection rule allows the footer page's zero
checked rail buttons. Compilation does not prove the packaged native failure is
resolved. No remote green CI status is claimed for this or the latest commit.

GEX uses the merged CacheManager. Only reproducible wire responses are removable;
original input/provenance, full profiles, daily summaries, import progress,
canonical directional alerts, PCS lifecycle observations and presentation settings
are protected. Capacity statistics, generation fences and CLI/MCP maintenance
checks cover this split. Physical SQLite space may retain free pages after clear;
no VACUUM/history deletion is used to disguise storage costs.

Algorithm/page source remains option-seller **work**
`d60e24b56e308a81723f6c206fb52d22ddc0e9f8`; 654 imported file hashes match.

## Current checkpoint (supersedes the unmerged status above)

Upstream `cbd0c4ef8183d0215b82d0096a065cd8ff743767` was safely integrated as
`f44cf48`. The four conflicts preserved GEX and liquidity catalog cases/skill,
test provider overrides and the upstream footer smoke behavior. Migration code
was then saved as `27fe440`. A final read-only check still found cbd0c4e on work;
option-seller work still points to d60e24b. Both source repositories' existing work
was retained. The checkpoint is validated from a separate source archive before
pushing; uncommitted gzip/cache-budget experiments are backed up separately and
are **not** included in that push. No force push or deployment is authorized.
