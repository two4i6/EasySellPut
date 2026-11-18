# Opt-in GEX archive codec prototype (2026-11-18)

This is a local prototype, not a production migration or release. No Mac connection, real user data, shared-work edit, push, merge or public CI run was used. Baseline work: `b712a943a54bd14486feda46f7b89a5fa6d50815`; isolated branch: `research/gex-lossless-prototype-20261118`. The final local commit is reported separately. No `.agents/skills` exists in the checkout; root AGENTS.md applies.

## Choice and compatibility

Node 24 has zstd, but existing .NET 10 dependencies have no zstd decoder. The prototype uses both runtimes’ built-in Brotli, quality 4 / window 22, with no new compression dependency. It writes independent records, not chains/dictionaries. `MEILI_GEX_ARCHIVE_CODEC=brotli-v2` explicitly enables new writes in both host and child runtime. Absent setting (or explicit gzip-v1) retains current gzip writes, including Node provider gzip1 and normal archive gzip3; .NET uses its existing Fastest gzip. Unknown settings fail. Existing CacheManager compaction is explicitly pinned to legacy gzip and does not upgrade existing gzip or v2 records.

Updated readers always accept legacy TEXT, gzip BLOB, and QGEX v2. Observed-content references and day metadata stay in their current format; references are resolved by existing query code. Provider identity/gzip-v1/brotli-v2 labels are checked, and raw binary provider bytes are decoded as bytes, never UTF-8 round-tripped.

**Old binaries cannot read v2.** Default-off prevents an automatic incompatible rollout, but does not make an opted-in database readable by old clients. Use a separately verified experimental copy and coordinated updated host/app payload; unset the environment flag only changes future writes. Reverting a binary requires restoring the original backup or a separately verified downgrade COPY. No app data compatibility manifest, packaged rollout or public API was changed for release. Do not enable on a shared data directory with old clients.

## Envelope

| Offset | Bytes | Meaning |
|---:|---:|---|
| 0 | 4 | ASCII QGEX |
| 4 | 1 | format version 2 |
| 5 | 1 | codec 1 = Brotli |
| 6 | 2 | reserved zero |
| 8 | 4 | decoded length, unsigned little endian |
| 12 | 4 | compressed payload length, unsigned little endian |
| 16 | 32 | SHA-256 of exact original decoded bytes |
| 48 | declared length | Brotli stream |

Encoded length must equal the physical payload length. Declared decoded size is checked against caller bounds before output allocation (global 128 MiB, existing profile reader 16 MiB); encoded input is bounded too. Node uses maxOutputLength and consumed-input count; .NET uses bounded BrotliDecoder output and consumed/written counts. Both reject wrong versions/codecs/reserved bytes, hash mismatch, forged lengths, truncation and trailing streams/bytes. Plain/gzip readers and external stored body hashes remain. There is no lossy serialization, numerical precision change, timestamp change, sampling change or history deletion.

## Actual storage and recovery paths

Node import/profile/observed input encode helpers and .NET observed/provider writers support the opt-in format. Node capture retains the original provider receipt bytes with a matching encoding label, and providerRaw view decodes the format. Both query reconstruction and .NET day hydration use the shared decoder. Tests execute these entrypoints, rather than merely comparing standalone codec buffers.

`tests/archive-codec-migration.mjs` is a TEST-ONLY exported helper, not a CLI/MCP/CacheManager operation. It refuses an unmarked source and creates new destinations using SQLite backup (never a lone main-file copy of an active WAL). It marks only the experiment copy, verifies decoded source hashes, validates observed references, round-trips new bytes, commits at most 32 rows plus the progress cursor in one transaction, and refuses a changed codec on resume. It supports pause/idempotent resume and verified downgrade to gzip on another new copy. Any failing batch rolls back. Prior committed batches remain readable; the original source stays unchanged. It deliberately lacks production disk-budget/cancellation/backup-retention UX and must not be promoted to production maintenance as-is. Failed backup copies may remain for inspection; no original deletion is attempted.

## Samples and limits

The real six-CBOE-observation archive is unavailable. Repository benchmark JSON cannot substitute for original bytes. The small integration fixture has 20 times × 2 expiries = 40 profiles and 44 protected records including input/reference/provider/day. It proves correctness, not representative compression.

