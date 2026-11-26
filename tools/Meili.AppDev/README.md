# Isolated app development host

This source-only host never ships in desktop/CLI packages. It verifies an explicitly chosen development package/key and always creates a disposable scratch profile; it cannot select an existing profile, change product trust, access desktop assemblies or enable write tools.

```sh
# Build the app independently (Node 24); add --ui-dir for a UI-capable package.
python3 build/prepare-app-seed.py
python3 build/pack-app.py --development --repository test/source --output /tmp/gex.espapp

# Run an actual app-owned operation without rebuilding/opening the main application.
dotnet run --project tools/Meili.AppDev -- --package /tmp/gex.espapp --public-key /tmp/gex.espapp.public.pem --repository test/source --operation get_qqq_gex_retained_summary
```

For a generic SDK-based app UI, omit `--operation` to receive a tokenized local preview URL. Enter/EOF or Ctrl+C stops the server. The SDK exposes only signed app-owned operations, with no arbitrary command/filesystem/browser bridge. For GEX, the default preview serves the complete original document through the same UI-free application session used by native adapters. `--view generic` selects the generic SDK shell explicitly. Both use the same private parser, scoped operations, presentation channel and bounded shutdown.

The production host will reject development signatures. Use the protected main-only Apps release flow for distributable packages. Keep input fixtures explicit and never infer complete/live coverage from scratch data.

## Original GEX preview

```sh
python3 build/pack-app.py --development --repository test/source --ui-dir web/qqq-gex/dist --output /tmp/gex-ui.espapp
dotnet run --project tools/Meili.AppDev -- --package /tmp/gex-ui.espapp --public-key /tmp/gex-ui.espapp.public.pem --repository test/source --seed-input tests/fixtures/qqq-gex/app-input.json --theme dark --language zh-CN
```

`--seed-input` imports an explicit normalized input into the temporary profile through the signed calculation operation before opening the read-only preview. The original file stays unchanged. Omit it for an empty-state preview. This is synthetic historical evidence, not live market data. No existing data directory, provider credential or production trust override is accepted. `--theme light|dark` and `--language zh-CN|en-US` initialize the generated native design tokens and presentation channel. Core-only packages require `--operation`; preview requires a UI artifact.

Verification: `node web/app-sdk/browser-appview.mjs` exercises the generic SDK; `node web/app-sdk/browser-gex-app.mjs` exercises the actual GEX page, original model, three charts, write denial, 1920/1280×1080 layouts and request-draining scratch cleanup. Both require Playwright's installed Chromium or `CHROMIUM_PATH`.
