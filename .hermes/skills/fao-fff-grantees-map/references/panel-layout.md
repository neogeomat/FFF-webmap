# Panel layout, hover-popup, and verification recipe (FAO FFF map)

Verified patterns for the three collapsible `.map-panel`s in `Webmap/index.html`
(`#leftPanel`, `#rightPanel`=Details/`#aggregate`, `#bottomPanel`=Aggregate charts).

## Moving a panel to a new screen edge
The `left-panel` / `right-panel` / `bottom-panel` CSS classes are STATIC identifiers;
they do NOT track the panel's actual position. Geometry comes from the `#id` rules.
To relocate a panel you must edit THREE things together or it ends up wrong:

1. `#rightPanel` / `#bottomPanel` / `#leftPanel` geometry — `top/left/right/bottom/width/height`.
2. `.map-panel.<class>.collapsed` off-canvas transform (slide the way it now exits):
   - left → `translateX(calc(-100% - 10px))`
   - bottom strip → `translateY(calc(100% + 10px))`
   - right column → `translateX(calc(100% + 10px))`
   (base `.map-panel.collapsed` is only a fallback.)
3. `.<class> .panel-toggle-btn` placement + the `togglePanel()` arrow glyph in `index.html`
   (button must protrude from the NEW screen-facing edge; arrow `›‹`=horizontal, `⌃⌄`=vertical).

Worked example applied in-session: "Aggregate on the right, Details at the bottom."
- `#rightPanel` (Details) → bottom strip: `left:10; right:10; bottom:0; height:350px`.
  `.right-panel.collapsed` → `translateY(calc(100% + 10px))`; toggle button → above panel
  (`top:-30px; left:50%`); arrow → `⌃`/`⌄`.
- `#bottomPanel` (Aggregate) → right column: `top:80; right:10; width:340; bottom:100`.
  `.bottom-panel.collapsed` → `translateX(calc(100% + 10px))`; toggle button → left of panel
  (`left:-85px; top:50%`); arrow → `›`/`‹`.
- HTML ids/classes unchanged; only css/transform/toggle logic edited.

## Floating legend position (`#commodityLegend`) — LEFT side, rides the LEFT panel
`#commodityLegend` is NOT a panel child — it is a fixed overlay positioned by `updateLegendPosition()`
in `js/map.js`, called from `togglePanel()`/`setMapMode()`. **User rule: the legend belongs on the left and
its movement follows the LEFT panel.** It used to be right-anchored and follow `#rightPanel`; that coupling
is gone — do not restore it.
- Anchor the gap to the panel BODY, not the protruding `.panel-toggle-btn`:
  `legend.style.right = 'auto'; legend.style.left = ((leftCollapsed ? 0 : leftPanel.offsetWidth + 10) + 10) + 'px'`
  with `leftPanel.offsetWidth` = 280, `inset`/`gap` = 10 → **10px collapsed, 300px open**; and
  `legend.style.bottom = bottomCollapsed ? '20px' : '360px'`. Folding the tab width (85px) into the offset
  leaves a visibly larger gap than 10px and the user rejects it.
- The CSS default must match or the first paint jumps:
  `.commodity-legend { left: 300px; right: auto; transition: bottom 0.3s ease, left 0.3s ease; }`.
- Geometry check: legend `[x=300, w=190]` clears the left panel's right edge (`x=290`) and starts BELOW the
  left panel's toggle tab (tab y435-495 vs legend y569-930 at 1500×950 with the bottom panel collapsed), so
  no intersection — and because the legend's DOM node precedes the panels, a panel tab paints on top of it,
  so the tab stays clickable even where the boxes would overlap. A rect-intersection check that ignores the
  vertical axis gives a false overlap alarm; check the tab's actual vertical band before moving anything.
- Verify over HTTP in four states: both collapsed → `left≈10`; LEFT panel open → `≈300`; then open the RIGHT
  panel and assert `left` is UNCHANGED; close the LEFT panel and assert it returns to `≈10` even with the
  right panel open.

## Filling a panel with a scrollable list (no pagination)
Both panels sit in a `top:80px; bottom:100px` column; make the content fill it instead of hugging its content.
- Geometry: `#leftPanel { top:80px; left:10px; width:280px; bottom:100px; height:auto;
  max-height: calc(100vh - 180px); }` — `bottom` (not `height`) is what stretches it, and the
  `max-height` override is needed because the shared `.map-panel { max-height: 80vh }` disagrees with
  `100vh - 180px` at most window heights (at 900px they coincidentally match, which hides the bug).
- Content: `.panel-content { flex: 1 1 auto; min-height: 0 }` (base rule is `flex: 1`, an override of
  `flex: 0 1 auto` re-introduces the gap).
- DataTable: `"scrollY": "calc(100vh - 375px)"` + `"scrollCollapse": true`; the 375 leaves ~30px for the
  header, search row, pagination and padding under the `calc(100vh - 180px)` panel.