The larger structural synthetic fixture is reproducible via tests/archive-codec-sample.mjs: 6 times × 29 valid Friday expiries × 183 strikes, 174 profiles / 31,842 points (not the prior real sample’s 31,806). Eleven synthetic symbols each contain 1,000 identical-across-capture daily bars. Spot increases .03, IV .00001, bid/ask .01 per capture, OI fixed. Different expiries reuse the same quote arrays. Six intraday bars only. Provider wrapper includes daily context unlike real CBOE composition. There is no realistic quote entropy, missing-IV distribution or seven-day intraday history. Results cannot estimate the user’s savings or full-day growth.

193 records = 174 profile rows + 6 observed inputs + 6 provider packages + 6 raw observed references + 1 full day + 0 partial days; decoded total 65,737,852 bytes. Per-table values below include the complete 48-byte v2 envelope; unchanged metadata/references are counted. Existing hashes, SQLite keys/row/page overhead and derived wire are separate.

| Table | Original stored body bytes | Migrated v2 body bytes |
|---|---:|---:|
| qqq_gex_local_rows | 6,113,193 | 5,030,670 |
| qqq_gex_observed_inputs | 1,629,953 | 452,840 |
| qqq_gex_provider_raw | 1,771,850 | 450,043 |
| qqq_gex_raw | 462 | 462 |
| qqq_gex_local_days | 549,348 | 549,348 |
| qqq_gex_partial_days | 0 | 0 |
| **Total** | **10,064,806** | **6,483,363** |

Actual column reduction: 35.58%; profile table alone 17.71%. Most aggregate benefit still comes from synthetic repeated inputs. Current-policy Node in-memory recompression is 10,033,211 bytes, not the exact source total: prepare step used Python gzip3 for observed inputs (1,629,953 bytes), while Node gzip3 produces 1,598,358. That 31,595-byte implementation difference is excluded from claims about source stored bytes. Unlike the earlier offline experiment, this prototype benchmark has no extra custom chunk-index charge and leaves day metadata uncompressed.

## Performance and memory

Node v24.22.1, zlib 1.3.2.1-motley-285e94b, Brotli 1.2.0, SQLite 3.53.4, Linux 6.18.57, Intel Xeon Platinum 8573C. Three fresh child processes per codec; report medians. CPU=user+system, wall=monotonic. Timed regions exclude DB load, generation, SHA/assert validation and restore; input buffers remain resident. Decoder timing includes envelope verification. Random reads reconstruct complete rows via deterministic (i*97)%193 ordering with no cache. Shared cloud load and GC cause noise; not a general speed claim.

| Codec | Encoded bytes | Encode wall/CPU ms | Decode all wall/CPU ms | Random row wall/CPU ms | Whole-child peak RSS bytes, 3 trials |
|---|---:|---:|---:|---:|---|
| gzip-v1 | 10,033,211 | 401.602 / 421.574 | 248.842 / 287.879 | 0.887 / 1.007 | 268,304,384, 269,365,248, 265,949,184 |
| brotli-v2 | 6,483,363 | 526.604 / 561.387 | 251.781 / 275.657 | 1.139 / 1.279 | 273,403,904, 275,812,352, 265,834,496 |

RSS is process high-water (resourceUsage.maxRSS × 1024 on Linux), including DB-decoded source, encoded buffers, decoded output buffers and random reads; not pure compressor peak, managed heap peak or per-record memory. Each fresh process avoids retaining other codec artifacts. Loaded-RSS snapshots and individual trials are in benchmark JSON. No subtraction of loaded RSS is presented as peak allocation.

.NET 10.0.14 single normalized input (2,279,270 bytes), three sequential trials per codec in one separate process per codec; no warm-up exclusion. These are a different workload, not comparable to whole-archive Node times:

| Codec | Encoded bytes | Median encode wall/CPU ms | Median decode wall/CPU ms | Process peak RSS bytes |
|---|---:|---:|---:|---:|
| gzip-v1 | 449,731 | 17.336 / 17.932 | 16.833 / 16.824 | 47,747,072 |
| brotli-v2 | 75,519 | 40.062 / 40.068 | 14.000 / 14.489 | 45,678,592 |

Larger-copy migration: 186 encoded bodies in 9 committed batches, 902.660 ms wall / 968.568 ms CPU, one run. Six raw references and day metadata stay unchanged. Full migration timing includes SQLite I/O and row hash/round-trip checks, unlike codec timing.

| Physical SQLite | Bytes |
|---|---:|
| Original fixture main DB, WAL 0 | 65,384,448 |
| Migrated copy before VACUUM | 65,384,448 |
| Original-format COPY after VACUUM | 55,128,064 |
| Migrated COPY after VACUUM | 51,343,360 |

