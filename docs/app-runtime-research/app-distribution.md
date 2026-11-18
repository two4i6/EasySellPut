# Independent application delivery

## Supported releases

Official CI covers Windows x64, macOS Intel/Apple Silicon and Linux x64 CLI/MCP: three desktop targets and four CLI/app targets. Windows releases are x64 only. A historical acceptance report describes its named revision, not the current support matrix. Linux ARM64 remains a manual cross-publish target without native official CI.

## Install and update

Install a compatible EasySellPut host once. The host must contain the app runtime and the publisher's compiled repository/public key. Later compatible `.espapp` releases install outside the signed host bundle; no host reinstall is needed.

```sh
easysellput apps check --json
easysellput apps download easysellput.qqq-gex --json
# Use the archive path returned by download. First installation:
easysellput apps install --package /path/to/easysellput.qqq-gex-1.0.1.espapp
# Subsequent compatible updates:
easysellput apps update --package /path/to/easysellput.qqq-gex-1.0.2.espapp
```

Alternatively download the signed `.espapp` from its GitHub Release, then select it in **Settings → Applications**. The current desktop manager selects local packages; its refresh button refreshes installed state, not an online app store. Online catalog discovery/download is available through the CLI. Download alone does not install anything.

Close the app's page/tasks before activation. An idle MCP connection can remain open; subsequent requests use the newly authenticated catalog. Default uninstall retains observations, settings and verified backups:

```sh
easysellput apps uninstall easysellput.qqq-gex
```

Compatible reinstall reuses retained data. Unsupported schema/permission changes, data migrations and downgrades are refused. MCP remains a business-data interface and exposes no maintenance/installation tool.

## Separate feeds and trust

Host updates retain `/releases/latest`. Apps read `/releases/tags/apps`, then the signed `EasySellPut-apps.json` and `.sig`. For this fork the catalog assets are:

- `https://github.com/two4i6/EasySellPut/releases/download/apps/EasySellPut-apps.json`
- `https://github.com/two4i6/EasySellPut/releases/download/apps/EasySellPut-apps.json.sig`

The installed host compiles its repository from GitHub CI; another publisher uses its own compiled repository and matching signing key. Runtime environment variables, remotes and preferences never select trust. Downloads bind app/version, size, SHA-256, runtime/data compatibility and monotonic catalog generation. App releases/catalogs are prereleases with `latest=false`, so they never replace the host Latest feed.

Catalog validity is 30 days. Weekly main-only renewal re-signs existing entries with fresh validity and generation; it does not publish app versions, alter package identities or require user installation. Failed/expired catalogs do not disable installed applications.

## One-time GitHub setup

A repository administrator needs GitHub CLI access that can manage the `release` Environment, its secrets and repository variables. GitHub's Environment secrets REST API requires the classic OAuth `repo` scope even for a public repository; `public_repo` alone is insufficient. A fine-grained token can instead restrict administration to this repository. The connected GitHub App token may not include these administration capabilities even when it can push code.

Before the **first published release**, keep an owner-only private backup outside the checkout:

```sh
gh auth login --web --scopes repo
python3 build/configure-app-distribution.py --repo two4i6/EasySellPut \
  --key "$HOME/.config/EasySellPut-signing/update-signing.pem" --initialize
```

The helper preserves existing reviewers/timers, restricts `release` deployments to the main branch (not tags), uploads `UPDATE_SIGNING_KEY`, pins the matching public key and creates missing `HOST_AUTO_RELEASE` and `APPS_AUTO_RELEASE` variables as `false`, preserving existing values. It refuses silent replacement of an existing signing secret or initialization after published releases. For existing trust, supply the matching backup without `--initialize`. It never merges main or publishes a release. Commit only the public key and reviewed source/workflows; preserve the private backup securely outside Git.

The initial public key currently in source is a development pin. Production setup is incomplete until the matching production secret/public pin and main-only Environment configuration are applied. Never promote development-key CI artifacts as production installers.

## Develop and release

1. Develop with the shared SDK and scratch-only `tools/Meili.AppDev`; run **Apps · Build & Test** for host-independent core/UI feedback. CI artifacts use ephemeral development keys, not production trust.
2. Increment `web/qqq-gex/app.json` for changed payloads, preserving existing public contracts/data semantics. An app-only release leaves the host version unchanged.
3. Merge reviewed changes into main. The full **CI · Test & Package** remains the integration gate, including native packages. With `APPS_AUTO_RELEASE=true`, successful current-main push CI triggers **Apps · Release** to promote the tested payload into a signed draft. It then verifies and automatically publishes the signed app and separate catalog; it never rebuilds the payload.
4. Automatic publication follows successful draft preparation. **Apps · Release → prepare/publish** on main remains available for recovery. Version and CI run are optional inputs: empty values resolve the current app version and the successful CI for the exact current main commit. A published version is immutable; an old-commit draft is never automatically overwritten.
5. Users check/download the separate signed catalog, then explicitly install/update through the shared manager. App installation never modifies the signed host bundle.

**Apps · Renew catalog** runs weekly after setup, or manually on main. Renewal and app publication share one non-cancelling concurrency group and recheck the prior catalog. If renewal/main changes make an old draft stale, prepare a new current draft before publishing.

Automatic publication/renewal remain inactive without the setup variable, signing secret and deployed main workflows. `work`/PR runs cannot release. Initial host distribution still requires the normal platform signing/notarization credentials; app resource updates do not require re-signing the host bundle. No production draft/publication is performed merely by editing these workflow files.

See [the pilot acceptance](pilot-acceptance.md), [GEX integration](gex-branch-integration.md), [package contract](package-v1.md) and [CLI/MCP protocol](../08-CLI与MCP使用说明.md).

## Activation status — 2026-11-18

The administrator reports a main-only release Environment, an active main ruleset requiring `CI · Required checks`, and both automatic release variables set to `false`. All nine production signing secrets are missing. Keep the switches off until credentials, matching production public key and native release verification are ready. Existing environment reviewers can still require approval. Host and app releases are independently version-gated; only the host changes Latest.