- Removing pagination: `dom: 'f<t>'` (drop the `p`), `"paging": false`, delete `pageLength`/`pagingType`.
  The row-click handler on `#dataTable tbody tr` that fills `#aggregate` keeps working.
- Probe (all sizes): `panel.getBoundingClientRect().bottom == innerHeight - 100`,
  `content.scrollHeight - content.clientHeight == 0`, `body.scrollHeight > body.clientHeight` (the list
  scrolls), `pan.querySelectorAll('.dataTables_paginate, .paginate_button').length == 0`,
  `tbody tr` count == org count, and `overflowX == 0`.

## Hover popup that mirrors the info panel
One shared `<div class="info-hover-popup">` appended to `body`, reused for every hover.
- CSS: `position:fixed; z-index:1200; max-width:300px; max-height:60vh; overflow:auto;
  pointer-events:auto;` + FAO-blue border and the legend's typography tokens (see SKILL.md). Hide
  `.panel-header`/`.gf-label` inside it. `pointer-events:auto` plus the deferred hide are what let the
  pointer travel into the box and click a `<details>` summary — full pattern in
  `references/hover-popup-positioning.md`.
- JS (inside `DOMContentLoaded`):
  - `showHoverPopup(html)` sets `innerHTML`, `display:block`, and positions top-right of the
    viewport clear of panels: `top=90; left = map.getSize().x - hoverPopup.offsetWidth - 20`.
  - `hideHoverPopup()` sets `display:none` + clears `innerHTML`.
- Wiring (both hover paths are POPUP ONLY — user rule: they must not write `#aggregate`):
  - point `mouseover` (`pop_Grantees`): `showHoverPopup(bio_table_generator(e.target.feature), e.target.getLatLng());`
    `mouseout`: `hideHoverPopup();` then reset style.
  - cluster `clustermouseover`: `showHoverPopup(clusterOrgCardsHTML(e.layer), e.layer.getBounds().getCenter());`
    `clustermouseout`: `hideHoverPopup();`
- Key invariant: the popup renders the same CARD HTML the panel would (`bio_table_generator` /
  `clusterOrgCardsHTML`), but the panel itself is written only by the boundary CLICK handler.

## Verify over HTTP (headless Playwright harness)
Serve: `python3 -m http.server 6115 --directory Webmap`, then drive it from `~/pw-check` with Playwright
(`cd ~/pw-check && node <probe>.js`). No Chrome binary, no consent popup, no `browser_exec` — that route
is not available on this host. The console snippets below run verbatim inside `page.evaluate`, but pass a
REAL function (a string `pageFunction` silently returns `undefined`):
- Playwright starts a fresh context per run, so the `myFuncs.js` caching pitfall (a long-lived
  `browser_exec` browser serving the OLD file) does not apply — but if a change looks ignored, confirm
  the served file first: `curl -s http://localhost:6115/js/myFuncs.js | grep -c '<new string>'`.
  Then `page.goto('http://localhost:6115/index.html')`.
- Render sanity: `document.querySelectorAll('.grantee-cluster').length` > 0 (expect 7 at
  Nepal zoom); `#granteeFilterBar .gf-type` = 2 (DBG/LoA); `#dataTable tbody tr` > 0.
- Panel geometry after a move:
  ```js
  function box(sel){var el=document.querySelector(sel);var r=el.getBoundingClientRect();
    var cs=getComputedStyle(el);return {x:Math.round(r.left),y:Math.round(r.top),
    w:Math.round(r.width),h:Math.round(r.height),pos:cs.position};}
  ```
  Assert `#rightPanel` is a bottom strip (large w, y near viewport bottom) and `#bottomPanel`
  is a right column (x near right edge).
- Hover popup: `document.querySelector('.info-hover-popup')` exists, `display:none` at rest.
  Dispatch `mouseover` on `.grantee-cluster` (cluster → 1100+ char member table in `#aggregate`
  AND popup `display:block`, `hasTable`) and on `.org-pin` (zoom into a cluster first to
  expose pins; point → bio table with Organization field). Dispatch `mouseout` → popup `display:none`.
- No fatal JS: `typeof Chart !== 'undefined'`, `typeof d3 !== 'undefined' && typeof d3.sankey==='function'`.
- Panel toggles run `map.invalidateSize()` 300ms later. `window.map` is the `<div id="map">`
  (browser named access) while `var map = L.map(...)` is closure-scoped, so `map instanceof L.Map`
  is false and the old fallback `L.map.instances[0]` throws `Cannot read properties of undefined`
  on EVERY toggle, leaving the map size never re-measured. Use a layer's map:
  `var m = (window.layer_Nepal && window.layer_Nepal._map) || (window.clusters_Grantees && window.clusters_Grantees._map);`
  (`layer_Nepal` is always on the map; `clusters_Grantees` covers the rest). Fix both call sites
  (`togglePanel` and `setMapMode`).
