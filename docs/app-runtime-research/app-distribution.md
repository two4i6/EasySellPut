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

The full `CI · Test & Package` remains required and continues all desktop/CLI/native/WebView checks. Its app artifact also covers optional UI, exact original bundles, an actual read-only retained-evidence operation, signing and offline release promotion. It retains the same source, licences/notices, runtime lock and model revision. The shared host/CLI compilation does not invoke npm; complete host packaging explicitly prepares a compatibility seed.

## Main-only preparation and publication

1. Change the independent app version in `web/qqq-gex/app.json`; keep the host version unchanged for app-only releases.
2. Merge to main and let required CI pass. Configure the protected `release` environment with `UPDATE_SIGNING_KEY` matching the host's pinned public key.
3. Run **Apps · Release → prepare** with that successful main-push CI run and app version. The workflow reuses the tested `.espapp`, verifies all hashes/model identity, re-signs with production trust and prepares a prerelease draft with a signed app catalog/provenance. It never rebuilds host or app payloads.
4. Review the draft, then explicitly run **Apps · Release → publish** with the same version/CI. It revalidates current main, provenance, signatures, bytes and catalog generation before publishing the app and updating the separate catalog.

App releases and the catalog are GitHub prereleases with `latest=false`, so they cannot become the host update feed. A published app version is immutable. A still-current unpublished draft can be refreshed; stale drafts cannot overwrite a newer catalog or changes to another app. The workflow never installs code on a user machine. Native secret-backed release execution is a separate acceptance step, not established by local fixture tests.

## Scope and remaining acceptance

The current artifact can supply authenticated operations and update its GEX engine/UI without recompiling the host. Existing C# GEX routes/capture remain compatibility facades; complete domain ownership, generic AppView/Web SDK/development host, optional UI attachment to the same app version, proactive catalog notifications and full native pilot evidence remain tracked in `TODO.md`. Do not describe those as completed based on these delivery scripts alone.
