# K-line chart core

Eight unchanged historical, indicator-analysis, timeline and drawing contracts. Reuses host providers, Analytics, MarketTimelineService and ChartDrawingStore. Exact-request drawing writes require explicit permission and one successful host commit. Revision conflicts remain errors. No market socket, native window control, browser or installer permission. Default uninstall retains drawings and all market/observation data. Native rendering and live bar stitching remain shared host capabilities.

## Desktop renderer

The signed package includes the three files in `ui/`. Open Charts from its built-in navigation entry. The host serves these files through the private chart session with the existing v1 state and gesture contract. The chart library, theme, fonts and component helpers come from the host. Keep new renderer versions compatible with that contract. Desktop builds embed the same source for fresh profiles and legacy signed core-only installs.

The first host upgrade enables reading packaged renderers. Later compatible UI releases use the Charts package version and existing signed catalog workflow.
