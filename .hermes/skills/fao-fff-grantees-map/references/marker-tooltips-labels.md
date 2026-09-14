# Grantee marker icons + permanent name tooltips (FAO FFF map)

Verified state of single-point markers and their labels in `Webmap/index.html` +
`Webmap/js/myFuncs.js` (all committed on `main`).

## Marker icon: commodity pin built by `commodityPinHtml`
`style_Grantees_div_icon(feature)` in `Webmap/js/myFuncs.js` now returns the output of
`commodityPinHtml(feature.properties.subcategories)`: `className: 'org-pin-wrap'` plus `iconSize`/`iconAnchor`
that depend on how many commodities the org has. (The legacy `.org-pin-img` FFF image is still styled in
`index.html` — probe `.org-pin-wrap`, the stable wrapper either way.)

**User rule: do NOT display the S_N value on the pin** — S_N appears only in the hover popup / Details table.
A blank pin usually means the feature has no `subcategories` (see the Commodities merge in SKILL.md).

### How many commodities → which pin (user rule: 2 commodities = ONE split circle, not two icons)
| commodities | markup | size |
|---|---|---|
| 1 | `<div class="commodity-pin" style="background:C;border-color:C"><span class="commodity-emoji">I</span></div>` | `[32,32]` |
| 2 | `<div class="commodity-pin split" style="background:linear-gradient(90deg,C1 0 50%,C2 50% 100%);border-color:transparent">` + `<span class="commodity-emoji half-left">I1</span><span class="commodity-emoji half-right">I2</span>` | `[32,32]` |
| 3 | `.commodity-stack` of 22px `.mini-pin` circles | `[n*24+4, 28]` |

```js
if (metas.length === 2) { /* the split-pin markup above */ }
var isStack = capped.length > 2;      // was > 1 before the split pin existed
```
```css
.commodity-pin.split { position: relative; overflow: hidden; }
.commodity-pin.split .commodity-emoji { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.commodity-pin.split .half-left  { clip-path: inset(0 50% 0 0); }
.commodity-pin.split .half-right { clip-path: inset(0 0 0 50%); }
```
Mechanism: both emoji are stacked in the same circle and each is clipped to its own half, so one 32px pin
carries two icons; `border-color: transparent` lets the two-colour gradient fill the ring as well. Keep the
emoji centred and clip at the midline — that is what makes "half of each icon" read correctly; do not scale
the glyphs. Only exactly-2 splits; a 3-way split inside 32px is illegible (the stack stays for 3).

Probe: `document.querySelector('.org-pin-wrap .commodity-pin.split')` → expect width/height 32, a
`linear-gradient(90deg, …)` background, and `clipPath` `inset(0px 50% 0px 0px)` / `inset(0px 0px 0px 50%)` on
the two `.commodity-emoji` children. `commodityPinHtml` and `style_Grantees_div_icon` are globals, so you can
also unit-check the markup from `page.evaluate` with synthetic features.

## Tooltip: org name, permanent (visible without hover)
```js
marker.bindTooltip(feature.properties.Name_of_Organization || ('S.N. ' + feature.properties.S_N), {
    direction: 'top',
    className: 'org-tip-name',
    offset: [0, -12],
    permanent: true,     // name ALWAYS visible, no hover needed (user requested)
    interactive: false   // label must not steal pointer events from the marker
});
```
- Tooltip shows `Name_of_Organization` (user rule: not the S.N. number).
- This is a per-point `L.marker` bindTooltip inside `pointToLayer`; clusters still show the count
  badge and open the hover popup on `clustermouseover`.

## Wrapping the tooltip at ~3-4 words/line — CRITICAL Leaflet gotcha
`.org-tip-name` CSS lives in the inline `<style>` of `index.html`. Naive CSS wrapping FAILS:

```css
/* does NOT wrap: Leaflet tooltip shrink-to-fit ignores max-width,
   box stays at widest-word width (~82px) -> one word per line */
.org-tip-name { white-space: normal; max-width: 110px; }
```

Leaflet sizes tooltips by content and **ignores `max-width` for wrapping** — at 72/110/180px
max-width the box stayed ~82px wide and every long word wrapped to its own line (9 words → 9
lines). The fix is an **explicit `width`** (not max-width):

```css
.org-tip-name {
    white-space: normal;   /* allow wrapping */
    width: 160px;          /* explicit width forces the wrap; max-width alone never will */
    max-width: 160px;
    text-align: center;
    /* aligned to the legend/floating-box tokens (11px/13px, radius 8px, soft .32 shadow) */
    font: 11px/13px Arial, Helvetica, sans-serif;
    background: rgba(255,255,255,0.97);
    border: 1px solid #0070b6;   /* FAO blue */
    border-radius: 8px;
    color: #1a3c5e;
    padding: 2px 6px;
    box-shadow: 0 4px 18px rgba(0,0,0,0.32);
}
.leaflet-tooltip.org-tip-name::before { display: none; }   /* drop the arrow */
```
Verified in-browser: with `width:160px`, a 9-word org name wraps to 4 lines (~3-4 words/line)
and a 3-word name stays on one line. Short names size down fine (no fixed-height side effects).

## Browser verification probe
```js
document.querySelectorAll('.leaflet-tooltip.org-tip-name').length      // >0 once pins visible
// per tip: { text, words, lines: Math.round(t.offsetHeight/14), width: t.offsetWidth }
// width should be <= 160 (capped), lines < words for any long name (wrapping worked)
```
Only un-clustered points render tips at a given zoom (clusters swallow their children) — zoom
into a cluster to expose labeled pins. Serve over HTTP; the async layer + fetch boundaries never
work on `file://`.
