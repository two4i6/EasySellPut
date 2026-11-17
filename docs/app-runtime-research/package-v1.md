# First-party module package v1

The verifier, profile registry, explicit CLI maintenance and leased GEX asset loading are implemented. Full domain/catalog ownership and native delivery acceptance are tracked in TODO.md.

The ZIP contains exactly `app.json`, `app.sig` and the payload files listed by the signed manifest. Directory entries are unnecessary. `app.sig` is an ECDSA P-256/SHA-256 DER signature over the exact UTF-8 bytes of `app.json`, using the installation's pinned release key. No canonicalization is performed after signing. Production verification binds the compiled repository and runtime ID; local unconfigured builds do not trust external packages. Test keys are supplied only through the internal test composition boundary.

Manifest fields:

| Field | Meaning |
| --- | --- |
| schemaVersion | Exactly 1 |
| repository | Exact compiled trusted owner/repository |
| id | Lowercase dotted/dashed application identity |
| version | Stable three-component version |
| hostApi / engineProtocol | Exactly the supported major, currently 1 |
| dataFormat | Positive app-owned data format; registry compatibility must also check existing data before activation |
| runtime | Currently `node24`; executable selection remains host-owned |
| engine | Exact case-sensitive listed `.mjs` path beneath `engine/` |
| ui | Optional exact listed `.html` path beneath `ui/` |
| platforms | Explicit supported runtime IDs; declaration is not native acceptance |
| files | Complete payload file table: path, uncompressed size, SHA-256 |
| modelVersion | Optional original model/source revision, at most 160 characters |

Bounds: compressed and expanded package at most 512 MiB, at most 8192 entries, manifest at most 256 KiB, signature at most 1024 bytes, metadata nesting at most 16 and paths at most 240 characters. Verification streams payload hashes and checks actual decompressed lengths. It rejects unlisted files, case collisions, duplicate JSON properties, non-regular entry types, traversal, Windows device names/streams and unsafe portable filenames. It does not extract or run code. Verified results are not a durable authorization to execute a subsequently changed file: installation and activation must revalidate immutable content and guard path replacement.

The existing five-platform CLI/Automation CI executes `ModulePackageTests`, including a real temporary-key signed core-only package, wrong key/source/API, payload tampering, unlisted files and unsafe cross-platform paths. No production fake trust switch, install hook, shell command or new MCP maintenance tool was introduced.

GEX bundles are prepared explicitly with `python3 build/prepare-app-seed.py`; ordinary .NET compilation never invokes npm. `build/pack-app.py` creates an independently signed `.espapp` from existing core/UI outputs. Loaded individual assets are bounded to 64 MiB and verified again while holding an execution lease; installed scripts live outside disposable caches. Existing embedded assets remain a compatibility seed for profiles without a registered module.

## Optional UI variants

Immutable installed archives use `apps/packages/<id>/<version>/<package-sha256>/package.espapp`. The original version-only layout remains readable, but never masks an existing corrupt hash-addressed variant. Attaching UI to a core-only installation at the same release requires unchanged runtime/model/protocol/data/platform identity and byte-identical existing files. Only new `ui/` and `notices/` files are allowed. Once UI is attached, different same-version contents are refused. Updating code requires a new version; uninstall retains all variants and data. Operation discovery carries the exact package hash and stale calls must rediscover after activation.

## Typed shared host calls

An operation may declare `hostOperations`, a bounded unique allowlist of existing common read-only market/Analytics operations. The host currently permits quotes, bars, expirations, option chains, option pricing, indicators and strategy math. It validates each call against the existing built-in schema and dispatches directly to the shared provider/Analytics owner; recursive app calls, writes, maintenance, arbitrary URLs/files/processes are unavailable. Adding/removing capabilities on an existing operation requires a new operation name.

These operations use protocol-1 framing `host-jsonl-v1`: initial request, strictly increasing bounded `hostCall` IDs, matching `hostResult`, then one terminal `result`. Frames/aggregate output/call count/runtime/diagnostics are bounded; duplicate fields, undeclared capabilities, reused IDs, trailing output and missing completion fail closed. Cancellation reaches provider work and kills the app process before releasing execution ownership. `web/app-sdk/engine-host.mjs` shares the framing implementation. Existing one-shot engines remain compatible.

This is a first-party signed-code contract, not an OS sandbox. No caller can enable a capability absent from authenticated package metadata, and declaring host operations does not grant write permission or create a market stream.

## Signed companion engines and facade errors

Operations may declare at most 16 unique `engineAssets`, restricted to declared `engine/*.mjs` files with a total 128 MiB read budget. The host authenticates/materializes only those dependencies and supplies their paths in request context; tool arguments cannot select executable paths. The GEX facade uses the same pinned Node executable for its original child bundles. Parent cancellation owns the process tree; child output/diagnostics/deadline are bounded.

The reserved single-field `$appError` envelope preserves existing invalid-argument, permission and cancellation errors. Invalid model/data errors retain the host's established `operation_failed` category; no new CLI/MCP error category was added. Ordinary model failure results retain their original `calculation_failed`, incomplete-data and retained-input semantics.

### Logical presentation snapshots

A signed operation may declare `read_app_snapshot` for `preferences` or `desktop`.
This is a private engine capability, not a public CLI/MCP tool. The runtime binds
it to the executing app ID and profile; callers supply no path. Reads use the
existing `SnapshotFile` lock and byte bounds, return the original text or null,
and do not create an absent profile. New apps use `apps/data/<id>/state/`.
GEX's two existing presentation files remain in place through explicit compatibility
aliases; their interpretation/filtering belongs to the app bundle. This capability
grants no writes, credentials, arbitrary files, networking or maintenance access.

### Request-owned market source receipts

`open_market_snapshot` and `read_market_snapshot` are private read-only engine
capabilities. They reuse the caller's routed market service and return complete
provider DTO bytes plus a separate original-provider byte receipt where available.
They do not page/refetch a chain, apply a financial model, persist observations,
start a timer or open another market connection. One session retains at most the
latest DTO and raw payload (each at most 128 MiB); chunks are at most 1 MiB.
Receipts cannot be read by another request and expire on replacement/disposal.
Ordinary public chain tools continue to omit raw provider bodies. Apps must verify
advertised hashes before interpreting or retaining the bytes.
