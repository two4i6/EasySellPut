# Isolated app development host

This source-only host never ships in desktop/CLI packages. It verifies an explicitly chosen development package/key and always creates a disposable scratch profile; it cannot select an existing profile, change product trust, access desktop assemblies or enable write tools.

```sh
# Build the app independently (Node 24); add --ui-dir for a UI-capable package.
python3 build/prepare-app-seed.py
python3 build/pack-app.py --development --repository test/source --output /tmp/gex.espapp

# Run an actual app-owned operation without rebuilding/opening the main application.
dotnet run --project tools/Meili.AppDev -- --package /tmp/gex.espapp --public-key /tmp/gex.espapp.public.pem --repository test/source --operation get_qqq_gex_retained_summary
```

For a generic SDK-based app UI, omit `--operation` to receive a tokenized local preview URL. Enter/EOF or Ctrl+C stops the server. The SDK exposes only signed app-owned operations, with no arbitrary command/filesystem/browser bridge. The existing GEX UI still has legacy route dependencies, so its complete preview needs the GEX compatibility adapter; an HTML response alone is not full GEX UI acceptance.

The production host will reject development signatures. Use the protected main-only Apps release flow for distributable packages. Keep input fixtures explicit and never infer complete/live coverage from scratch data.
