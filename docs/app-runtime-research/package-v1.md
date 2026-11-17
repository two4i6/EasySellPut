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
