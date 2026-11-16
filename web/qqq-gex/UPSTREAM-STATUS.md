# EasySellPut upstream compatibility — 2026-11-16

Migration work remains on local `work`, HEAD
`27d261b959e6dbb973f8528a5c455af9a084adcb`. A read-only fetch initially confirmed remote
`work` at `216c97526b93dbd3c51b6ee123ac066e5e5393dc`. Final recheck fetched
`bf4d77d06cc35a825bf7ae216535d60817963c60` into `FETCH_HEAD`; the local
`origin/work` tracking ref remains at `27d261b` under this fetch configuration. No merge, rebase,
checkout, push or deployment was performed; local changes remain intact.

There are 215 changed upstream files at `bf4d77d`. Ten also have tracked local modifications.
A temporary three-way `git merge-file -p` preview (without touching the checkout)
found textual conflicts in:

- `.github/workflows/ci.yml` — one conflict block.
- `skills/easysellput-local/SKILL.md` — one block.
- `src/Meili.Application/Meili.Application.csproj` — one block.
- `tests/automation/capability_cases.json` — two blocks.

The six other overlapping files merge textually in this preview: WPF MainWindow
XAML/code, both language dictionaries, macOS MainWindow code and desktop package
checks. This does not prove semantic compatibility. Upstream also changes the
catalog/CLI, MarketDb/CachedMarketData/ResponseCache, composition, themes and
updater trust. They require integration tests after synchronization.

In particular upstream AGENTS adds `IManagedCache`/`CacheManager` registration,
explicit TTL/capacity/statistics and cross-process invalidation fencing. The local
baseline lacks these types. The GEX store currently has explicit expiry/hash and
atomic writes, but is not yet registered with that upstream cache manager. During
integration, derived GEX wire/replay data must be managed separately from retained
normalized observations and raw historical provenance; cache clearing must not
delete observations. This remains a migration readiness gap.

Remote CI **#89**, SHA `216c975`, was verified through GitHub:
https://github.com/two4i6/EasySellPut/actions/runs/43841045805

Windows x64 and Windows ARM64 CLI/MCP jobs both failed at **Test cache maintenance
& data preservation**; the aggregate required check failed accordingly. These
jobs ran the remote commit without this local migration. Their failure is an
upstream risk, not evidence that this migration caused it. The root failure log
has not been diagnosed here, and no remote green status is claimed. Current local
passing tests are against `27d261b` plus local edits, not against either newer commit.

`bf4d77d` additionally modifies motion settings, default window close/background
behavior, SharedComposition/WebWorkspace and cache-management smoke checks. The
four textual-conflict files above are unchanged in the repeated three-way preview
against this latest commit (ten overlaps total). Its CI outcome has not been
verified; #89 applies only to `216c975`. No root-cause assertion or green status
is made for the latest commit.
