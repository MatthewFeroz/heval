# Studio cleanup after the main update

The 21 incoming commits through 7ef3a20 introduced saved projects, explicit custom-spec application, presentation snapshots and separate chart-document/rendering hooks. Those features are retained.

Completed during integration:

- Recipe identifiers, aggregate options, sort options and visible-control rules now live in charts/recipes.ts and are shared by the editor and URL parser.
- Wilson interval controls appear only for mean pass rates. Strip summary ticks use the same aggregate as the table, including sum.
- Redundant dimension choices are disabled in color, facet and matrix-row selectors.
- Query-string sharing is restricted to a single catalog-backed analysis using recipe controls. Imported data, presentations and custom specs use a project bundle.
- Trial summaries, filters, the trial list and detail drawer moved to TrialPanels.tsx. Table formatting moved to table-values.ts. Chart lifecycle and history remain in the incoming useChartPreview/useChartDocument hooks.
- Trial summaries reuse the report's mean/median/number helpers. Harness names, logos and colors share src/harnesses.ts with the landing-page replay.
- Repeated source counts/export metadata were removed from the sidebar, and internal palette codes were removed from the chart frame.

Additional main-review fixes:

- File URLs are converted with fileURLToPath before loading fonts and artwork, fixing the Windows production build.
- Media export invokes the package's JavaScript CLI through Node rather than a platform-specific shell shim. Temporary-directory failures cannot permanently retain the render lock.
- Presentation and spec editing wait for a loaded document. Tests now wait for rendered data before reading generated JSON.
- Cost per success remains unknown if any included trial lacks a price, rather than understating spend.

Custom specs intentionally remain an advanced mode: controls are disabled while the applied spec owns the canvas. The table is explicitly identified as recipe data. Bundles preserve custom specs and their data; query-string links cannot.

Validation: production build and lint; 14 project/chart tests; 14 runner tests; 47 browser tests (one desktop-only skip); a real HTTP PNG export and unauthenticated run-list rejection. Docker worker execution remains pending the Windows restart required by WSL installation. Real model evaluations were not launched.