The original contains 44,430,848 derived-wire body bytes and existing free pages. The large original→vacuumed change cannot be attributed solely to compression. Matched compacted-copy difference is 3,784,704 physical bytes. VACUUM occurred only on experiment copies; original source byte hash was verified unchanged.

## Validation and remaining gates

- PASS: full Meili.Data.Tests: 165 passed, 15 explicit live tests skipped, 0 failed. Existing xUnit2031 warnings in YahooTests are unrelated.
- PASS: default gzip pipeline and explicitly enabled Brotli pipeline, including causal replay/partial metadata/corruption rejection.
- PASS: Node binary/empty/Unicode vectors, legacy plain/gzip, header/hash/length/bounds/truncation/trailing rejection; .NET corresponding tests.
- PASS: actual capture+provider+normalized writes and providerRaw view in both modes with an in-memory synthetic host protocol (no network).
- PASS: Node↔.NET bytes; real .NET provider opt-in writer; real .NET day projection from Node gzip/v2 profiles identical.
- PASS: 32-row committed pause, mixed-format replay, resume/idempotence, codec-change refusal, downgrade COPY, injected failure rollback, corrupt input preserving prior rows, real child SIGKILL before commit then restart.
- PASS: cold full-profile exposure window equality after deleting derived wire only on the disposable v2 copy; fixed-cutoff replayTable equality; all 193 decoded hashes and 44-row integration records checked.
- PASS: existing storage-fault suite in both modes (killed transactions, actual SQLITE_FULL, low-space refusal); MCP lossless profile and partial archive tests, provider index; seventeen original analysis fixture routes.
- PASS: source verification (316 unchanged hashes / 6 preexisting reviewed presentation patches), surface checks and git diff --check.
- NOT RUN: public CI (not pushed), release packaging, full Application/UI/native suites, Windows/macOS execution, real-market growth/savings. No screenshot needed for unchanged UI. No Mac connection attempted.
- NOT IMPLEMENTED: production migration/rollback UX, packaged compatibility gating, production disk/cancellation policy for migration, delta/shared-subdocument storage.

Both codecs passed on Linux, but only coordinated updated readers understand v2; this is prototype completion, not production rollout approval.

Larger immutable source SHA-256: `09d05a946284a00d1a16dad5b057f2141fcd3cc183bce341acd9dba60acd2372`.
Original/restored fixed replay response SHA-256: `9b92cd721ed7916c5082b1bf0da750b21913141f40da0952fbf91892031e928b`.

## Reproduce locally without any Mac or real data

From a fresh checkout of this prototype commit, use the pinned SDK and Node24. npm build and all commands below are local, with a new temporary destination each time:

```sh
cd web/qqq-gex
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/gex-npm-cache
node build-runtime.mjs
node tests/local-pipeline.mjs
MEILI_GEX_ARCHIVE_CODEC=brotli-v2 node tests/local-pipeline.mjs
cd ../..
dotnet build tests/Meili.GexCodec.Host/Meili.GexCodec.Host.csproj
dotnet test tests/Meili.Data.Tests/Meili.Data.Tests.csproj
cd web/qqq-gex
GEX_CODEC_HOST=../../tests/Meili.GexCodec.Host/bin/Debug/net10.0/Meili.GexCodec.Host.dll node tests/archive-codec-v2.mjs
node tests/archive-codec-sample.mjs /tmp/NEW-synthetic-gex-sample
node tests/archive-codec-benchmark.mjs /tmp/NEW-synthetic-gex-sample/structural.db /tmp/NEW-gex-benchmark
cd ../..
dotnet tests/Meili.GexCodec.Host/bin/Debug/net10.0/Meili.GexCodec.Host.dll bench /tmp/NEW-synthetic-gex-sample/input-0.json /tmp/net-gzip.json gzip-v1
dotnet tests/Meili.GexCodec.Host/bin/Debug/net10.0/Meili.GexCodec.Host.dll bench /tmp/NEW-synthetic-gex-sample/input-0.json /tmp/net-brotli.json brotli-v2
```

Use PYTHON=python where python3 is unavailable. These test helpers target local synthetic validation, not arbitrary existing user archives. Public CI definitions include the new codec tests for future review, but no CI was triggered. Next step is review of this isolated commit, then representative immutable real backups when available; production enablement remains off.
