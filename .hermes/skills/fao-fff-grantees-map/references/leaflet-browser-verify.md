# Verifying Leaflet / qgis2web map changes in a browser

The user requires proof a UI change actually renders — "done" without browser verification is rejected.

## Serve (required for fetch-loaded layers)
    python3 -m http.server 8000 --directory Webmap
    # open http://localhost:8000
Boundary overlays load via `fetch` and are BLOCKED on `file://` — always use HTTP to verify them.

## Browser-console checks
- Layout fill: `card.getBoundingClientRect().width / panel.getBoundingClientRect().width`
  (a small residual inset from `.card-body` padding is normal; aim for ~full width).
- Overlay rendered? Count SVG paths in the layer's pane:
    document.querySelector('.leaflet-pane_<Name>-pane').querySelectorAll('path').length
  PANE CLASS IS `leaflet-pane_<Name>-pane` — Leaflet appends `-pane`. Using `.pane_<Name>`
  returns null/0 and gives a false "nothing rendered" reading.
  Expected path counts: District=77, Province=7, Chure=1, Nepal=1. District/Province
  start OFF — toggle their `#granteeFilterBar` checkboxes before counting; Chure and Nepal start ON.
- Toggle a layer-control checkbox (or a `#granteeFilterBar` pill), then re-measure to confirm it draws.
- Chure, Nepal (country), and the Organizations (grantee markers) cluster layer are ON by default.

## Gotcha: OpenCode delegation
After `opencode run`, the edit may have landed even if the command exits non-zero from trailing
shell noise (`-/ command not found`, `unexpected EOF`). Verify with `git diff --stat` and a
`node --check` on the relevant `<script>` block rather than trusting the exit code.
