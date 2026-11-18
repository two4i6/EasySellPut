# GEX storage policy

CacheManager owns `qqq_gex_wire`. Its default committed logical wire cap is 64 MiB; Node imports trim around each insertion and target 48 MiB. Expired/all cache clearing deletes only regenerable responses and invalidates their import receipts. Original provider bodies, normalized observations, original calculated rows, full/partial day metadata and historical signals remain protected.

New archive bodies are bounded gzip BLOBs; legacy TEXT stays readable. Hashes cover decoded original bytes. An exact manual import already retained as an observed input stores a verified content reference. No numerical precision, IV or historical timestamp is changed by compression.

Settings → cache management → compact GEX storage (or `clear_cache --category qqq_gex_wire --mode compact`) losslessly compresses legacy archives in 32-row committed batches, verifies hashes and integrity, then explicitly vacuums SQLite. Interruption leaves mixed encodings readable; retry resumes. It needs at least two database sizes plus the 256 MiB reserve in available space. Do not remove the database or WAL to recover space.

The 1 GiB archive threshold is a warning, not permission to delete unique history. Capture checks a 256 MiB free-space reserve plus incoming-write budget; imports add 128 MiB transaction headroom. Concurrent filesystem consumers can still cause SQLite FULL, which must roll back without clearing history. Read-only historical access remains available when space is low. A structurally corrupt GEX database is retained and isolated; its writes/maintenance pause, local diagnostics remain accessible and GEX requests return unavailable. No automatic reset is performed.

The actual six-observation test reduced 155.4 MiB to 69.8 MiB while retaining warm responses, or 21.9 MiB after clearing only derived responses and compacting. All protected decoded hashes and full profile-window bytes matched; killed compaction resumed after 32 committed rows. See benchmarks/storage-real-20261116.json for scale, request-clock control, timings and memory. One 14.8 MB cold full-profile read increased from 1.64 s to 2.05 s. This is a space/CPU tradeoff, not a general speed claim.

The short sample extrapolates to about 0.7 GiB of protected archive per regular trading day at a two-minute cadence. Real full-day growth remains unmeasured; longer retention needs capacity planning or an explicit verified export policy. The wire cap does not cap unique history. Mac/Windows native compression/recovery results must be reported separately from Linux tests.

### Capacity planning from retained data (2026-11-16)

Read-only `node tests/archive-growth.mjs DATABASE` reports protected logical tables, physical/WAL/freelist size, observed capture count and explicitly labeled growth scenarios. It does not delete, compact or capture. The six-capture partial sample has29 expiries/174 snapshots/31,806 strike points. An existing losslessly compressed copy has identical decoded profile hashes and22,543,964 protected bytes (~21.5MiB), compared with110,853,019 legacy bytes (~105.7MiB). A195-capture extrapolation is732,678,830 bytes/session (~699MiB); fixed metadata/providers are included in that average, and real growth can differ substantially. This cannot establish a safe permanent retention duration.

Keep the64MiB wire cap/48MiB target; use the1GiB archive threshold as an alert, not a deletion policy. The256MiB free-space reserve pauses new capture/import before mutation; a whole database compaction also requires temporary workspace. Existing legacy data can be re-encoded and compacted through the explicit CacheManager maintenance operation; clearing wire never removes historical inputs/profiles/signals. Backup first to separately verified storage when approaching a chosen disk budget; verify decoded hashes, record count, revision and a restored read before any user-authorized retirement of a local copy. There is no implemented automatic archive hard quota, automatic migration to another disk, or automatic deletion of the sole history. Runtime binaries (~122MiB on Linux), derived wire, SQLite free pages/WAL and protected history are separate capacity costs.

Use SQLite's online backup API, or stop every desktop/CLI/MCP writer and complete a WAL checkpoint before making a filesystem backup. Copying only the main .db while a writer/WAL is active is not a verified backup. Treat qqq-gex.db as protected historical data even though it lives under cache/. The physical size comparison above also reflects previously clearing derived wire and compacting free pages; it must not be attributed to gzip alone. No backups or history deletion were executed by the read-only growth measurement.

### Experimental independent-record codec (default off)

The local prototype supports opt-in `MEILI_GEX_ARCHIVE_CODEC=brotli-v2` writes
with a bounded, length- and SHA-256-verified QGEX v2 envelope in Node and .NET.
Default writes and existing CacheManager compaction remain legacy gzip. Updated
readers retain TEXT/gzip/observed-reference support. Old clients cannot read v2;
only use coordinated updated runtimes with a separately verified experimental
copy. Unsetting the variable does not convert existing v2 rows back to gzip.
There is no automatic upgrade or production migration operation. See the
[prototype evidence and compatibility limits](../../docs/gex-storage-research/codec-prototype-20261118.md)
for synthetic-only byte counts, CPU/wall/RSS measurements and copy-only recovery
rehearsals. No real six-capture sample or Mac/Windows validation is available.
