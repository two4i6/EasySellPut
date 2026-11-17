# Shared app SDK

First-party signed apps reuse these transports and the host's existing market/math services. An app owns its domain contracts, model, views and interpretation of retained data. The SDK does not open market sockets, select providers, install packages or grant write permission.

## Browser documents

Bundle `client.mjs` and `presentation.mjs` with your app UI. They work only inside a tokenized private AppView origin; personal web tabs and remote news pages receive no capabilities.

```js
import {createAppClient} from './client.mjs';
import {applyPresentation} from './presentation.mjs';
const client = createAppClient();
const lifetime = new AbortController();
addEventListener('pagehide', () => lifetime.abort(), {once: true});
for await (const snapshot of client.presentationChanges(lifetime.signal)) {
  applyPresentation(snapshot.value);
}
```

`list({signal})` discovers only this app's authenticated operations. `call(name, args, {signal})` uses the same operation schema, permission and structured result as CLI/MCP. Use a lifetime-owned cancellation signal for requests and presentation observation. Presentation updates carry the host's generated design tokens, language and reduced-motion setting; unchanged snapshots do not redraw. Keep existing reusable controls and accessibility semantics rather than inventing another visual system.

## Engine operations

Use `engine.mjs` for a bounded one-shot request/result. Use `engine-host.mjs` when an operation declares typed shared host capabilities in its signed `operations.json` entry. Host calls are sequential, request-owned and allowlisted; always `finish` once and `close` in `finally`. Do not write diagnostics to stdout.

`market.mjs` shares verified chunked source receipt reads and atomic app-input publication:

- `openMarketSnapshot(engine, args)` uses the same routed provider as the caller. Preserve source/as-of/received/delay/adjustment metadata and missingness.
- `readSnapshotReceipt(engine, receipt)` verifies bounds, chunk identity and complete SHA256 before returning the original bytes.
- `publishAppInput(engine, bytes)` requires an authenticated write operation with `write_app_input` plus caller write permission; publication is acknowledged, atomic and conflict-checked.

Read `client.d.mts`, `engine-host.d.mts` and `market.d.mts` for the precise request types and [package v1](../../docs/app-runtime-research/package-v1.md) for protocol, source receipt, upload and execution bounds. Requests expose no arbitrary path/URL/shell or maintenance capability. The runtime is host-owned and hash-pinned; apps never download or find their own Node executable.

## Independent development and delivery

Use the [isolated source host](../../tools/Meili.AppDev/README.md) for app operations/UI without rebuilding the desktop host. It accepts an explicit development package/key and creates a temporary profile; production does not accept those signatures. GEX previews reuse the same document server as native windows.

Increment the app version for changed code/contracts. Add a new operation alongside the old one when semantics/schema/permissions change; never silently remove or mutate an existing public contract. Core→UI attachment at the same version requires byte-identical existing core files. Package/download/install/update are explicit desktop/CLI maintenance, never MCP tools. See [delivery](../../docs/app-runtime-research/app-distribution.md) for app-only CI and protected main-only signing/draft/publication.

```sh
node --test web/app-sdk/engine.test.mjs web/app-sdk/client.test.mjs web/app-sdk/engine-host.test.mjs web/app-sdk/presentation.test.mjs
CHROMIUM_PATH=/usr/bin/chromium node web/app-sdk/browser-appview.mjs
CHROMIUM_PATH=/usr/bin/chromium node web/app-sdk/browser-gex-app.mjs
```

Browser tests are Chromium/synthetic evidence. Four native WebView targets and five CLI targets remain required for final delivery acceptance.
