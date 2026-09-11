// FAO FFF grantees map - all page logic, split out of index.html.
// Loaded as a plain <script src> (NOT defer): every vendored lib here is deferred, so a
// deferred copy would run after them and change execution order.
// Re-apply this split after any qgis2web re-export (it rewrites index.html).
    // Panel toggle function
    function togglePanel(panelId) {
        var panel = document.getElementById(panelId);
        var arrow = document.getElementById(panelId + 'Arrow');
        panel.classList.toggle('collapsed');
        
        if (panelId === 'leftPanel') {
            arrow.textContent = panel.classList.contains('collapsed') ? '›' : '‹';
        } else if (panelId === 'bottomPanel') {
            // Bottom panel at BOTTOM → arrow points up/down
            arrow.textContent = panel.classList.contains('collapsed') ? '⌃' : '⌄';
        } else if (panelId === 'rightPanel') {
            // Right panel at RIGHT → arrow points left/right
            arrow.textContent = panel.classList.contains('collapsed') ? '›' : '‹';
        }
        
        // Invalidate map size after panel transition
        setTimeout(function() {
            var m = (window.layer_Nepal && window.layer_Nepal._map) || (window.clusters_Grantees && window.clusters_Grantees._map);
            if (m && m.invalidateSize) { m.invalidateSize(); }
        }, 300);
        updateLegendPosition();
    }
    function updateLegendPosition() {
        var legend = document.getElementById('commodityLegend');
        var rightPanel = document.getElementById('rightPanel');
        var bottomPanel = document.getElementById('bottomPanel');
        if (!legend) return;
        var rightCollapsed = rightPanel && rightPanel.classList.contains('collapsed');
        var bottomCollapsed = bottomPanel && bottomPanel.classList.contains('collapsed');
        var panelW = rightPanel ? rightPanel.offsetWidth : 340;
        var inset = 10, gap = 10;
        legend.style.right = ((rightCollapsed ? 0 : panelW + inset) + gap) + 'px';
        legend.style.bottom = bottomCollapsed ? '20px' : '360px';
    }
    if (document.readyState !== 'loading') updateLegendPosition();
    else document.addEventListener('DOMContentLoaded', updateLegendPosition);
    window.addEventListener('load', updateLegendPosition);
    
    // ---- Map mode switch (top nav) ----
    function setMapMode(mode) {
        var isEvo = mode === 'evolution';
        document.body.classList.toggle('map-mode-evolution', isEvo);
        document.querySelectorAll('.mm-tab').forEach(function(btn){
            var active = btn.getAttribute('data-mode') === mode;
            btn.classList.toggle('active', active);
        });
        // When entering evolution, open bottom panel to show the table (if collapsed)
        if (isEvo) {
            var bp = document.getElementById('rightPanel');
            if (bp && bp.classList.contains('collapsed')) {
                bp.classList.remove('collapsed');
                var arr = document.getElementById('rightPanelArrow');
                if (arr) arr.textContent = '‹';
                setTimeout(function(){
                    var m = (window.layer_Nepal && window.layer_Nepal._map) || (window.clusters_Grantees && window.clusters_Grantees._map);
                    if (m && m.invalidateSize) m.invalidateSize();
                }, 320);
            }
        }
        // Re-apply evolution filter if map already initialized
        if (typeof window._evoApplyFilter === 'function') { window._evoApplyFilter(); }
        updateLegendPosition();
    }
    document.addEventListener('click', function(e){
        var btn = e.target.closest('.mm-tab');
        if (!btn) return;
        setMapMode(btn.getAttribute('data-mode'));
    });
    // ---- Filter bar collapsible (collapsed by default, below tabs) ----
    (function(){
        function toggleFilters(){
            var bar = document.getElementById('granteeFilterBar');
            var btn = document.getElementById('filterToggle');
            if (!bar || !btn) return;
            var willOpen = bar.classList.contains('collapsed');
            bar.classList.toggle('collapsed', !willOpen);
            btn.classList.toggle('active', willOpen);
            btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            btn.textContent = willOpen ? 'Filters ▴' : 'Filters ▾';
        }
        document.addEventListener('click', function(e){
            var t = e.target.closest('#filterToggle');
            if (t) { e.preventDefault(); toggleFilters(); }
        });
        // Close when clicking outside filter area (optional)
        document.addEventListener('click', function(e){
            var bar = document.getElementById('granteeFilterBar');
            var wrap = document.getElementById('filterBarWrap');
            if (!bar || bar.classList.contains('collapsed')) return;
            if (wrap && wrap.contains(e.target)) return;
            // click outside the filter area -> collapse (clicks inside the bar, e.g. a pill, keep it open)
            toggleFilters();
        });
    })();

    // Wait for DOMContentLoaded to ensure all deferred scripts and DOM are ready
    document.addEventListener('DOMContentLoaded', function() {
    var highlightLayer;
    // ---- Evolution (Eight Years) state ----
    var FISCAL_LABELS = ['2019–20','2020–21','2021–22','2022–23','2023–24','2024–25','2025–26'];
    var evoFromIdx = 0, evoToIdx = 6, evoPlayTimer = null;
    var evoPerYear = null; // array of {newGrantees,newLocations,newEnterprises, grantAmount:''}
    var evoFirstFiscalByOrg = {}; // org_id string -> fiscal label
    var evoFiscalByGrant = []; // grant -> fiscal label
    var evoLocationFirstFiscal = {}; // location key -> fiscal
    var evoSubcatFirstFiscal = {}; // subcategory -> fiscal
    var evoChartInstance = null;

    function evoMonthToNum(m) {
        var map = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
        return map[m.slice(0,3).toLowerCase()] || 0;
    }
    function parseFiscalYear(periodStr) {
        if (!periodStr) return null;
        var s = String(periodStr).split('\n')[0];
        var mm = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
        var year = 0, month = 0;
        if (mm) { month = evoMonthToNum(mm[1]); year = parseInt(mm[2],10); }
        else {
            var yy = s.match(/(\d{4})/);
            if (yy) year = parseInt(yy[1],10);
            else return null;
        }
        // Nepal FY: Shrawan (July) start. month>=7 -> FY year–year+1 else (year-1)–year
        var fyStart = (month >= 7 && month !== 0) ? year : (month === 0 ? year : year - (month >= 7 ? 0 : 1));
        // fallback for month==0 (only year): map year to FY containing that year
        if (month === 0) {
            // if we only have year, treat as FY year-1 – year if year >=2020 as most grants start early year
            // simplest: if year==2020 -> 2019–20
            fyStart = year - 1;
            if (year < 2019) fyStart = 2019;
        }
        if (fyStart < 2019) fyStart = 2019;
        if (fyStart > 2025) fyStart = 2025;
        var shortY = String(fyStart+1).slice(-2);
        // use en-dash to match FISCAL_LABELS
        return fyStart + '–' + shortY;
    }

    function buildEvoData(attr) {
        var grants = attr.grants || [];
        var orgs = attr.orgs || [];
        // map org_id string -> location key (district || municipality || location)
        var locByOrg = {};
        (orgs || []).forEach(function(o){
            var k = String(o.org_id);
            var loc = (o.district && o.district.trim() ? o.district.trim() : (o.municipality && o.municipality.trim() ? o.municipality.trim() : (o.location||'').trim()));
            if (!loc) loc = 'Loc-'+k;
            locByOrg[k] = loc;
        });
        // per grant fiscal
        evoFiscalByGrant = [];
        var fiscalByGrantIdx = [];
        grants.forEach(function(g,i){
            var fy = parseFiscalYear(g.implementation_period);
            evoFiscalByGrant[i] = fy;
            fiscalByGrantIdx[i] = fy ? FISCAL_LABELS.indexOf(fy) : -1;
        });
        // first fiscal per org (earliest grant)
        evoFirstFiscalByOrg = {};
        grants.forEach(function(g,i){
            var k = String(g.org_id);
            var idx = fiscalByGrantIdx[i];
            if (idx < 0) return;
            var cur = evoFirstFiscalByOrg[k];
            if (cur == null || idx < FISCAL_LABELS.indexOf(cur)) evoFirstFiscalByOrg[k] = FISCAL_LABELS[idx];
        });
        // first fiscal per location (based on org first appearance)
        evoLocationFirstFiscal = {};
        Object.keys(evoFirstFiscalByOrg).forEach(function(orgId){
            var loc = locByOrg[orgId] || orgId;
            var fy = evoFirstFiscalByOrg[orgId];
            var cur = evoLocationFirstFiscal[loc];
            if (cur == null || FISCAL_LABELS.indexOf(fy) < FISCAL_LABELS.indexOf(cur)) evoLocationFirstFiscal[loc] = fy;
        });
        // first fiscal per clean subcategory (distinct)
        evoSubcatFirstFiscal = {};
        grants.forEach(function(g,i){
            var sc = (g.subcategory||'').trim();
            if (!sc || sc.toLowerCase() === 'unclassified') {
                // use enterprise_commodity as fallback only if subcategory is Unclassified? per spec use clean subcategory, so skip Unclassified for novelty
                return;
            }
            var fy = evoFiscalByGrant[i];
            if (!fy) return;
            var cur = evoSubcatFirstFiscal[sc];
            if (cur == null || FISCAL_LABELS.indexOf(fy) < FISCAL_LABELS.indexOf(cur)) evoSubcatFirstFiscal[sc] = fy;
        });
        // aggregate per year: counts of first appearances
        evoPerYear = FISCAL_LABELS.map(function(lbl){ return {label:lbl, newGrantees:0, newLocations:0, newEnterprises:0}; });
        Object.keys(evoFirstFiscalByOrg).forEach(function(orgId){
            var lbl = evoFirstFiscalByOrg[orgId];
            var idx = FISCAL_LABELS.indexOf(lbl);
            if (idx>=0) evoPerYear[idx].newGrantees++;
        });
        Object.keys(evoLocationFirstFiscal).forEach(function(loc){
            var lbl = evoLocationFirstFiscal[loc];
            var idx = FISCAL_LABELS.indexOf(lbl);
            if (idx>=0) evoPerYear[idx].newLocations++;
        });
        Object.keys(evoSubcatFirstFiscal).forEach(function(sc){
            var lbl = evoSubcatFirstFiscal[sc];
            var idx = FISCAL_LABELS.indexOf(lbl);
            if (idx>=0) evoPerYear[idx].newEnterprises++;
        });
        // For years with zero (e.g. 2019–20 mapping) ensure grantees at least reflect grants if any fallback
        // 2019–20 should count grants whose fy is 2019–20
        renderEvoTable();
        updateEvoChart();
    }

    function renderEvoTable(){
        var tbody = document.querySelector('#evoTable tbody');
        if (!tbody || !evoPerYear) return;
        tbody.innerHTML = '';
        FISCAL_LABELS.forEach(function(lbl, idx){
            var row = evoPerYear[idx];
            var tr = document.createElement('tr');
            var inRange = (idx >= evoFromIdx && idx <= evoToIdx);
            tr.className = inRange ? 'in-range' : 'dimmed';
            tr.innerHTML = '<td><strong>'+lbl+'</strong></td>'+
                '<td class="num">'+row.newGrantees+'</td>'+
                '<td class="num">'+row.newLocations+'</td>'+
                '<td class="num">'+row.newEnterprises+'</td>'+
                '<td class="num"></td>';
            tbody.appendChild(tr);
        });
        // summary for selected range (distinct union is already per-year first-appearance sum within range == total new in range)
        var sumG=0,sumL=0,sumE=0;
        for(var i=evoFromIdx;i<=evoToIdx;i++){ sumG+=evoPerYear[i].newGrantees; sumL+=evoPerYear[i].newLocations; sumE+=evoPerYear[i].newEnterprises; }
        var sumEl = document.getElementById('evoSummary');
        if (sumEl) {
            var rangeLabel = (evoFromIdx===evoToIdx) ? FISCAL_LABELS[evoFromIdx] : FISCAL_LABELS[evoFromIdx]+' → '+FISCAL_LABELS[evoToIdx];
            sumEl.innerHTML = 'Selected: <strong>'+rangeLabel+'</strong> — <strong>'+sumG+'</strong> new grantees · <strong>'+sumL+'</strong> new locations · <strong>'+sumE+'</strong> new enterprises/products · Grant amount: <strong></strong><br/><span style="color:#5a6d80">Map shows grantees whose first grant falls within the selected range.</span>';
        }
        // ticks highlight
        var tickEls = document.querySelectorAll('#tsTicks span');
        tickEls.forEach(function(el,i){ el.classList.toggle('active', i>=evoFromIdx && i<=evoToIdx); });
    }

    function updateEvoChart(){
        var ctx = document.getElementById('evoChart');
        if (!ctx || typeof Chart==='undefined' || !evoPerYear) return;
        var labels = FISCAL_LABELS;
        var dataG = evoPerYear.map(function(r){return r.newGrantees;});
        var bg = labels.map(function(_,i){ return (i>=evoFromIdx && i<=evoToIdx) ? '#0070b6' : '#d0dbe6'; });
        if (evoChartInstance) { evoChartInstance.destroy(); }
        evoChartInstance = new Chart(ctx, {
            type:'bar',
            data:{ labels: labels, datasets:[
                { label:'New grantees', data:dataG, backgroundColor:bg, borderColor:'#0070b6', borderWidth:1 },
                { label:'New locations', data:evoPerYear.map(function(r){return r.newLocations;}), backgroundColor:'rgba(0,0,0,0)', borderColor:'rgba(0,0,0,0)', hidden:true },
                { label:'New enterprises', data:evoPerYear.map(function(r){return r.newEnterprises}), backgroundColor:'rgba(0,0,0,0)', borderColor:'rgba(0,0,0,0)', hidden:true }
            ]},
            options:{
                responsive:true,
                plugins:{ legend:{display:false}, tooltip:{enabled:true} },
                scales:{ y:{ beginAtZero:true, ticks:{precision:0} } }
            }
        });
    }

    function applyEvolutionFilter(){
        var allowedOrgs = null;
        if (evoPerYear && evoFirstFiscalByOrg) {
            allowedOrgs = {};
            Object.keys(evoFirstFiscalByOrg).forEach(function(orgId){
                var lbl = evoFirstFiscalByOrg[orgId];
                var idx = FISCAL_LABELS.indexOf(lbl);
                if (idx>=evoFromIdx && idx<=evoToIdx) allowedOrgs[orgId]=true;
            });
        }
        // also include orgs whose any grant (not just first) falls within range? per spec "new grantees" is first-appearance,
        // but map should show all grantees active within range — we use first-appearance set per user phrase "new grantees"
        // If you want active grantees (any grant in range) uncomment below:
        // (evoFiscalByGrant expanded) — but keep first-appearance per current spec
        try {
            if (typeof clusters_Grantees !== 'undefined' && typeof layer_Grantees !== 'undefined' && layer_Grantees.eachLayer) {
                // need current commodity/type filters — read pills if present
                var bar = document.getElementById('granteeFilterBar');
                var checkedType={}, checkedComm={}, checkedEnterprise={}, checkedOrg={};
                if (bar) {
                    bar.querySelectorAll('.gf-type').forEach(function(cb){ checkedType[cb.value]=cb.checked; });
                    bar.querySelectorAll('.gf-commodity').forEach(function(cb){ checkedComm[cb.value]=cb.checked; });
                    bar.querySelectorAll('.gf-enterprise').forEach(function(cb){ checkedEnterprise[cb.value]=cb.checked; });
                    bar.querySelectorAll('.gf-orgtype').forEach(function(cb){ checkedOrg[cb.value]=cb.checked; });
                }
                    var hasTypeFilter = Object.keys(checkedType).length>0;
                var hasCommFilter = Object.keys(checkedComm).length>0;
                var hasEnterpriseFilter = Object.keys(checkedEnterprise).length>0;
                var hasOrgFilter = Object.keys(checkedOrg).length>0;
                layer_Grantees.eachLayer(function(l){
                    var p = l.feature.properties;
                    var timeOk = true;
                    var isEvoMode = document.body.classList.contains('map-mode-evolution');
                    if (isEvoMode && allowedOrgs) {
                        timeOk = !!allowedOrgs[String(p.S_N)];
                    }
                    var typeOk = !hasTypeFilter || !!checkedType[p.Type_of_Grant];
                    var commOk = !hasCommFilter || (p.subcategories && p.subcategories.length ? p.subcategories.some(function(c){return !!checkedComm[c];}) : true);
                    var enterpriseOk = !hasEnterpriseFilter || (p.enterprise_classifications && p.enterprise_classifications.length ? p.enterprise_classifications.some(function(c){return !!checkedEnterprise[c];}) : true);
                    var orgOk = !hasOrgFilter || (p.organization_type ? !!checkedOrg[p.organization_type] : true);
                    var show = timeOk && typeOk && commOk && enterpriseOk && orgOk;
                    if (show) { if (!clusters_Grantees.hasLayer(l)) clusters_Grantees.addLayer(l); }
                    else { if (clusters_Grantees.hasLayer(l)) clusters_Grantees.removeLayer(l); }
                });
            }
        } catch(e){ /* map not ready yet */ }
    }
    window._evoApplyFilter = applyEvolutionFilter;

    function updateSliderUI(){
        var track = document.getElementById('tsTrack');
        var fill = document.getElementById('tsFill');
        var tFrom = document.getElementById('tsThumbFrom');
        var tTo = document.getElementById('tsThumbTo');
        if (!track || !fill || !tFrom || !tTo) return;
        var n = FISCAL_LABELS.length;
        if (evoFromIdx > evoToIdx) { var tmp=evoFromIdx; evoFromIdx=evoToIdx; evoToIdx=tmp; }
        var fromPct = (evoFromIdx/(n-1))*100;
        var toPct = (evoToIdx/(n-1))*100;
        tFrom.style.left = fromPct+'%';
        tTo.style.left = toPct+'%';
        fill.style.left = fromPct+'%';
        fill.style.width = (toPct-fromPct)+'%';
        document.getElementById('tsTipFrom').textContent = FISCAL_LABELS[evoFromIdx];
        document.getElementById('tsTipTo').textContent = FISCAL_LABELS[evoToIdx];
        document.getElementById('tsFromLabel').textContent = FISCAL_LABELS[evoFromIdx];
        document.getElementById('tsToLabel').textContent = FISCAL_LABELS[evoToIdx];
        renderEvoTable();
        updateEvoChart();
        applyEvolutionFilter();
    }

    function initEvolutionSlider(){
        var ticksEl = document.getElementById('tsTicks');
        if (ticksEl) {
            ticksEl.innerHTML = '';
            FISCAL_LABELS.forEach(function(lbl, i){
                var s=document.createElement('span');
                s.textContent=lbl;
                s.style.cursor='pointer';
                s.addEventListener('click', function(){
                    // clicking a tick moves nearest thumb
                    var dFrom = Math.abs(i - evoFromIdx), dTo = Math.abs(i - evoToIdx);
                    if (dFrom <= dTo) evoFromIdx = i; else evoToIdx = i;
                    if (evoFromIdx > evoToIdx) { var t=evoFromIdx; evoFromIdx=evoToIdx; evoToIdx=t; }
                    updateSliderUI();
                });
                ticksEl.appendChild(s);
            });
        }
        var track = document.getElementById('tsTrack');
        var dragging = null; // 'from' or 'to'
        function idxFromX(clientX){
            var rect = track.getBoundingClientRect();
            var x = clientX - rect.left;
            var pct = x / rect.width;
            pct = Math.max(0, Math.min(1, pct));
            var n = FISCAL_LABELS.length;
            var idx = Math.round(pct*(n-1));
            return Math.max(0, Math.min(n-1, idx));
        }
        function onDown(e, which){
            dragging = which;
            e.preventDefault();
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onTouchMove, {passive:false});
            document.addEventListener('touchend', onUp);
        }
        function onMove(e){
            if (!dragging) return;
            var idx = idxFromX(e.clientX);
            if (dragging==='from') evoFromIdx = idx; else evoToIdx = idx;
            if (evoFromIdx > evoToIdx) {
                // prevent crossing: clamp
                if (dragging==='from') evoFromIdx = evoToIdx;
                else evoToIdx = evoFromIdx;
            }
            updateSliderUI();
        }
        function onTouchMove(e){
            if (!dragging || !e.touches[0]) return;
            e.preventDefault();
            var idx = idxFromX(e.touches[0].clientX);
            if (dragging==='from') evoFromIdx = idx; else evoToIdx = idx;
            if (evoFromIdx > evoToIdx) {
                if (dragging==='from') evoFromIdx = evoToIdx;
                else evoToIdx = evoFromIdx;
            }
            updateSliderUI();
        }
        function onUp(){
            dragging=null;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onUp);
        }
        var tFrom = document.getElementById('tsThumbFrom');
        var tTo = document.getElementById('tsThumbTo');
        if (tFrom) {
            tFrom.addEventListener('mousedown', function(e){ onDown(e,'from'); });
            tFrom.addEventListener('touchstart', function(e){ onDown(e.touches[0] ? {clientX:e.touches[0].clientX, preventDefault:function(){e.preventDefault();}} : e,'from'); }, {passive:false});
        }
        if (tTo) {
            tTo.addEventListener('mousedown', function(e){ onDown(e,'to'); });
            tTo.addEventListener('touchstart', function(e){ onDown(e.touches[0] ? {clientX:e.touches[0].clientX, preventDefault:function(){e.preventDefault();}} : e,'to'); }, {passive:false});
        }
        if (track) {
            track.addEventListener('click', function(e){
                if (e.target.closest('.ts-thumb')) return;
                var idx = idxFromX(e.clientX);
                var dFrom = Math.abs(idx - evoFromIdx), dTo = Math.abs(idx - evoToIdx);
                if (dFrom <= dTo) evoFromIdx = idx; else evoToIdx = idx;
                if (evoFromIdx > evoToIdx) { var t=evoFromIdx; evoFromIdx=evoToIdx; evoToIdx=t; }
                updateSliderUI();
            });
        }
        var playBtn = document.getElementById('tsPlayBtn');
        var resetBtn = document.getElementById('tsResetBtn');
        if (playBtn) playBtn.addEventListener('click', function(){
            if (evoPlayTimer) {
                clearInterval(evoPlayTimer); evoPlayTimer=null;
                playBtn.textContent='▶ Play';
                return;
            }
            playBtn.textContent='⏸ Pause';
            var cur = evoFromIdx;
            evoFromIdx = 0; evoToIdx = cur;
            updateSliderUI();
            evoPlayTimer = setInterval(function(){
                if (evoToIdx >= FISCAL_LABELS.length-1) {
                    clearInterval(evoPlayTimer); evoPlayTimer=null;
                    playBtn.textContent='▶ Play';
                    return;
                }
                evoToIdx++;
                updateSliderUI();
            }, 1100);
        });
        if (resetBtn) resetBtn.addEventListener('click', function(){
            if (evoPlayTimer){ clearInterval(evoPlayTimer); evoPlayTimer=null; var pb=document.getElementById('tsPlayBtn'); if(pb) pb.textContent='▶ Play'; }
            evoFromIdx=0; evoToIdx=6;
            updateSliderUI();
        });
        // keyboard nudging
        [tFrom,tTo].forEach(function(el, isFrom){
            if(!el) return;
            el.addEventListener('keydown', function(e){
                var delta=0;
                if(e.key==='ArrowLeft' || e.key==='ArrowDown') delta=-1;
                if(e.key==='ArrowRight' || e.key==='ArrowUp') delta=1;
                if(delta===0) return;
                e.preventDefault();
                if(el===tFrom){ evoFromIdx=Math.max(0,Math.min(6,evoFromIdx+delta)); if(evoFromIdx>evoToIdx) evoFromIdx=evoToIdx; }
                else { evoToIdx=Math.max(0,Math.min(6,evoToIdx+delta)); if(evoToIdx<evoFromIdx) evoToIdx=evoFromIdx; }
                updateSliderUI();
            });
        });
        updateSliderUI();
    }
    // init slider early (ticks) once DOM ready
    setTimeout(initEvolutionSlider, 400);

    // ---- Hover popup: mirrors the #aggregate (info) content as a floating
    //      box when hovering a grantee point or cluster, then removes it on
    //      mouseout. Created once, reused. Pure DOM, no Leaflet popup needed.
    var hoverPopup = document.createElement('div');
    hoverPopup.className = 'info-hover-popup';
    hoverPopup.style.display = 'none';
    document.body.appendChild(hoverPopup);
    var popupHovered = false;
    var popupHideTimer = null;
    hoverPopup.addEventListener('mouseenter', function() { popupHovered = true; clearTimeout(popupHideTimer); });
    hoverPopup.addEventListener('mouseleave', function() { popupHovered = false; hideHoverPopup(); });

    function showHoverPopup(html, latlng) {
        hoverPopup.innerHTML = html;
        hoverPopup.style.display = 'block';
        // Position the floating box next to the hovered point/cluster (viewport
        // coords) and flip to the other side near the right/bottom edges.
        var mapEl = map.getContainer();
        var rect = mapEl.getBoundingClientRect();
        var pw = hoverPopup.offsetWidth, ph = hoverPopup.offsetHeight;
        var left, top;
        if (latlng && map.latLngToContainerPoint) {
            var pt = map.latLngToContainerPoint(latlng);
            left = rect.left + pt.x + 18;
            top = rect.top + pt.y - 12;
            if (left + pw > window.innerWidth - 8) { left = rect.left + pt.x - pw - 18; }
            if (top + ph > window.innerHeight - 8) { top = window.innerHeight - ph - 8; }
            if (left < 8) { left = 8; }
            if (top < 8) { top = 8; }
        } else {
            left = rect.left + mapEl.clientWidth - pw - 20;
            top = rect.top + 90;
        }
        hoverPopup.style.left = left + 'px';
        hoverPopup.style.top = top + 'px';
    }
    function hideHoverPopup() {
        if (popupHovered) return;   // keep open while the pointer is inside the popup
        // Grace period: mouseout on the marker/cluster fires before mouseenter on the
        // popup, so hide on a delay and let the pointer travel into the box.
        clearTimeout(popupHideTimer);
        popupHideTimer = setTimeout(function() {
            if (popupHovered) return;
            hoverPopup.style.display = 'none';
            hoverPopup.innerHTML = '';
        }, 250);
    }

    function highlightFeature(e) {
        highlightLayer = e.target;

        b = L.DomUtil.get('aggregate');
        b.innerHTML = bio_table_generator(highlightLayer.feature);
        // debugger;

        // if (e.target.feature.geometry.type === 'LineString') {
        //     highlightLayer.setStyle({
        //         color: '#ffff00',
        //     });
        // } else {
        //     highlightLayer.setStyle({
        //         fillColor: '#ffff00',
        //         fillOpacity: 1
        //     });
        // }
    }

    var map = L.map('map', {
            zoomControl: true,
            maxZoom: 28,
            minZoom: 1,
            center: [27.7, 83.0],   // Nepal grantee centroid
            zoom: 7
        })
        // var hash = new L.Hash(map);
    map.attributionControl.setPrefix('<a href="http://leafletjs.com " title="A JS library for interactive maps ">Leaflet</a>');
    var bounds_group = new L.featureGroup([]);

    function setBounds() {
        if (bounds_group.getLayers().length) {
            // keep the fitted content clear of the floating legend + collapsed right
            // panel on the east edge (legend is 190px wide + gaps ≈ 200px)
            map.fitBounds(bounds_group.getBounds(), { paddingBottomRight: [200, 0] });
        }
    }
    var layer_OSMStandard_0 = L.tileLayer('http://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        opacity: 1.0,
        attribution: '<a href="https://www.openstreetmap.org/copyright ">© OpenStreetMap contributors, CC-BY-SA</a>',
    });
    layer_OSMStandard_0;
    // map.addLayer(layer_OSMStandard_0);

    // Esri World Imagery (satellite) - no API key required
    var layer_EsriImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    });
    // Satellite imagery stays available in the layer switcher but is NOT added on startup

    var empty_baseLayer = L.gridLayer({});   // draws nothing and requests nothing (L.tileLayer('') still fired tile requests)
    empty_baseLayer.addTo(map);   // start on the plain canvas (light green #map background)

    // Satellite comes on by itself past z12 (street level), and switches back to the plain canvas on zoom out.
    // Only reacts to zoom changes, so picking a basemap by hand in the switcher still works.
    map.on('zoomend', function() {
        if (map.getZoom() > 12) {
            if (!map.hasLayer(layer_EsriImagery)) { map.removeLayer(empty_baseLayer); map.addLayer(layer_EsriImagery); }
        } else if (map.hasLayer(layer_EsriImagery)) {
            map.removeLayer(layer_EsriImagery);
            map.addLayer(empty_baseLayer);
        }
    });

    function pop_Grantees(feature, layer) {
        layer.on({
            mouseout: function(e) {
                // info.update();
                hideHoverPopup();
                for (var i in e.target._eventParents) {
                    var p = e.target._eventParents[i];
                    // markers are not vector layers: only groups that style layers have resetStyle
                    if (p && typeof p.resetStyle === 'function') { p.resetStyle(e.target); }
                }
            },
            mouseover: function(e) {
                highlightFeature(e);
                showHoverPopup(bio_table_generator(e.target.feature), e.target.getLatLng());
            },
        });
    }

    map.createPane('pane_Grantees');
    map.getPane('pane_Grantees').style.zIndex = 650;
    // Load grantee organizations asynchronously via the Leaflet-ajax plugin
    // (L.geoJson.ajax) instead of an embedded JS blob. The geometry is fetched
    // from data/Grantees.geojson on demand, so the points layer is built once
    // the data:loaded event fires (see below).
    var layer_Grantees = new L.geoJson.ajax('data/Grantees.geojson', {
        attribution: '',
        pane: 'pane_Grantees',
        onEachFeature: pop_Grantees,
        pointToLayer: function(feature, latlng) {
            var marker = L.marker(latlng, style_Grantees_div_icon(feature));
            marker.bindTooltip((feature.properties.Name_of_Organization || ('S.N. ' + (feature.properties.S_N != null ? feature.properties.S_N : ''))), {
                direction: 'top',
                className: 'org-tip-name',
                offset: [0, -12],
                permanent: true,        // name always visible, no hover needed
                interactive: false       // let pointer pass through to the marker
            });
            return marker;
        },
    });
    // Cluster the grantee points; orange clusters to distinguish from blue individual pins
    var clusters_Grantees = L.markerClusterGroup({
        showCoverageOnHover: true,   // needed so clustermouseover fires; polygon itself is suppressed below
        spiderfyOnMaxZoom: true,
        maxClusterRadius: 50,
        iconCreateFunction: function(cluster) {
            var n = cluster.getChildCount();
            return L.divIcon({
                html: '<div class="grantee-cluster" style="width:40px;height:40px;">' + n + '</div>',
                className: 'grantee-cluster-wrap',
                iconSize: [40, 40]
            });
        }
    });

    // Everything that depends on the (now async) grantee features must wait until
    // the geojson finishes loading.
    // organization_type is NOT on the geojson features; it lives in
    // data/grantees_attributes.json (org_id == S_N). Fetch it once up front so the
    // filter pills can be built after both sources are ready.
    var attributesPromise = fetch('data/grantees_attributes.json').then(function(r) { return r.json(); });
    layer_Grantees.on('data:loaded', function() {
        clusters_Grantees.addLayer(layer_Grantees);
        clusters_Grantees.addTo(map);   // Organizations layer on by default
        bounds_group.addLayer(clusters_Grantees);
        setBounds();

        // Build the filter pills (Type of Grant, Commodities, Organization Type)
        // and the left-panel Grantees list only after BOTH the grantee geojson
        // and grantees_attributes.json are available. organization_type is merged
        // onto each feature from the attributes file by matching org_id == S_N
        // (compared as strings).
        attributesPromise.then(function(attr) {
            var orgTypeBySN = {};
            (attr.orgs || []).forEach(function(o) {
                if (o && o.organization_type) {
                    orgTypeBySN[String(o.org_id)] = o.organization_type;
                }
            });
            // Index the CSV-derived tables by org_id (== S_N) so each marker can
            // carry its grants (enterprise classification / subcategory), its
            // restoration records (area direct + contributed, people benefited)
            // and its women-led enterprise records. These come from the
            // moreDataFromFFF CSVs via consolidate_grantees_attributes.py.
            var grantsByOrg = {};
            (attr.grants || []).forEach(function(g) {
                var k = String(g.org_id);
                (grantsByOrg[k] = grantsByOrg[k] || []).push(g);
            });
            var restorationByOrg = {};
            (attr.restoration || []).forEach(function(r) {
                var k = String(r.org_id);
                (restorationByOrg[k] = restorationByOrg[k] || []).push(r);
            });
            var womenByOrg = {};
            (attr.women || []).forEach(function(w) {
                var k = String(w.org_id);
                (womenByOrg[k] = womenByOrg[k] || []).push(w);
            });
            layer_Grantees.eachLayer(function(l) {
                var p = l.feature.properties;
                var sn = String(p.S_N);
                p.organization_type = orgTypeBySN[sn] || null;
                p.grants = grantsByOrg[sn] || [];
                p.restoration = restorationByOrg[sn] || [];
                p.women = womenByOrg[sn] || [];
                // Unique subcategories + enterprise classifications across this
                // org's grants (a marker can match several filter values).
                var subs = {}, cls = {};
                p.grants.forEach(function(g) {
                    if (g.subcategory) { subs[g.subcategory] = true; }
                    if (g.enterprise_classification) { cls[g.enterprise_classification] = true; }
                });
                p.subcategories = Object.keys(subs);
                if (p.subcategories.length === 0) p.subcategories = ['Unclassified'];
                p.enterprise_classifications = Object.keys(cls);
                // Aggregate people benefited + restoration area for the overview.
                var people = 0, areaDirect = 0, areaContrib = 0;
                p.restoration.forEach(function(r) {
                    people += (r.people_benefited || 0);
                    areaDirect += (r.area_direct_ha || 0);
                    areaContrib += (r.area_contributed_ha || 0);
                });
                p.people_benefited = people || null;
                p.area_direct_ha = areaDirect || null;
                p.area_contributed_ha = areaContrib || null;
            });
            // Build evolution time-series data (Eight Years) now that grants/orgs are available
            try { buildEvoData(attr); updateSliderUI(); } catch(e) { console.warn('evo build failed', e); }
            // Build the Type-of-Grant / Commodities / Organization Type filter
            // pills now that features exist and have organization_type merged.
            buildGranteeFilters();
            // Build the left-panel Grantees list (DataTable) now that features exist.
            buildGranteeTable();
            // Refresh commodity icons (literal crop drawings, stacked mini-icons) now that subcategories known
            try { if (typeof refreshCommodityIcons === 'function') refreshCommodityIcons(layer_Grantees); } catch(e){ console.warn('refresh icons failed', e); }
            // Build floating commodity legend (overlay on map)
            try { buildCommodityLegend(); } catch(e){ console.warn('legend build failed', e); }
        });

        // Suppress the default hover coverage polygon so only the bottom-panel list shows.
        clusters_Grantees._showCoverage = function() {};
        clusters_Grantees._hideCoverage = function() {};
        // Cluster hover + bottom panel: one bio_table_generator card per member org,
        // i.e. the same card style as individual-marker hover.
        function clusterOrgCardsHTML(cluster) {
            var kids = cluster.getAllChildMarkers();
            var n = kids.length;
            var rows = kids.map(function(m) {
                return bio_details_generator(m.feature);
            }).join('');
            return '<div class="row"><div class="col-12">' +
                '<p class="text-muted mb-1">Cluster — ' + escapeHtml(n) + ' organization' + (n === 1 ? '' : 's') + '</p>' +
                rows +
                '</div></div>';
        }
        // A real mouse hover over a cluster icon emits 'clustermouseover'/'clustermouseout'.
        // Cluster hover shows the member org cards (same style as individual-marker hover).
        clusters_Grantees.on('clustermouseover', function(e) {
            var html = clusterOrgCardsHTML(e.layer);
            var b = L.DomUtil.get('aggregate');
            b.innerHTML = html;
            showHoverPopup(html, e.layer.getBounds().getCenter());
        });
        clusters_Grantees.on('clustermouseout', function(e) {
            hideHoverPopup();
        });
    });

    var baseLayers = {
        "Satellite (Esri)": layer_EsriImagery,
        "OpenStreetMap ": layer_OSMStandard_0,
        "No background ": empty_baseLayer
    };

    var overlays = {
        "Organizations": clusters_Grantees
    };
    var layerControl = L.control.layers(baseLayers, overlays, {
        // collapsed: false
    }).addTo(map);

    // Filter organizations by Type_of_Grant / Commodities / Organization Type -
    // top horizontal bar (not a map control). Built only after both the async
    // grantee geojson AND grantees_attributes.json have loaded (see the
    // attributesPromise chain in the layer_Grantees 'data:loaded' handler).
    // The three groups AND-combine: a marker is shown only when its value is
    // checked in EVERY group. A marker whose value for a group is empty/absent
    // (e.g. a grantee with no organization_type) is not constrained by that group.
    function buildGranteeFilters() {
        var bar = document.getElementById('granteeFilterBar');
        if (!bar) { return; }
        var typeCounts = {};
        var commCounts = {};
        var orgCounts = {};
        var enterpriseCounts = {};
        function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
        layer_Grantees.eachLayer(function(l) {
            var p = l.feature.properties;
            var t = p.Type_of_Grant;
            typeCounts[t] = (typeCounts[t] || 0) + 1;
            (p.subcategories || []).forEach(function(c) {
                if (c) { commCounts[c] = (commCounts[c] || 0) + 1; }
            });
            var o = p.organization_type;
            if (o) { orgCounts[o] = (orgCounts[o] || 0) + 1; }
            (p.enterprise_classifications || []).forEach(function(c) {
                if (c) { enterpriseCounts[c] = (enterpriseCounts[c] || 0) + 1; }
            });
        });
        // Build filter groups via DOM to keep raw values (no HTML-entity round-trip) and escape only visible labels
        function createFilterLabel(className, value, labelText, count, withIcon) {
            var label = document.createElement('label');
            label.className = 'gf-value checked';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = className;
            cb.value = value;
            cb.checked = true;
            label.appendChild(cb);
            var box = document.createElement('span');
            box.className = 'gf-box';
            box.innerHTML = '&#10003;';
            label.appendChild(box);
            if (withIcon) {
                var meta = (typeof getCommodityMeta === 'function') ? getCommodityMeta(value) : {icon: (typeof COMMODITY_ICON !== 'undefined' && COMMODITY_ICON[value])||'❓', color: (typeof COMMODITY_COLOR !== 'undefined' && COMMODITY_COLOR[value])||'#95a5a6'};
                var pin = document.createElement('span');
                pin.className = 'mini-pin';
                pin.style.background = meta.color;
                pin.style.borderColor = meta.color;
                pin.style.width = '18px';
                pin.style.height = '18px';
                pin.style.fontSize = '10px';
                pin.textContent = meta.icon;
                label.appendChild(pin);
            }
            var txt = document.createElement('span');
            txt.textContent = labelText + ' (' + count + ')';
            label.appendChild(txt);
            return label;
        }
        var groupType = document.createElement('div');
        groupType.className = 'gf-group';
        var titleType = document.createElement('span');
        titleType.className = 'gf-title';
        titleType.textContent = 'Type of Grant';
        groupType.appendChild(titleType);
        Object.keys(typeCounts).sort().forEach(function(t) {
            groupType.appendChild(createFilterLabel('gf-type', t, t, typeCounts[t], false));
        });
        bar.appendChild(groupType);
        var groupComm = document.createElement('div');
        groupComm.className = 'gf-group';
        groupComm.style.flexDirection = 'column';
        groupComm.style.alignItems = 'flex-start';
        var commHeader = document.createElement('div');
        commHeader.style.display = 'flex';
        commHeader.style.alignItems = 'center';
        commHeader.style.gap = '8px';
        commHeader.style.flexWrap = 'wrap';
        commHeader.style.width = '100%';
        var titleComm = document.createElement('span');
        titleComm.className = 'gf-title';
        titleComm.textContent = 'Commodities';
        commHeader.appendChild(titleComm);
        var btnAll = document.createElement('button');
        btnAll.type = 'button';
        btnAll.className = 'gf-dd-btn';
        btnAll.id = 'commSelectAll';
        btnAll.textContent = 'Select all';
        commHeader.appendChild(btnAll);
        var btnClear = document.createElement('button');
        btnClear.type = 'button';
        btnClear.className = 'gf-dd-btn';
        btnClear.id = 'commClear';
        btnClear.textContent = 'Clear';
        commHeader.appendChild(btnClear);
        groupComm.appendChild(commHeader);
        var listComm = document.createElement('div');
        listComm.className = 'gf-commodities-list';
        listComm.style.display = 'flex';
        listComm.style.flexWrap = 'wrap';
        listComm.style.gap = '6px';
        listComm.style.width = '100%';
        listComm.style.marginTop = '4px';
        Object.keys(commCounts).sort().forEach(function(c) {
            listComm.appendChild(createFilterLabel('gf-commodity', c, c, commCounts[c], true));
        });
        groupComm.appendChild(listComm);
        bar.appendChild(groupComm);
        var groupEnt = document.createElement('div');
        groupEnt.className = 'gf-group';
        var titleEnt = document.createElement('span');
        titleEnt.className = 'gf-title';
        titleEnt.textContent = 'Enterprise Class';
        groupEnt.appendChild(titleEnt);
        Object.keys(enterpriseCounts).sort().forEach(function(c) {
            groupEnt.appendChild(createFilterLabel('gf-enterprise', c, c, enterpriseCounts[c], false));
        });
        bar.appendChild(groupEnt);
        var groupOrg = document.createElement('div');
        groupOrg.className = 'gf-group';
        var titleOrg = document.createElement('span');
        titleOrg.className = 'gf-title';
        titleOrg.textContent = 'Organization Type';
        groupOrg.appendChild(titleOrg);
        Object.keys(orgCounts).sort().forEach(function(o) {
            groupOrg.appendChild(createFilterLabel('gf-orgtype', o, o, orgCounts[o], false));
        });
        bar.appendChild(groupOrg);
        // Shared apply(): reads all four groups and AND-combines them.
        var apply = function() {
            var checkedType = {};
            bar.querySelectorAll('.gf-type').forEach(function(cb) {
                checkedType[cb.value] = cb.checked;
            });
            var checkedComm = {};
            bar.querySelectorAll('.gf-commodity').forEach(function(cb) {
                checkedComm[cb.value] = cb.checked;
            });
            var checkedEnterprise = {};
            bar.querySelectorAll('.gf-enterprise').forEach(function(cb) {
                checkedEnterprise[cb.value] = cb.checked;
            });
            var checkedOrg = {};
            bar.querySelectorAll('.gf-orgtype').forEach(function(cb) {
                checkedOrg[cb.value] = cb.checked;
            });
            layer_Grantees.eachLayer(function(l) {
                var p = l.feature.properties;
                var show = !!checkedType[p.Type_of_Grant] &&
                           (p.subcategories && p.subcategories.length ? p.subcategories.some(function(c) { return !!checkedComm[c]; }) : true) &&
                           (p.enterprise_classifications && p.enterprise_classifications.length ? p.enterprise_classifications.some(function(c) { return !!checkedEnterprise[c]; }) : true) &&
                           (p.organization_type ? !!checkedOrg[p.organization_type] : true);
                if (show) {
                    if (!clusters_Grantees.hasLayer(l)) { clusters_Grantees.addLayer(l); }
                } else {
                    clusters_Grantees.removeLayer(l);
                }
            });
            // sync floating legend checked state
            var legendEl = document.getElementById('commodityLegend');
            if (legendEl) {
                legendEl.querySelectorAll('.commodity-legend-item').forEach(function(item){
                    var v = item.getAttribute('data-value');
                    var esc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(v) : v.replace(/"/g, '\\"');
                    var bc = bar.querySelector('.gf-commodity[value="' + esc + '"]');
                    var checked = bc ? bc.checked : true;
                    item.classList.toggle('checked', checked);
                    var lc = item.querySelector('.gf-legend-commodity');
                    if (lc) lc.checked = checked;
                });
            }
        };
        window._granteeFilterApply = apply;
        bar.querySelectorAll('.gf-type, .gf-commodity, .gf-enterprise, .gf-orgtype').forEach(function(cb) {
            var lbl = cb.closest('label.gf-value');
            lbl.addEventListener('click', function(e) {
                e.preventDefault();
                cb.checked = !cb.checked;
                lbl.classList.toggle('checked', cb.checked);
                if (typeof applyEvolutionFilter === 'function') applyEvolutionFilter(); else apply();
            });
        });
        function setAllCommodities(checked) {
            bar.querySelectorAll('.gf-commodity').forEach(function(cb) {
                cb.checked = checked;
                cb.closest('label.gf-value').classList.toggle('checked', checked);
            });
            if (typeof applyEvolutionFilter === 'function') applyEvolutionFilter(); else apply();
        }
        document.getElementById('commSelectAll').addEventListener('click', function(e) {
            e.preventDefault();
            setAllCommodities(true);
        });
        document.getElementById('commClear').addEventListener('click', function(e) {
            e.preventDefault();
            setAllCommodities(false);
        });
    }
    function buildCommodityLegend() {
        var legend = document.getElementById('commodityLegend');
        var bar = document.getElementById('granteeFilterBar');
        if (!legend || typeof COMMODITY_ICON === 'undefined') return;
        var counts = {};
        layer_Grantees.eachLayer(function(l){
            (l.feature.properties.subcategories||[]).forEach(function(c){ if(c) counts[c]=(counts[c]||0)+1; });
        });
        var keys = Object.keys(counts).sort(function(a,b){
            if(a==='Unclassified') return 1; if(b==='Unclassified') return -1;
            return counts[b]-counts[a];
        });
        function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
        var html = '<div class="legend-header" onclick="toggleLegendPanel()"><span>Legend</span><span id="legendToggleArrow">▾</span></div><div class="legend-content" id="legendContent"><div class="legend-section" id="legendCommoditiesSection"><div class="legend-section-header" onclick="toggleCommoditiesSection()"><span>Commodities</span><span id="commoditiesToggleArrow">▾</span></div><div class="legend-section-content" id="legendCommoditiesContent">';
        keys.forEach(function(k){
            var meta = (typeof getCommodityMeta==='function') ? getCommodityMeta(k) : {icon: COMMODITY_ICON[k]||'❓', color: COMMODITY_COLOR[k]||'#95a5a6', label:k};
            var esc = escHtml(k);
            html += '<label class="commodity-legend-item checked" data-value="'+esc+'" title="Filter by '+esc+'"><input type="checkbox" class="gf-legend-commodity" value="'+esc+'" checked style="display:none"><span class="mini-pin" style="background:'+meta.color+';border-color:'+meta.color+'">'+meta.icon+'</span><span>'+esc+' ('+counts[k]+')</span><span class="gf-box" style="margin-left:4px;width:12px;height:12px;font-size:10px;display:inline-flex;align-items:center;justify-content:center;border:1px solid currentColor;border-radius:2px">✓</span></label>';
        });
        html += '</div></div></div>';
        legend.innerHTML = html;
        // Legend → filter bar sync: clicking legend toggles commodities filter (uses same icons/colors, direct apply)
        legend.querySelectorAll('.commodity-legend-item').forEach(function(item){
            item.addEventListener('click', function(e){
                e.preventDefault();
                var val = item.getAttribute('data-value');
                var esc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(val) : val.replace(/"/g, '\\"');
                var legendCb = item.querySelector('.gf-legend-commodity');
                var newChecked = !(legendCb ? legendCb.checked : true);
                if (legendCb) legendCb.checked = newChecked;
                item.classList.toggle('checked', newChecked);
                var barCb = bar ? bar.querySelector('.gf-commodity[value="' + esc + '"]') : null;
                if (barCb) {
                    barCb.checked = newChecked;
                    var lbl = barCb.closest('label.gf-value');
                    if (lbl) lbl.classList.toggle('checked', newChecked);
                }
                if (typeof window._evoApplyFilter === 'function') window._evoApplyFilter();
                else if (typeof window._granteeFilterApply === 'function') window._granteeFilterApply();
            });
        });
        // legend ↔ filter sync now handled directly in apply() and legend click handler
    }
    window.toggleLegendPanel = function() {
        var legend = document.getElementById('commodityLegend');
        if (!legend) return;
        legend.classList.toggle('collapsed');
        var arrow = document.getElementById('legendToggleArrow');
        if (arrow) arrow.textContent = legend.classList.contains('collapsed') ? '▸' : '▾';
    };
    window.toggleCommoditiesSection = function() {
        var sec = document.getElementById('legendCommoditiesSection');
        if (!sec) return;
        sec.classList.toggle('collapsed');
        var arrow = document.getElementById('commoditiesToggleArrow');
        if (arrow) arrow.textContent = sec.classList.contains('collapsed') ? '▸' : '▾';
    };
    // Boundary overlays loaded from the committed .geojson files. The geometry is
    // fetched (not embedded) so the large data files are not duplicated into JS.
    // District and Province are toggleable overlays (default off); Country is always visible.
    (function() {
        ['District', 'LocalLevel', 'Province', 'Chure', 'Nepal'].forEach(function(name) {
            map.createPane('pane_' + name);
        });
        map.getPane('pane_District').style.zIndex = 410;
        map.getPane('pane_LocalLevel').style.zIndex = 415;
        map.getPane('pane_Province').style.zIndex = 420;
        map.getPane('pane_Chure').style.zIndex = 425;
        map.getPane('pane_Nepal').style.zIndex = 430;

        var specs = [{
            varName: 'json_District',
            layerVar: 'layer_District',
            url: 'data/District.geojson',
            label: 'District boundaries',
            pane: 'pane_District',
            color: '#3388ff',
            weight: 1.5,
            // project_area: 'y' (inside the Forest Fruit & Flora project area,
            // 13 feats) is HIGHLIGHTED green; 'n' (64 feats) is dimmed so the
            // project-area districts stand out on the satellite basemap.
            styleFn: function(feature) {
                var pa = (feature && feature.properties) ? feature.properties.project_area : null;
                if (pa === 'y') {
                    return { fillColor: '#27ae60', fillOpacity: 0.5, color: '#1e8449', weight: 2, opacity: 1 };
                }
                return { fillColor: '#3388ff', fillOpacity: 0.04, color: '#3388ff', weight: 0.8, opacity: 0.35 };
            }
        }, {
            varName: 'json_LocalLevel',
            layerVar: 'layer_LocalLevel',
            url: 'data/projectLocalLevels.geojson',
            label: 'Local Level boundaries',
            pane: 'pane_LocalLevel',
            color: '#ffd400',
            weight: 3,
            dashArray: '7 4',
            fillOpacity: 0.06,
            fill: true
        }, {
            varName: 'json_Province',
            layerVar: 'layer_Province',
            url: 'data/Province.geojson',
            label: 'Province boundaries',
            pane: 'pane_Province',
            color: '#e67e22',
            weight: 2
        }, {
            varName: 'json_Chure',
            layerVar: 'layer_Chure',
            url: 'data/chureDissolved.geojson',
            label: 'Chure boundaries',
            pane: 'pane_Chure',
            color: '#27ae60',
            weight: 1.5,
            fillOpacity: 0.12,
            fill: true
        }, {
            varName: 'json_Nepal',
            layerVar: 'layer_Nepal',
            url: 'data/Nepal.geojson',
            label: 'Country boundary (Nepal)',
            pane: 'pane_Nepal',
            color: '#ffffff',
            weight: 3
        }];

        // Clicking a boundary writes a short overview into the Aggregate panel
        // (#aggOverview), leaving the placeholder charts below it untouched.
        function showOverview(title, msg) {
            var el = document.getElementById('aggOverview');
            if (!el) { return; }
            el.innerHTML = '<p class="mb-0"><strong>' + title + '</strong><br />' +
                '<span class="text-muted">' + msg + '</span></p>';
            var card = el.closest('.card');
            if (card) { card.style.display = ''; }
        }

        Promise.all(specs.map(function(spec) {
            return fetch(spec.url)
                .then(function(res) { return res.json(); })
                .then(function(geojson) {
                    window[spec.varName] = geojson;
                    var layer = L.geoJson(geojson, {
                        pane: spec.pane,
                        style: function(feature) {
                            var base = {
                                fillOpacity: (feature && feature.properties && feature.properties.project_area) ? 0.12 : (spec.fillOpacity || 0),
                                color: spec.color,
                                weight: spec.weight,
                                dashArray: spec.dashArray
                            };
                            if (spec.styleFn) { return spec.styleFn(feature, base); }
                            return base;
                        },
                        onEachFeature: function(feature, lyr) {
                            lyr.on('click', function() {
                                var n = (geojson && geojson.features) ? geojson.features.length : null;
                                var msg;
                                if (spec.layerVar === 'layer_District') {
                                    var y = 0, nn = 0;
                                    (geojson.features || []).forEach(function(f) {
                                        var pa = f.properties && f.properties.project_area;
                                        if (pa === 'y') { y++; } else { nn++; }
                                    });
                                    msg = n + ' districts. ' + y + ' lie inside a Forest Fruit & Flora project area (highlighted green); ' + nn + ' are dimmed.';
                                } else if (spec.layerVar === 'layer_LocalLevel') {
                                    msg = n + ' local levels (Gaunpalika / Municipality) inside the project area.';
                                } else if (spec.layerVar === 'layer_Province') {
                                    msg = n + ' provinces, drawn out. The per-province grantee breakdown hasn’t been loaded, but the outlines are here.';
                                } else if (spec.layerVar === 'layer_Chure') {
                                    msg = 'The Chure (Terai arc) physiographic belt, dissolved into a single boundary.';
                                } else {
                                    msg = 'The national boundary. Once the dataset lands, this panel will show country-level totals instead of this placeholder.';
                                }
                                showOverview(spec.label, msg);
                            });
                        }
                    });
                    window[spec.layerVar] = layer;
                    layerControl.addOverlay(layer, spec.label);
                    if (spec.layerVar === 'layer_Nepal' || spec.layerVar === 'layer_Chure' ||
                            spec.layerVar === 'layer_District' || spec.layerVar === 'layer_Province') {
                            layer.addTo(map);
                        }
                });
        })).then(function() {
            // Build the boundary toggle pills in the top filter bar now that the
            // feature counts are known. Country was added to the map above;
            // District/Province default OFF and are toggled via these pills.
            var bar = document.getElementById('granteeFilterBar');
            if (bar) {
                var district = window.json_District ? window.json_District.features.length : 0;
                var localLevel = window.json_LocalLevel ? window.json_LocalLevel.features.length : 0;
                var province = window.json_Province ? window.json_Province.features.length : 0;
                var chure = window.json_Chure ? window.json_Chure.features.length : 0;
                bar.insertAdjacentHTML('beforeend',
                    '<div class="gf-group gf-group-sep">' +
                        '<span class="gf-title">Boundaries</span>' +
                        '<label class="gf-value checked"><input type="checkbox" class="gf-boundary" data-layer="layer_District" checked>' +
                        '<span class="gf-box">&#10003;</span><span>District boundaries (' + district + ')</span></label>' +
                        '<label class="gf-value"><input type="checkbox" class="gf-boundary" data-layer="layer_LocalLevel">' +
                        '<span class="gf-box">&#10003;</span><span>Local Level boundaries (' + localLevel + ')</span></label>' +
                        '<label class="gf-value checked"><input type="checkbox" class="gf-boundary" data-layer="layer_Province" checked>' +
                        '<span class="gf-box">&#10003;</span><span>Province boundaries (' + province + ')</span></label>' +
                        '<label class="gf-value checked"><input type="checkbox" class="gf-boundary" data-layer="layer_Chure" checked>' +
                        '<span class="gf-box">&#10003;</span><span>Chure boundaries (' + chure + ')</span></label>' +
                    '</div>'
                );
                bar.querySelectorAll('.gf-boundary').forEach(function(cb) {
                    var lbl = cb.closest('label.gf-value');
                    lbl.addEventListener('click', function(e) {
                        e.preventDefault();
                        cb.checked = !cb.checked;
                        lbl.classList.toggle('checked', cb.checked);
                        var layer = window[cb.dataset.layer];
                        if (!layer) { return; }
                        if (cb.checked) {
                            if (!map.hasLayer(layer)) { layer.addTo(map); }
                        } else {
                            if (map.hasLayer(layer)) { map.removeLayer(layer); }
                        }
                    });
                });
            }
        });
    })();

    // Aggregate panel: empty placeholder charts (no real data yet).
    // Chart.js, d3 and d3.sankey are loaded from js/vendor/* in <head>.
    (function() {
        var hasChart = (typeof Chart !== 'undefined');
        var ctxPie = document.getElementById('chartPie');
        if (ctxPie && hasChart) {
            window.chartPie = new Chart(ctxPie, {
                type: 'pie',
                data: { labels: [], datasets: [{ data: [] }] }
            });
        }
        var ctxBar = document.getElementById('chartBar');
        if (ctxBar && hasChart) {
            window.chartBar = new Chart(ctxBar, {
                type: 'bar',
                data: { labels: [], datasets: [{ label: 'Commodities', data: [] }] }
            });
        }
        var svgEl = document.getElementById('chartSankey');
        if (svgEl && typeof d3 !== 'undefined' && typeof d3.sankey === 'function') {
            var sw = (svgEl.parentElement && svgEl.parentElement.clientWidth) || 400;
            var sh = 200;
            var margin = { top: 8, right: 8, bottom: 8, left: 8 };
            // Sankey generator set up with margins; empty until real data arrives.
            var sankey = d3.sankey()
                .nodeWidth(15)
                .nodePadding(10)
                .extent([[margin.left, margin.top], [sw - margin.right, sh - margin.bottom]]);
            var svg = d3.select(svgEl)
                .attr('width', sw)
                .attr('height', sh);
            svg.append('text')
                .attr('x', sw / 2)
                .attr('y', sh / 2)
                .attr('text-anchor', 'middle')
                .attr('fill', '#999')
                .style('font', '13px Arial, Helvetica, sans-serif')
                .text('No grant flow data yet');
        }
    })();

    // Investment by enterprise — data generated by ../../../summarise_investment.py
    (function() {
        var el = document.getElementById('chartInvestment');
        if (!el || typeof Chart === 'undefined') return;
        fetch('data/investment_by_enterprise.json')
            .then(function(r) { return r.json(); })
            .then(function(d) {
                var g = d.groups || [];
                window.chartInvestment = new Chart(el, {
                    type: 'bar',
                    data: {
                        labels: g.map(function(x) { return x.enterprise_classification; }),
                        datasets: [
                            { label: 'LoA USD', data: g.map(function(x) { return x.loa_usd; }), backgroundColor: '#0070b6' },
                            { label: 'DBG USD', data: g.map(function(x) { return x.dbg_usd; }), backgroundColor: '#e67e22' }
                        ]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { display: true },
                            tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': $' + Number(c.parsed.y).toLocaleString(); } } }
                        },
                        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
                    }
                });
            })
            .catch(function() { /* JSON missing: leave the canvas blank */ });
    })();

    // Build the left-panel Grantees list (DataTable) from the async grantee features.
    // Called once data:loaded fires (see below); the row-click handler looks up
    // features lazily so it works after load.
    function buildGranteeTable() {
        $table = $('#dataTable');
        $col_to_show = ['S_N', 'Name_of_Organization'];

        $data_table = [];
        layer_Grantees.eachLayer(function(layer) {
            $data = [];
            for (const key in $col_to_show) {
                if (layer.feature.properties.hasOwnProperty($col_to_show[key])) {
                    const element = layer.feature.properties[$col_to_show[key]];
                    $data.push(element);
                }
            }
            $data_table.unshift($data);
            // debugger;
            // $data_table.push(layer.feature.properties);
        });
        var table = $('#dataTable').DataTable({
            data: $data_table,
            columns: [
                { title: "S.N." },
                { title: "Organization" }
            ],
            dom: 'f<t>',
            "scrollY": "calc(100vh - 375px)",
            "scrollCollapse": true,
            "paging": false
        });
        $('#dataTable tbody').on('click', 'tr', function() {
            var data = table.row(this).data();
            if (!data) { return; }   // "no matching records" placeholder row has no data
            var clickedName = data[1];
            var feat = null, layer = null;
            layer_Grantees.eachLayer(function(l){ if (l.feature && l.feature.properties.Name_of_Organization === clickedName) { feat = l.feature; layer = l; } });
            // zoom to the clicked org. Deterministic: just centre the view on its coordinates at >= z13.
            // Deliberately NOT clusters_Grantees.zoomToShowLayer(layer, cb) + setView in the callback — that
            // pair races (the callback can fire mid-animation, and re-clustering absorbs the pin again), so the
            // view sometimes settled off-centre. If the pin sits in a cluster at z13 the cluster icon is what
            // you land on; click it to fan the members out.
            if (layer) { map.setView(layer.getLatLng(), Math.max(map.getZoom(), 13)); }
            b = L.DomUtil.get('aggregate');
            if (feat) { b.innerHTML = bio_table_generator(feat); }
        });
    }
    // var maintable = $('#mainTable').DataTable({
    //     data: $data_table,
    //     columns: [
    //         { title: "Organization" },
    //         { title: "Location" },
    //         { title: "Type of Grant" },
    //         { title: "Commodities / Enterprises" }
    //     ],
    //     "scrollY": "400px",
    //     "scrollCollapse": true,
    //     "paging": true,
    //     "pagingType": "numbers"
    // });

    });  // end DOMContentLoaded
