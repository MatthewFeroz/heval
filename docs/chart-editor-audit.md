# Chart editor audit and implementation

## Implemented

- Recipe changes preserve chosen fields. **Use recipe defaults** applies a preset explicitly.
- Project and bundle downloads include the visible analysis draft, sources, filters, and applied custom spec. Import restores the complete analysis document. Switching saved views saves the outgoing draft in the project.
- Applied custom specs belong to an analysis view or presentation revision. The Spec tab has an explicit Apply step; recipe controls are disabled while the custom spec owns the preview. Return to controls clears the override. Incomplete JSON remains a local text draft until applied.
- Presentations contain a deep copy of their analysis chart, filters, sources, and custom spec. Saving the original analysis no longer changes the presentation. Selecting a different analysis in the presentation explicitly replaces its snapshot. The revision selector opens prior editorial revisions.
- Legacy version 1 projects remain readable. Presentations without analysis snapshots receive a snapshot on import, after the original bundle hash has been verified. Imported source hashes and presentation pins are checked.
- Motion preview and media export receive the presentation's resolved, filtered rows. Imported and combined sources use the same endpoints as catalog data. Exports are disabled while the requested preview is being replaced, and carry the same input and options as that preview.
- Artifact field definitions supply grouping, color, facet, metric, and additional filter choices. Custom values are projected into stable `custom:` keys. Matching metrics must agree on identity, value type, and unit before combining sources. Chart labels and formats use field metadata; scatter frontiers respect declared metric directions.
- Analysis document state lives in `src/project/editor.ts` and `src/studio/useChartDocument.ts`. Undo/redo covers chart controls, source selection, filters, and applied custom specs, with an unsaved-change indicator. Loading a saved view resets its history.
- `src/studio/useChartPreview.ts` owns Vega embedding and export handles. Obsolete renders cannot replace the current DOM. Cleanup finalizes old views and empty selections clear the previous chart.

## Current boundaries

Custom specs store their own data and transformations. They do not translate back into recipe controls, and the Table tab reports recipe aggregation. Share a bundle to preserve custom specs and imported data; query-string links represent recipe settings only.

Motion remains the completion-rate composition grouped by model, using the same selected rows as the chart. It does not animate arbitrary Vega specs. Local media rendering still requires `HEVAL_ENABLE_EXPORTS=1` and the existing HyperFrames toolchain.

Undo/redo applies to the active analysis document. Presentation edits are stored directly in the selected revision; create a new editorial revision before changing a version you want to retain. Projects are saved to downloaded files, not automatically to disk.

## Validation

The studio suite covers desktop and mobile rendering, controls, SVG export, custom-spec bundle reopening, undo/redo, presentation isolation, revision selection, and matching motion preview/export request data. Unit tests cover document history, snapshot isolation, custom fields, input validation, and project/bundle integrity.

A local Bun-server check generated an actual preview and PNG from a one-row imported selection. The browser loaded the generated blob composition without page errors. The production build, TypeScript checks, and lint passed.
