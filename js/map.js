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
        var leftPanel = document.getElementById('leftPanel');
        var bottomPanel = document.getElementById('bottomPanel');
        if (!legend) return;
        var leftCollapsed = leftPanel && leftPanel.classList.contains('collapsed');
        var bottomCollapsed = bottomPanel && bottomPanel.classList.contains('collapsed');
        var panelW = leftPanel ? leftPanel.offsetWidth : 280;
        var inset = 10, gap = 10;
        // The legend lives on the LEFT and rides the LEFT panel: it clears that panel while it is open and
        // tucks to the screen edge once it collapses. The right panel no longer moves it.
        legend.style.right = 'auto';
        legend.style.left = ((leftCollapsed ? 0 : panelW + inset) + gap) + 'px';
        legend.style.bottom = bottomCollapsed ? '20px' : '360px';
    }
    if (document.readyState !== 'loading') updateLegendPosition();
    else document.addEventListener('DOMContentLoaded', updateLegendPosition);
    window.addEventListener('load', updateLegendPosition);
    
    // ---- Map mode switch (top nav) ----
    function setMapMode(mode) {
        var isEvo = mode === 'evolution';
        document.body.classList.toggle('map-mode-evolution', isEvo);
        document.body.classList.toggle('map-mode-women', mode === 'women');
        try { localStorage.setItem('fff.mapMode', mode); } catch (e) { /* private mode */ }
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
        var year = 0, month = 0;
        // ISO date (the finance service_start column, e.g. 2020-02-14): keep the MONTH, otherwise a
        // July-December start lands in the previous fiscal year.
        var iso = s.match(/^(\d{4})-(\d{2})-\d{2}/);
        if (iso) { year = parseInt(iso[1],10); month = parseInt(iso[2],10); }
        else {
            var mm = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
            if (mm) { month = evoMonthToNum(mm[1]); year = parseInt(mm[2],10); }
            else {
                var yy = s.match(/(\d{4})/);
                if (yy) year = parseInt(yy[1],10);
                else return null;
            }
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

    // Grant amount per fiscal year from the individual contracts' service_start dates (finance_json). Any
    // contract without a usable date keeps the old first-appearance attribution so the years still sum to
    // the same national total. (Historical note: before finance_json this column was attribution only.)
    // the year the organization FIRST appears - the same rule the "new grantees" column uses. It is not a
    // disbursement-per-year figure; the served files have no per-contract dates.
    function usd(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
    function evoAmountByYear() {
        var out = FISCAL_LABELS.map(function() { return 0; });
        if (!moneyBySN) { return out; }        // the geocsv loads asynchronously; we re-render when it lands
        Object.keys(evoFirstFiscalByOrg || {}).forEach(function(orgId) {
            var m = moneyBySN[String(orgId)];
            if (!m) { return; }
            var total = (m.loa || 0) + (m.dbg || 0), dated = 0;
            (m.contracts || []).forEach(function(c) {
                var fy = c.service_start ? parseFiscalYear(c.service_start) : null;
                var ci = fy ? FISCAL_LABELS.indexOf(fy) : -1;
                if (ci >= 0) { out[ci] += (c.usd_value || 0); dated += (c.usd_value || 0); }
            });
            // undated contracts (none today, but cheap insurance) follow the first-appearance rule
            var i = FISCAL_LABELS.indexOf(evoFirstFiscalByOrg[orgId]);
            if (i >= 0) { out[i] += (total - dated); }
        });
        return out;
    }

    function renderEvoTable(){
        var tbody = document.querySelector('#evoTable tbody');
        if (!tbody || !evoPerYear) return;
        tbody.innerHTML = '';
        var amt = evoAmountByYear();
        FISCAL_LABELS.forEach(function(lbl, idx){
            var row = evoPerYear[idx];
            var tr = document.createElement('tr');
            var inRange = (idx >= evoFromIdx && idx <= evoToIdx);
            tr.className = inRange ? 'in-range' : 'dimmed';
            tr.innerHTML = '<td><strong>'+lbl+'</strong></td>'+
                '<td class="num">'+row.newGrantees+'</td>'+
                '<td class="num">'+row.newLocations+'</td>'+
                '<td class="num">'+row.newEnterprises+'</td>'+
                '<td class="num">'+(amt[idx] ? usd(amt[idx]) : '—')+'</td>';
            tbody.appendChild(tr);
        });
        // summary for selected range (distinct union is already per-year first-appearance sum within range == total new in range)
        var sumG=0,sumL=0,sumE=0;
        for(var i=evoFromIdx;i<=evoToIdx;i++){ sumG+=evoPerYear[i].newGrantees; sumL+=evoPerYear[i].newLocations; sumE+=evoPerYear[i].newEnterprises; }
        var sumEl = document.getElementById('evoSummary');
        if (sumEl) {
            var rangeLabel = (evoFromIdx===evoToIdx) ? FISCAL_LABELS[evoFromIdx] : FISCAL_LABELS[evoFromIdx]+' → '+FISCAL_LABELS[evoToIdx];
            var sumA = 0;
            for (var j = evoFromIdx; j <= evoToIdx; j++) { sumA += amt[j]; }
            sumEl.innerHTML = 'Selected: <strong>'+rangeLabel+'</strong> — <strong>'+sumG+'</strong> new grantees · <strong>'+sumL+'</strong> new locations · <strong>'+sumE+'</strong> new enterprises/products · Grant amount: <strong>'+usd(sumA)+'</strong><br/><span style="color:#5a6d80">Map shows grantees whose first grant falls within the selected range. Amount = LoA + DBG contract value (USD) of the contracts that STARTED in those years.</span>';
        }
        // ticks highlight
        var tickEls = document.querySelectorAll('#tsTicks span');
        tickEls.forEach(function(el,i){ el.classList.toggle('active', i>=evoFromIdx && i<=evoToIdx); });
        // the geocsv can land after the table is first built - re-render the amounts once it does
        if (!rowsReadyDone) { rowsReady.then(function() { renderEvoTable(); }); }
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
                    var isWomenMode = document.body.classList.contains('map-mode-women');
                    if (isEvoMode && allowedOrgs) {
                        timeOk = !!allowedOrgs[String(p.S_N)];
                    }
                    var typeOk = !hasTypeFilter || !!checkedType[p.Type_of_Grant];
                    var commOk = !hasCommFilter || (p.subcategories && p.subcategories.length ? p.subcategories.some(function(c){return !!checkedComm[c];}) : true);
                    var enterpriseOk = !hasEnterpriseFilter || (p.enterprise_classifications && p.enterprise_classifications.length ? p.enterprise_classifications.some(function(c){return !!checkedEnterprise[c];}) : true);
                    var orgOk = !hasOrgFilter || (p.organization_type ? !!checkedOrg[p.organization_type] : true);
                    var womenOk = !isWomenMode || (p.women && p.women.length);
                    var show = timeOk && typeOk && commOk && enterpriseOk && orgOk && womenOk;
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
    // Points come from data/Grantees.combined.geocsv - the single runtime source (geometry + org
    // attributes + grant/women/restoration records + per-org finance). The ajax plugin went with
    // the geojson file: we fill this layer from the parsed rows and fire 'data:loaded' ourselves,
    // so every feature-dependent builder below keeps working unchanged.
    var layer_Grantees = L.geoJSON(null, {
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
        maxClusterRadius: 35,
        iconCreateFunction: function(cluster) {
            var n = cluster.getChildCount();
            return L.divIcon({
                html: '<div class="grantee-cluster" style="width:40px;height:40px;">' + n + '</div>',
                className: 'grantee-cluster-wrap',
                iconSize: [40, 40]
            });
        }
    });

    // ---- The single runtime source: data/Grantees.combined.geocsv ----
    // One row per grant (plus HH-only rows for orgs without one). Group the rows by S_N in the
    // browser: org attributes, grants, women/restoration records and per-org finance all live here.
    function wktPoint(wkt) {
        var m = /POINT\s*\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/i.exec(wkt || '');
        return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;   // WKT is authoritative (X/Y can be blank)
    }
    function jsonList(txt) {     // a malformed cell must not empty the map; degrade to no records
        if (!txt) { return []; }
        try { return JSON.parse(txt) || []; } catch (e) { console.warn('bad json column', e); return []; }
    }
    var moneyBySN = {};
    var attrsFromCsv = { orgs: [], grants: [] };   // the shape buildEvoData() reads
    var rowsReadyDone = false;
    var rowsReady = fetch('data/Grantees.combined.geocsv')
        .then(function(r) { if (!r.ok) { throw new Error('geocsv ' + r.status); } return r.text(); })
        .then(function(txt) {
            var csvRows = parseCsv(txt.replace(/^\uFEFF/, ''));
            var head = csvRows.shift() || [], ix = {};
            head.forEach(function(h, i) { ix[h.trim()] = i; });
            ['S_N', 'has_geometry', 'WKT', 'org_name_geojson', 'Location_geojson', 'Type_of_Grant_geojson', 'Commodities_geojson']
                .forEach(function(c) { if (ix[c] === undefined) { console.warn('geocsv: missing column ' + c); } });
            var cell = function(r, c) { var i = ix[c]; return (i === undefined || !r[i]) ? '' : r[i].trim(); };
            var byOrg = {};
            csvRows.forEach(function(r) {
                var sn = cell(r, 'S_N');
                if (!sn) { return; }
                var o = byOrg[sn];
                if (!o) {
                    o = byOrg[sn] = {
                        props: {
                            S_N: isNaN(+sn) ? sn : +sn,
                            Name_of_Organization: cell(r, 'org_name_geojson'),
                            Location: cell(r, 'Location_geojson'),
                            Type_of_Grant: cell(r, 'Type_of_Grant_geojson'),
                            Commodities: cell(r, 'Commodities_geojson'),
                            organization_type: cell(r, 'organization_type') || null,
                            municipality: cell(r, 'municipality') || null,
                            district: cell(r, 'district') || null,
                            province: cell(r, 'province') || null,
                            direct_hh: cell(r, 'direct_hh') || null,
                            total_hh: cell(r, 'total_hh') || null,
                            area_ha: parseFloat(cell(r, 'area_ha_org')) || null
                        },
                        grants: [], subcats: {}, classes: {}, women: [], restoration: [],
                        geom: wktPoint(cell(r, 'WKT'))
                    };
                    moneyBySN[sn] = {
                        loa: parseFloat(cell(r, 'loa_total_USD_org')) || 0,
                        dbg: parseFloat(cell(r, 'dbg_total_USD_org')) || 0,
                        cls: cell(r, 'enterprise_classification') || 'Unclassified',
                        contracts: jsonList(cell(r, 'finance_json'))   // per-contract service_start + usd_value
                    };
                    attrsFromCsv.orgs.push({ org_id: +sn, district: o.props.district || '', municipality: o.props.municipality || '', location: o.props.Location || '' });
                }
                if (cell(r, 'grant_sn')) {
                    var g = {
                        grant_sn: +cell(r, 'grant_sn'),
                        org_id: +sn,
                        grant_title: cell(r, 'grant_title'),
                        grantee_name: cell(r, 'grantee_name_grantCSV'),
                        implementation_period: cell(r, 'implementation_period'),
                        enterprise_commodity: cell(r, 'enterprise_commodity'),
                        main_category: cell(r, 'main_category'),
                        subcategory: cell(r, 'subcategory'),
                        enterprise_classification: cell(r, 'enterprise_classification')
                    };
                    o.grants.push(g);
                    attrsFromCsv.grants.push(g);
                    if (g.subcategory) { o.subcats[g.subcategory] = true; }
                    if (g.enterprise_classification) { o.classes[g.enterprise_classification] = true; }
                }
                if (cell(r, 'women_json')) { o.women = jsonList(cell(r, 'women_json')); }
                if (cell(r, 'restoration_json')) { o.restoration = jsonList(cell(r, 'restoration_json')); }
            });
            return byOrg;
        })
        .catch(function(e) { console.warn('geocsv load failed - the map stays empty', e); return {}; });

    // One marker per org that has coordinates; everything else on the feature is already merged.
    rowsReady.then(function(byOrg) {
        var features = [];
        Object.keys(byOrg).forEach(function(sn) {
            var o = byOrg[sn];
            if (!o.geom) { return; }     // no coordinates -> no marker, exactly like the old null geometries
            var p = o.props;
            p.grants = o.grants;
            p.women = o.women;
            p.restoration = o.restoration;
            p.subcategories = Object.keys(o.subcats);
            if (p.subcategories.length === 0) { p.subcategories = ['Unclassified']; }
            p.enterprise_classifications = Object.keys(o.classes);
            var people = 0, areaDirect = 0, areaContrib = 0;
            p.restoration.forEach(function(rr) {
                people += (rr.people_benefited || 0);
                areaDirect += (rr.area_direct_ha || 0);
                areaContrib += (rr.area_contributed_ha || 0);
            });
            p.people_benefited = people || null;
            p.area_direct_ha = areaDirect || null;
            p.area_contributed_ha = areaContrib || null;
            features.push({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: o.geom } });
        });
        features.sort(function(a, b) { return a.properties.S_N - b.properties.S_N; });
        layer_Grantees.addData(features);
        rowsReadyDone = true;
        layer_Grantees.fire('data:loaded');
    });

    // Everything that depends on the grantee features runs from the data:loaded handler below.
    layer_Grantees.on('data:loaded', function() {
        clusters_Grantees.addLayer(layer_Grantees);
        clusters_Grantees.addTo(map);   // Organizations layer on by default
        bounds_group.addLayer(clusters_Grantees);
        setBounds();

        // The features are ready, so build everything that depends on them.
        try { buildEvoData(attrsFromCsv); updateSliderUI(); } catch(e) { console.warn('evo build failed', e); }
        // Build the Type-of-Grant / Commodities / Organization Type filter pills.
        buildGranteeFilters();
        // Build the left-panel Grantees list (DataTable).
        buildGranteeTable();
        // Refresh commodity icons (literal crop drawings, stacked mini-icons) now that subcategories known
        try { if (typeof refreshCommodityIcons === 'function') refreshCommodityIcons(layer_Grantees); } catch(e){ console.warn('refresh icons failed', e); }
        // Build floating commodity legend (overlay on map)
        try { buildCommodityLegend(); } catch(e){ console.warn('legend build failed', e); }
        // National aggregate view on load (the pie/bar are empty placeholders otherwise).
        try { renderAggregates(null); renderInvestment(null); renderSankey(null); } catch(e) { console.warn('aggregate render failed', e); }
        // Restore the map mode chosen last visit - must run after features + p.women exist.
        try { setMapMode(localStorage.getItem('fff.mapMode') || 'overview'); } catch (e) {}

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
    // top horizontal bar (not a map control). Built from the layer_Grantees
    // 'data:loaded' handler, i.e. once the merged geocsv features are on the map.
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
            nameField: 'DISTRICT',
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
            nameField: 'GaPa_NaPa',
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
            weight: 2,
            nameField: 'Province',
        }, {
            varName: 'json_Chure',
            layerVar: 'layer_Chure',
            url: 'data/chureDissolved.geojson',
            label: 'Chure boundaries',
            pane: 'pane_Chure',
            color: '#27ae60',
            weight: 1.5,
            nameField: null,
            fillOpacity: 0.12,
            fill: true
        }, {
            varName: 'json_Nepal',
            layerVar: 'layer_Nepal',
            url: 'data/Nepal.geojson',
            label: 'Country boundary (Nepal)',
            pane: 'pane_Nepal',
            color: '#ffffff',
            weight: 3,
            nameField: null,
        }];

        // Clicking a boundary writes a short overview into the Aggregate panel
        // (#aggOverview), leaving the placeholder charts below it untouched.
        function showOverview(title, msg) { setAggOverview(title, msg); }

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

    // ---- Aggregate scope: point-in-polygon membership + scoped charts ----
    var selectedScope = null;
    var PROV_CODE = { 1: 'Koshi', 2: 'Madhesh', 3: 'Bagmati', 4: 'Gandaki', 5: 'Lumbini', 6: 'Karnali', 7: 'Sudurpashchim' };

    // LatLngs come back as [[ring]] for Polygon and [[[ring]]] for MultiPolygon - flatten to a ring list.
    function polyRings(layer) {
        var g = (layer && layer.getLatLngs) ? layer.getLatLngs() : [];
        if (!g.length) { return []; }
        return (g[0] && g[0][0] && g[0][0].lat !== undefined) ? g : g.reduce(function(a, x) { return a.concat(x); }, []);
    }
    // ponytail: ray casting on exterior rings only (these boundary files have no holes).
    function pointInRings(latlng, rings) {
        var x = latlng.lng, y = latlng.lat, inside = false;
        for (var r = 0; r < rings.length; r++) {
            var ring = rings[r];
            for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                var xi = ring[i].lng, yi = ring[i].lat, xj = ring[j].lng, yj = ring[j].lat;
                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) { inside = !inside; }
            }
        }
        return inside;
    }
    // Markers inside a boundary polygon (a layer), or all markers when layer is null.
    function markersIn(layer) {
        var out = [], rings = layer ? polyRings(layer) : null;
        layer_Grantees.eachLayer(function(l) {
            if (!layer || pointInRings(l.getLatLng(), rings)) { out.push(l); }
        });
        return out;
    }
    // Canonical district name from geometry (77 districts cover all of Nepal).
    function districtOf(latlng) {
        var hit = null;
        if (window.layer_District) {
            window.layer_District.eachLayer(function(l) {
                if (!hit && pointInRings(latlng, polyRings(l))) { hit = (l.feature.properties || {}).DISTRICT || null; }
            });
        }
        return hit;
    }
    function setAggOverview(title, msg) {
        var el = document.getElementById('aggOverview');
        if (!el) { return; }
        el.innerHTML = '<p class="mb-0"><strong>' + title + '</strong><br />' +
            '<span class="text-muted">' + msg + '</span></p>';
        var card = el.closest('.card');
        if (card) { card.style.display = ''; }
    }
    function openRightPanel() {
        var rp = document.getElementById('rightPanel');
        if (!rp || !rp.classList.contains('collapsed')) { return; }
        rp.classList.remove('collapsed');
        var arr = document.getElementById('rightPanelArrow');
        if (arr) { arr.textContent = '\u2039'; }
        setTimeout(function() { if (map && map.invalidateSize) { map.invalidateSize(); } }, 320);
    }
    // Type-of-grant pie + commodity bar for a set of markers.
    function renderAggregates(scope, ms) {
        ms = ms || markersIn(scope && scope.layer);
        var type = {}, comm = {}, grants = 0;
        ms.forEach(function(l) {
            var p = l.feature.properties;
            grants += (p.grants || []).length;
            var t = p.Type_of_Grant || 'Unknown';
            type[t] = (type[t] || 0) + 1;
            (p.subcategories || []).forEach(function(c) { comm[c] = (comm[c] || 0) + 1; });
        });
        var TYPE_COLOR = { 'LoA': '#0070b6', 'DBG': '#e67e22' };
        var typeKeys = Object.keys(type);
        var typeData = typeKeys.map(function(k) { return type[k]; });
        var typeColors = typeKeys.map(function(k) { return TYPE_COLOR[k] || '#9aa7b1'; });
        if (window.chartPie) {
            window.chartPie.data.labels = typeKeys;
            window.chartPie.data.datasets[0].data = typeData;
            window.chartPie.data.datasets[0].backgroundColor = typeColors;
            window.chartPie.update();
        }
        // Same numbers as the pie, as bars - LoA vs DBG is easier to compare in bars.
        if (window.chartTypeBar) {
            window.chartTypeBar.data.labels = typeKeys;
            window.chartTypeBar.data.datasets[0].data = typeData;
            window.chartTypeBar.data.datasets[0].backgroundColor = typeColors;
            window.chartTypeBar.update();
        }
        var ck = Object.keys(comm).sort(function(a, b) { return comm[b] - comm[a]; })
            .filter(function(k) { return k !== 'Unclassified'; });
        if (window.chartBar) {
            window.chartBar.data.labels = ck;
            window.chartBar.data.datasets[0].data = ck.map(function(k) { return comm[k]; });
            window.chartBar.update();
        }
        setAggOverview(scope ? (scope.kind + ' \u2014 ' + scope.label) : 'All Nepal',
            ms.length + ' organizations, ' + grants + ' grants' + (scope ? '' : ' (nationwide)'));
        return { markers: ms, type: type, comm: comm };
    }
    function setScope(scope) {
        if (selectedScope && selectedScope.layerVar && window[selectedScope.layerVar]) {
            window[selectedScope.layerVar].resetStyle(selectedScope.layer);
        }
        selectedScope = scope;
        if (scope.layer && scope.layer.setStyle) {
            scope.layer.setStyle({ weight: 3, color: '#0070b6', fillOpacity: 0.25 });
        }
        var ms = markersIn(scope.layer);
        renderAggregates(scope, ms);
        if (typeof renderInvestment === 'function') { renderInvestment(scope, ms); }
        if (typeof renderSankey === 'function') { renderSankey(scope, ms); }
        openRightPanel();
    }
    function clearScope() {
        if (selectedScope && selectedScope.layerVar && window[selectedScope.layerVar]) {
            window[selectedScope.layerVar].resetStyle(selectedScope.layer);
        }
        selectedScope = null;
        var ms = markersIn(null);
        renderAggregates(null, ms);
        if (typeof renderInvestment === 'function') { renderInvestment(null, ms); }
        if (typeof renderSankey === 'function') { renderSankey(null, ms); }
    }
    // Per-org money comes from the served Grantees.combined.geocsv (per-org finance columns, repeated on
    // every grant row) - first row per S_N wins, the same dedupe make_geocsv.py/summarise_investment.py used.
    // Whole-text CSV parse: cell values in this file contain newlines and commas inside quotes,
    // so line-by-line splitting loses rows.
    function parseCsv(text) {
        var rows = [], row = [], cur = '', q = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (q) {
                if (ch === '"') { if (text.charAt(i + 1) === '"') { cur += '"'; i++; } else { q = false; } }
                else { cur += ch; }
            } else if (ch === '"') { q = true; }
            else if (ch === ',') { row.push(cur); cur = ''; }
            else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
            else if (ch !== String.fromCharCode(13)) { cur += ch; }
        }
        if (cur.length || row.length) { row.push(cur); rows.push(row); }
        return rows.filter(function(r) { return r.length > 1; });
    }

    // LoA/DBG stacked bar per enterprise classification, for the markers in scope.
    function renderInvestment(scope, ms) {
        var el = document.getElementById('chartInvestment');
        if (!el || typeof Chart === 'undefined') { return; }
        ms = ms || markersIn(scope && scope.layer);
        // moneyBySN is filled while the geocsv is parsed (see the rowsReady loader above).
        rowsReady.then(function() {
            var money = moneyBySN;
            var g = {};
            // National view = every org in the file (money exists for orgs with no coordinates too, and
            // the published total 2,288,256 USD includes them). A polygon scope can only see the orgs
            // whose marker falls inside it - that is the honest split, not a bug.
            var want = null;
            if (scope) {
                want = {};
                ms.forEach(function(l) { want[String(l.feature.properties.S_N)] = true; });
            }
            Object.keys(money).forEach(function(sn) {
                if (want && !want[sn]) { return; }
                var m = money[sn];
                if (!g[m.cls]) { g[m.cls] = { loa: 0, dbg: 0 }; }
                g[m.cls].loa += m.loa;
                g[m.cls].dbg += m.dbg;
            });
            var keys = Object.keys(g).sort(function(a, b) { return (g[b].loa + g[b].dbg) - (g[a].loa + g[a].dbg); });
            var loa = keys.map(function(k) { return g[k].loa; });
            var dbg = keys.map(function(k) { return g[k].dbg; });
            if (window.chartInvestment && window.chartInvestment.data) {
                window.chartInvestment.data.labels = keys;
                window.chartInvestment.data.datasets[0].data = loa;
                window.chartInvestment.data.datasets[1].data = dbg;
                window.chartInvestment.update();
                return;
            }
            window.chartInvestment = new Chart(el, {
                type: 'bar',
                data: { labels: keys, datasets: [
                    { label: 'LoA USD', data: loa, backgroundColor: '#0070b6' },
                    { label: 'DBG USD', data: dbg, backgroundColor: '#e67e22' }
                ] },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { display: true },
                        tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': $' + Number(c.parsed.y).toLocaleString(); } } }
                    },
                    scales: { x: { stacked: true, ticks: { color: '#1a3c5e', font: { size: 10 } } },
                              y: { stacked: true, beginAtZero: true, ticks: { color: '#1a3c5e' } } }
                }
            });
        });
    }

    // Sankey: FFF -> Province -> District -> Palika (one unit = one organization), scoped to the selection.
    function renderSankey(scope, ms) {
        var svgEl = document.getElementById('chartSankey');
        if (!svgEl || typeof d3 === 'undefined' || typeof d3.sankey !== 'function') { return; }
        ms = ms || markersIn(scope && scope.layer);
        // fixed width, not the panel's: the .sankey-wrap scroller gives it the room (see css/map.css)
        var w = 620;
        var h = 380;
        var svg = d3.select(svgEl).attr('width', w).attr('height', h);
        svg.selectAll('*').remove();
        if (!ms.length) {
            svg.append('text').attr('x', w / 2).attr('y', h / 2).attr('text-anchor', 'middle')
                .attr('fill', '#999').style('font', '13px Arial, Helvetica, sans-serif')
                .text('No organizations in this area');
            return;
        }
        var SEP = '\u0000';
        // ponytail: cap every level and only draw the palika column when a district/palika is in focus -
        // 4 levels x ~30 nodes in a 310px panel is an unreadable tangle (verified by screenshot).
        var distCount = {}, palCount = {}, rows = [];
        ms.forEach(function(l) {
            var pr = l.feature.properties;
            var prov = pr.province || 'Unassigned';
            var dist = districtOf(l.getLatLng()) || pr.district || 'Unassigned';
            var pal = pr.municipality || 'Unassigned';
            distCount[dist] = (distCount[dist] || 0) + 1;
            palCount[pal] = (palCount[pal] || 0) + 1;
            rows.push([prov, dist, pal]);
        });
        function topOf(counts, n) {
            var keep = {};
            Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; }).slice(0, n)
                .forEach(function(k) { keep[k] = k; });
            return keep;
        }
        var distOf = topOf(distCount, 12);
        var palOf = topOf(palCount, 10);
        var withPalika = !!(scope && (scope.kind === 'District' || scope.kind === 'Local Level'));
        // Node keys are level-prefixed: "Unassigned" can legitimately be province, district AND palika
        // at once, and a same-name node pair makes d3-sankey throw "circular link".
        var names = [{ name: 'FFF' }], index = { 'L0\u0000FFF': 0 };
        function nodeOf(level, name) {
            var key = level + SEP + name;
            if (index[key] === undefined) { index[key] = names.length; names.push({ name: name }); }
            return index[key];
        }
        var counts = {};
        rows.forEach(function(t) {
            var dist = distOf[t[1]] || 'Other districts';
            var chain = [[0, 'FFF', t[0]], [1, t[0], dist]];
            if (withPalika) { chain.push([2, dist, palOf[t[2]] || 'Other palikas']); }
            chain.forEach(function(triple) {
                var a = nodeOf('L' + triple[0], triple[1]);
                var b = nodeOf('L' + (triple[0] + 1), triple[2]);
                var k = a + SEP + b;
                counts[k] = (counts[k] || 0) + 1;
            });
        });
        var nodes = names.map(function(n) { return { name: n.name }; });
        var links = Object.keys(counts).map(function(k) {
            var p = k.split(SEP);
            return { source: parseInt(p[0], 10), target: parseInt(p[1], 10), value: counts[k] };
        });
        // reserve label gutters left and right so no node label gets clipped by the panel edge
        var sankey = d3.sankey().nodeWidth(12).nodePadding(8).extent([[62, 10], [w - 62, h - 10]]);
        var graph = sankey({ nodes: nodes.map(function(d) { return { name: d.name }; }),
                             links: links.map(function(d) { return { source: d.source, target: d.target, value: d.value }; }) });
        var color = d3.scaleOrdinal(d3.schemeTableau10);
        var maxDepth = d3.max(graph.nodes, function(d) { return d.depth; }) || 0;
        svg.append('g').selectAll('path').data(graph.links).join('path')
            .attr('d', d3.sankeyLinkHorizontal())
            .attr('stroke', function(d) { return color(d.source.name); })
            .attr('stroke-width', function(d) { return Math.max(1, d.width); })
            .attr('fill', 'none').attr('opacity', 0.55);
        var g = svg.append('g').selectAll('g').data(graph.nodes).join('g');
        g.append('rect')
            .attr('x', function(d) { return d.x0; }).attr('y', function(d) { return d.y0; })
            .attr('width', function(d) { return d.x1 - d.x0; })
            .attr('height', function(d) { return Math.max(1, d.y1 - d.y0); })
            .attr('fill', function(d) { return d.name === 'FFF' ? '#0070b6' : color(d.name); });
        g.append('text')
            // labels sit in the gutters: to the right of every column except the last, which labels left
            .attr('x', function(d) { return d.depth === maxDepth ? d.x0 - 5 : d.x1 + 5; })
            .attr('text-anchor', function(d) { return d.depth === maxDepth ? 'end' : 'start'; })
            .attr('y', function(d) { return (d.y0 + d.y1) / 2; }).attr('dy', '0.35em')
            .attr('font', '10px Arial, Helvetica, sans-serif').attr('fill', '#1a3c5e')
            .text(function(d) { var n = String(d.name); return (n.length > 15 ? n.slice(0, 14) + '\u2026' : n) + ' (' + d.value + ')'; });
        g.append('title').text(function(d) { return String(d.name) + ': ' + d.value + ' organizations'; });
    }
    // The boundary panes stack Nepal > Chure > Province > LocalLevel > District, so hit-testing would
    // always land on Nepal. Pick the finest VISIBLE boundary containing the click instead - and because
    // the boundary pills add/remove layers from the map, turning District off makes Province scopeable.
    function scopeCandidateAt(latlng) {
        var order = ['layer_LocalLevel', 'layer_District', 'layer_Province'];
        var kinds = { layer_LocalLevel: 'Local Level', layer_District: 'District', layer_Province: 'Province' };
        for (var i = 0; i < order.length; i++) {
            var lyr = window[order[i]];
            if (!lyr || !map.hasLayer(lyr)) { continue; }
            var hit = null;
            lyr.eachLayer(function(l) {
                if (!hit && pointInRings(latlng, polyRings(l))) { hit = l; }
            });
            if (!hit) { continue; }
            var pr = (hit.feature && hit.feature.properties) || {};
            var nm = (order[i] === 'layer_LocalLevel') ? pr.GaPa_NaPa : (order[i] === 'layer_District' ? pr.DISTRICT : pr.Province);
            if (nm !== null && nm !== undefined && /^[0-9]+$/.test(String(nm))) { nm = PROV_CODE[nm] || String(nm); }
            return { kind: kinds[order[i]], label: nm ? String(nm) : kinds[order[i]], layer: hit, layerVar: order[i] };
        }
        return null;
    }
    map.on('click', function(ev) {
        // ignore clicks that landed on a marker, cluster, tooltip or map control
        var t = ev.originalEvent ? ev.originalEvent.target : null;
        if (t && t.closest && t.closest('.leaflet-marker-icon, .leaflet-tooltip, .leaflet-popup, .leaflet-control')) { return; }
        var c = scopeCandidateAt(ev.latlng);
        if (!c) {
            if (selectedScope) { clearScope(); }          // clicked outside every boundary = national view
            return;
        }
        if (selectedScope && selectedScope.layer === c.layer) { clearScope(); return; }   // click again = clear
        setScope(c);
    });

    // Aggregate panel: empty placeholder charts (no real data yet).
    // Chart.js, d3 and d3.sankey are loaded from js/vendor/* in <head>.
    (function() {
        var hasChart = (typeof Chart !== 'undefined');
        var ctxPie = document.getElementById('chartPie');
        if (ctxPie && hasChart) {
            window.chartPie = new Chart(ctxPie, {
                type: 'pie',
                data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderColor: '#ffffff', borderWidth: 2 }] },
                options: { responsive: true, plugins: { legend: { display: true } } }
            });
        }
        var ctxTypeBar = document.getElementById('chartTypeBar');
        if (ctxTypeBar && hasChart) {
            window.chartTypeBar = new Chart(ctxTypeBar, {
                type: 'bar',
                data: { labels: [], datasets: [{ label: 'Organizations', data: [], backgroundColor: [] }] },
                options: { responsive: true, plugins: { legend: { display: false } },
                           scales: { x: { ticks: { color: '#1a3c5e', font: { size: 10 } } },
                                     y: { beginAtZero: true, ticks: { color: '#1a3c5e' } } } }
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
        // The sankey is drawn by renderSankey()/renderAggregates() once the features and the geocsv
        // are in - nothing to draw here (the old "no data yet" placeholder was removed).
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
