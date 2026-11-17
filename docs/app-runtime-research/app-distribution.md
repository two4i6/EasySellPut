# Independent application delivery

## User workflow

The host and app feeds are separate and bind the repository/key compiled into the installed host. Runtime environment variables, remotes and preferences never select trust.

```sh
easysellput apps check --json
easysellput apps download easysellput.qqq-gex --json
easysellput apps update --package /path/to/easysellput.qqq-gex-1.0.1.espapp
```

Alternatively select the downloaded package in Settings → Applications. The app page/tasks must be closed before activation; an idle MCP connection can stay open. No installer is exposed through MCP. A core-only package supports CLI/MCP without a GUI. Uninstall preserves observations and verified backups.

The host retains `/releases/latest`. Apps use `/releases/tags/apps` and signed `EasySellPut-apps.json`/`.sig`. Package URLs bind the exact application/version tag, size and SHA-256. Catalogs expire after 30 days, carry a monotonic generation plus exact-body digest, and reject withdrawal, rollback, incompatible runtime/data formats or a changed package identity. An expired/missing catalog does not disable installed apps; it prevents unverified update selection. Maintainers publish a fresh signed catalog with each app release.

## Development and CI

`Apps · Build & Test` builds the original GEX engine and shared SDK directly on Linux x64, Windows x64/ARM64 and macOS Intel/Apple Silicon, without building the .NET host or a GUI. Its `App-core-*` downloads use ephemeral **development-only** signatures and are not installable in production hosts. The generated public key accompanies the artifact for inspection; no private key is retained or embedded.

The full `CI · Test & Package` remains required and continues all desktop/CLI/native/WebView checks. Its app artifact also covers optional UI, exact original bundles, all existing GEX operations, retained-evidence summary, signing and offline release promotion. It retains the same source, licences/notices, runtime lock and model revision. The shared host/CLI compilation does not invoke npm; complete host packaging explicitly prepares a compatibility seed.

## Main-only preparation and publication

1. Change the independent app version in `web/qqq-gex/app.json`; keep the host version unchanged for app-only releases.
2. Merge to main and let required CI pass. Configure the protected `release` environment with `UPDATE_SIGNING_KEY` matching the host's pinned public key.
3. Run **Apps · Release → prepare** with that successful main-push CI run and app version. The workflow reuses the tested `.espapp`, verifies all hashes/model identity, re-signs with production trust and prepares a prerelease draft with a signed app catalog/provenance. It never rebuilds host or app payloads.
4. Review the draft, then explicitly run **Apps · Release → publish** with the same version/CI. It revalidates current main, provenance, signatures, bytes and catalog generation before publishing the app and updating the separate catalog.

App releases and the catalog are GitHub prereleases with `latest=false`, so they cannot become the host update feed. A published app version is immutable. A still-current unpublished draft can be refreshed; stale drafts cannot overwrite a newer catalog or changes to another app. The workflow never installs code on a user machine. Native secret-backed release execution is a separate acceptance step, not established by local fixture tests.

## Scope and remaining acceptance

The package owns the eight existing GEX facades and a retained-evidence summary operation, their contracts, capture orchestration and original model bundles. Existing C# entry points delegate to installed app handlers; unregistered profiles retain the verified compatibility seed. The generic private AppView/SDK, complete UI-free GEX document host, isolated development preview, same-version core→UI attachment and MCP catalog notifications are implemented. These behaviors are exercised independently of release signing.

Final pilot acceptance is recorded separately in `TODO.md`: exact-revision offline/native tests, original-model parity, fixed host hashes, retained evidence and independent A/B update journeys must pass. An app build or a draft script alone is not native acceptance. Secret-backed main release preparation/publication was not dispatched from `work`.

## Running MCP clients

Compatible app activation does not require restarting an idle MCP process. Requests rediscover and authenticate the current catalog and execute under a package-bound lease. Legacy clients receive `notifications/tools/list_changed` on effective tool changes. July 2026 clients can opt into `subscriptions/listen` with `notifications.toolsListChanged=true`; acknowledgements/events carry the subscription request ID and cancellation releases the listener. Without a subscription, use per-request tools discovery (`ttlMs=0`, private scope). Other notification filters are not granted. Installation remains an explicit local desktop/CLI action, never an MCP tool.


## Verified pilot delivery path

The app-only [five-platform CI run 44140353533](https://github.com/two4i6/EasySellPut/actions/runs/44140353533) passed core-only and optional UI artifacts on all supported native targets. Its payload source remains unchanged through the later host runtime fixes. The full integration gate is still required for the pilot's release policy; app-only development feedback does not require waiting for a host build, and Apps release itself only promotes tested payload bytes.

The initial installed host must contain this runtime and the publisher's compiled repository/key. An older pre-runtime installation needs that one host upgrade first. Afterwards compatible app versions install/update externally through the shared registry without changing the host binary. Development-key CI downloads remain test artifacts, not production installers. See `TODO.md` for final integration acceptance rather than treating an app-only green run as complete desktop acceptance.
