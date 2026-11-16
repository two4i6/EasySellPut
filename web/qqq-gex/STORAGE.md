# GEX storage policy

CacheManager owns `qqq_gex_wire`. Its default committed logical wire cap is 64 MiB; Node imports trim around each insertion and target 48 MiB. Expired/all cache clearing deletes only regenerable responses and invalidates their import receipts. Original provider bodies, normalized observations, original calculated rows, full/partial day metadata and historical signals remain protected.

New archive bodies are bounded gzip BLOBs; legacy TEXT stays readable. Hashes cover decoded original bytes. An exact manual import already retained as an observed input stores a verified content reference. No numerical precision, IV or historical timestamp is changed by compression.

Settings → cache management → compact GEX storage (or `clear_cache --category qqq_gex_wire --mode compact`) losslessly compresses legacy archives in 32-row committed batches, verifies hashes and integrity, then explicitly vacuums SQLite. Interruption leaves mixed encodings readable; retry resumes. It needs at least two database sizes plus the 256 MiB reserve in available space. Do not remove the database or WAL to recover space.

The 1 GiB archive threshold is a warning, not permission to delete unique history. Capture checks a 256 MiB free-space reserve plus incoming-write budget; imports add 128 MiB transaction headroom. Concurrent filesystem consumers can still cause SQLite FULL, which must roll back without clearing history. Read-only historical access remains available when space is low. A structurally corrupt GEX database is retained and isolated; its writes/maintenance pause, local diagnostics remain accessible and GEX requests return unavailable. No automatic reset is performed.

The actual six-observation test reduced 155.4 MiB to 69.8 MiB while retaining warm responses, or 21.9 MiB after clearing only derived responses and compacting. All protected decoded hashes and full profile-window bytes matched; killed compaction resumed after 32 committed rows. See benchmarks/storage-real-20261116.json for scale, request-clock control, timings and memory. One 14.8 MB cold full-profile read increased from 1.64 s to 2.05 s. This is a space/CPU tradeoff, not a general speed claim.

The short sample extrapolates to about 0.7 GiB of protected archive per regular trading day at a two-minute cadence. Real full-day growth remains unmeasured; longer retention needs capacity planning or an explicit verified export policy. The wire cap does not cap unique history. Mac/Windows native compression/recovery results must be reported separately from Linux tests.
