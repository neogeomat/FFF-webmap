# Hover popup positioning — FAO FFF grantees map

Reusable recipe for the floating `.info-hover-popup` that mirrors the #aggregate info panel on
marker/cluster hover. Confirmed working this session (verified in a real browser over HTTP: pin at
(115,187) → popup opened at (148,189), hugging the marker; flips left near the right edge).

## Styling — the popup must match the floating legend (user rule)
`.commodity-legend` is the reference for every floating box: the popup uses its tokens VERBATIM, and any
new overlay should too. Align by measuring both with `getComputedStyle`, then compare element by element.
```css
.info-hover-popup {
    position: fixed;          /* viewport coords, not absolute */
    z-index: 1200;
    max-width: 300px;
    max-height: 60vh;
    overflow: auto;
    background: rgba(255, 255, 255, 0.97);
    border: 1px solid #0070b6;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.32);   /* legend value — 0.35 is the old, wrong one */
    border-radius: 8px;                           /* legend value — was 6px */
    padding: 6px 10px;                            /* the popup originally had NO padding */
    pointer-events: auto;      /* REQUIRED so the pointer can enter the popup (persistence + clicking
                                  <details> rows); the hide is deferred, see the JS below */
    font: 11px/13px Arial, Helvetica, sans-serif; /* legend value — was 13px/15px */
    color: #1a3c5e;
}
.info-hover-popup table { font: 11px/13px Arial, Helvetica, sans-serif; color: #1a3c5e; margin: 0; }
.info-hover-popup .org-card { background: transparent; box-shadow: none; border-radius: 8px; }
/* Labels read as legend headers (.legend-header): bold 12px #0070b6 over a hairline rule */
.info-hover-popup p.text-muted { color: #0070b6 !important; font-weight: 700 !important; font-size: 12px !important;
    padding: 4px 0; border-bottom: 1px solid #ced4da; margin: 0 0 6px; }
.info-hover-popup .org-details > summary { cursor: pointer; font: bold 12px/13px Arial, Helvetica, sans-serif;
    color: #0070b6; padding: 4px 0; border-bottom: 1px solid #ced4da; margin-bottom: 6px; }

/* SINGLE COLUMN (user rule): label on its own line, value gets the full popup width.
   Bootstrap's .table gives 12px cell padding and a #dee2e6 top border — override both. */
.info-hover-popup table tr { display: block; }
.info-hover-popup table th, .info-hover-popup table td { display: block; width: auto; text-align: left; padding: 0 6px; }
.info-hover-popup table th { color: #0070b6; font-weight: 600; padding-top: 3px; border-top: 1px solid #e9eff5; }
.info-hover-popup table tr:first-child th { border-top: 0; }
.info-hover-popup table td { border-top: 0; padding-bottom: 3px; }

/* The popup re-uses the #aggregate markup, so it inherits bootstrap grid gutters: .row's negative
   margins push the content ~10px past the padding box and add a phantom horizontal scrollbar.
   Zero them or the popup scrolls sideways for no visible reason. */
.info-hover-popup .row { margin-left: 0; margin-right: 0; }
.info-hover-popup [class^="col-"] { padding-left: 0; padding-right: 0; }
```
Measured proof (marker popup, 300px wide): every row `stacked: true` (label and value share a left edge,
value on the next line), value cells 256px inside a 298px content box, `overflowX 0`, `hScrollbar false`.

## JS (create once, reuse)
```js
var hoverPopup = document.createElement('div');
hoverPopup.className = 'info-hover-popup';
hoverPopup.style.display = 'none';
document.body.appendChild(hoverPopup);

function showHoverPopup(html, latlng) {
    hoverPopup.innerHTML = html;
    hoverPopup.style.display = 'block';
    var mapEl = map.getContainer();
    var rect = mapEl.getBoundingClientRect();
    var pw = hoverPopup.offsetWidth, ph = hoverPopup.offsetHeight;
    var left, top;
    if (latlng && map.latLngToContainerPoint) {
        var pt = map.latLngToContainerPoint(latlng);
        left = rect.left + pt.x + 18;
        top  = rect.top  + pt.y - 12;
        if (left + pw > window.innerWidth  - 8) { left = rect.left + pt.x - pw - 18; }
        if (top  + ph > window.innerHeight - 8) { top  = window.innerHeight - ph - 8; }
        if (left < 8) { left = 8; }
        if (top  < 8) { top  = 8; }
    } else {                                 // fallback if no latlng
        left = rect.left + mapEl.clientWidth - pw - 20;
        top  = rect.top + 90;
    }
    hoverPopup.style.left = left + 'px';
    hoverPopup.style.top  = top  + 'px';
}
function hideHoverPopup() {
    if (popupHovered) return;        // pointer is inside the popup: keep it open
    // Grace period: the marker/cluster mouseout fires BEFORE the popup's mouseenter across the
    // 18 px gap, so hide on a delay and let the pointer travel in. mouseenter cancels the timer.
    clearTimeout(popupHideTimer);
    popupHideTimer = setTimeout(function() {
        if (popupHovered) return;
        hoverPopup.style.display = 'none';
        hoverPopup.innerHTML = '';
    }, 250);
}
```

## Persistence state (declare next to the popup element)
```js
var popupHovered  = false;
var popupHideTimer = null;
hoverPopup.addEventListener('mouseenter', function() { popupHovered = true; clearTimeout(popupHideTimer); });
hoverPopup.addEventListener('mouseleave', function() { popupHovered = false; hideHoverPopup(); });
```
Without this, `pointer-events: auto` alone does nothing useful: the box disappears during the trip
from the marker into it, and nothing inside it can ever be clicked.

## Cluster cards must share the marker-card generator
Cluster content is built by `clusterOrgCardsHTML(cluster)` → one `bio_details_generator(feature)` per
member: native `<details class="org-details"><summary>NAME</summary><table>…</table></details>`, all
closed by default, with `bio_detail_rows(p)` shared with `bio_table_generator`. Do not hand-roll
per-member markup and do not swap in a names-only list: the user requires the cluster popup to match
the individual-marker popup style. Minimal CSS to make the summaries read as headers:
```css
.info-hover-popup .org-details { margin: 0 0 6px 0; }
.info-hover-popup .org-details > summary { cursor: pointer; font-weight: bold; color: #0070b6; }
```
Expansion state resets whenever the popup re-renders (hovering another cluster) — acceptable unless
the user asks for sticky state.

## Wire into the async handlers (inside `layer_Grantees.on('data:loaded', …)`)
```js
// individual marker (pop_Grantees / onEachFeature) — hover is POPUP ONLY, never the bottom panel
mouseover: function(e) {
    showHoverPopup(bio_table_generator(e.target.feature), e.target.getLatLng());
},
mouseout: function(e) { hideHoverPopup(); /* + resetStyle(e.target) */ }

// cluster (clusters_Grantees) — same rule: no #aggregate write on hover
clusters_Grantees.on('clustermouseover', function(e) {
    showHoverPopup(clusterOrgCardsHTML(e.layer), e.layer.getBounds().getCenter());
});
clusters_Grantees.on('clustermouseout', function(e) { hideHoverPopup(); });
```

Pitfall: `latlngToContainerPoint` returns coords relative to the map's top-left; add `rect.left` /
`rect.top` (the map's viewport offset) to get page coords for a `position: fixed` element. Skipping
that offset puts the popup in the wrong place when the map isn't at (0,0).
