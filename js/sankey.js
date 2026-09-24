// Sankey page — multi-select for all 6 columns, OR across columns, empty set = All
// Shared logic with Webmap/js/sankey.js bottom panel (hybrid), but standalone without map
(() => {
  const CSV_URL = 'Webmap/data/Grantees.combined.csv';
  const COLS_DEF = [
    { key: 'Grant type', label: 'Grant type' },
    { key: 'Year', label: 'Year' },
    { key: 'Commodity', label: 'Commodity' },
    { key: 'Restoration area', label: 'Restoration area' },
    { key: 'Women-led', label: 'Women-led' },
    { key: 'Province', label: 'Province' },
  ];
  // Icons/colors reused from Webmap
  const COMMODITY_ICON = {
    'Non-timber forest products': '🍄', 'Dairy': '🥛', 'Agri products': '🥬', 'Vegetables': '🥬',
    'Fish': '🐟', 'PGS': '🌱', 'Sal leaf plates': '🍃', 'Timber': '🪵', 'Timur': '🌶️',
    'Bamboo': '🎋', 'Honey': '🍯', 'Nursery': '🌱', 'Ginger': '🫚', 'Herbal products': '🌿',
    'Turmeric': '🟡', 'Allo': '🧵', 'Amala': '🍋', 'Fertiliser': '🧪', 'Cinnamon': '🌿',
    'Essential Oil': '🧴', 'Handicraft': '🎨', 'Lime': '🍋', 'Silage': '🌾', 'Unclassified': '❓'
  };
  const COMMODITY_COLOR = {
    'Non-timber forest products': '#1abc9c', 'Dairy': '#2980b9', 'Agri products': '#27ae60',
    'Vegetables': '#2ecc71', 'Fish': '#3498db', 'PGS': '#27ae60', 'Sal leaf plates': '#1e8449',
    'Timber': '#6d4c41', 'Timur': '#c0392b', 'Bamboo': '#27ae60', 'Honey': '#f39c12',
    'Nursery': '#16a085', 'Ginger': '#e67e22', 'Herbal products': '#16a085', 'Turmeric': '#f1c40f',
    'Allo': '#8e44ad', 'Amala': '#f1c40f', 'Fertiliser': '#8e44ad', 'Cinnamon': '#16a085',
    'Essential Oil': '#8e44ad', 'Handicraft': '#d35400', 'Lime': '#a3e635', 'Silage': '#f39c12',
    'Unclassified': '#95a5a6'
  };

  let byOrg = {}; // S_N -> {props, grants, subcats, money}
  let moneyBySN = {};
  let orgList = []; // array of org objects for filtering

  function parseCsv(text){
    const rows=[]; let row=[], cur='', inQ=false;
    for(let i=0;i<text.length;i++){ const c=text[i], n=text[i+1];
      if(c==='"'){ if(inQ&&n==='"'){cur+='"'; i++;} else inQ=!inQ; }
      else if(c===','&&!inQ){ row.push(cur); cur=''; }
      else if((c==='\n'||c==='\r')&&!inQ){ if(c==='\r'&&n==='\n') i++; row.push(cur); cur=''; if(row.some(v=>v.trim()!=='')) rows.push(row); row=[]; }
      else cur+=c;
    }
    if(cur!==''||row.length){ row.push(cur); if(row.some(v=>v.trim()!=='')) rows.push(row); }
    return rows;
  }
  function jsonList(txt){ if(!txt) return []; try{ return JSON.parse(txt)||[];}catch{ return []; } }
  function wktPoint(wkt){ const m=/POINT\s*\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/i.exec(wkt||''); return m? [parseFloat(m[1]), parseFloat(m[2])]:null; }
  function parseFiscalYear(s){
    if(!s) return 'Undated';
    const iso=s.match(/^(\d{4})-(\d{2})-\d{2}/);
    if(iso){ const y=parseInt(iso[1],10), mo=parseInt(iso[2],10); const fy= mo>=7? y : y-1; return fy+'-'+String(fy+1).slice(-2); }
    const m=s.match(/(\d{4})/); return m? m[1]:'Undated';
  }

  // Build orgList from CSV
  async function load(){
    const res=await fetch(CSV_URL,{cache:'no-cache'});
    if(!res.ok) throw new Error('CSV '+res.status);
    const text=await res.text();
    const rows=parseCsv(text.replace(/^\uFEFF/,''));
    const head=rows.shift().map(h=>h.trim());
    const ix={}; head.forEach((h,i)=> ix[h.trim()]=i);
    const cell=(r,c)=>{ const i=ix[c]; return i===undefined||!r[i]? '' : r[i].trim(); };
    const byOrgTmp={};
    rows.forEach(r=>{
      const sn=cell(r,'S_N'); if(!sn) return;
      let o=byOrgTmp[sn];
      if(!o){
        o=byOrgTmp[sn]={ props:{ S_N: sn, Type_of_Grant: cell(r,'Type_of_Grant_geojson'), province: cell(r,'province'), district: cell(r,'district'), municipality: cell(r,'municipality'), subcats:{}, money:{loa: parseFloat(cell(r,'loa_total_USD_org'))||0, dbg: parseFloat(cell(r,'dbg_total_USD_org'))||0 } }, grants:[], subcats:{}, women:[], restoration:[] };
        moneyBySN[sn]=o.props.money;
        // also store org name
        o.props.Name_of_Organization=cell(r,'org_name_geojson');
      }
      if(cell(r,'grant_sn')){
        const sub=cell(r,'subcategory')||'Unclassified';
        o.subcats[sub]=true;
        o.grants.push({ subcategory:sub, main_category:cell(r,'main_category'), enterprise_classification:cell(r,'enterprise_classification'), implementation_period:cell(r,'implementation_period') });
      }
      if(cell(r,'women_json')) o.women=jsonList(cell(r,'women_json'));
      if(cell(r,'restoration_json')) o.restoration=jsonList(cell(r,'restoration_json'));
    });
    byOrg=byOrgTmp;
    orgList=Object.keys(byOrg).map(sn=>{
      const o=byOrg[sn];
      const p=o.props;
      // Derive dimensions for Sankey
      const firstFiscal = (()=>{ const ys=o.grants.map(g=> parseFiscalYear(g.implementation_period)).filter(y=>y!=='Undated'); return ys.sort()[0]||'Undated'; })();
      const totRest=(o.restoration.reduce((a,r)=>a+(r.area_direct_ha||0)+(r.area_contributed_ha||0),0));
      let restBucket='No restoration'; if(totRest>0 && totRest<10) restBucket='<10 ha'; else if(totRest<100) restBucket='10–100 ha'; else if(totRest<500) restBucket='100–500 ha'; else if(totRest>=500) restBucket='500+ ha';
      return {
        S_N: sn,
        props: p,
        subcat: Object.keys(o.subcats)[0]||'Unclassified',
        province: p.province||'Unassigned',
        district: p.district||'Unassigned',
        grantType: p.Type_of_Grant||'Unassigned',
        year: firstFiscal,
        restoration: restBucket,
        womenLed: (o.women&&o.women.length)? 'Women-led':'Other',
        orgName: p.Name_of_Organization||'Unnamed',
        money: (o.props.money.loa||0)+(o.props.money.dbg||0)
      };
    });
    buildFilters();
    render();
  }

  // Build multi-select pills for each of 6 columns
  function buildFilters(){
    const wrap=document.getElementById('sankeyMultiCols');
    if(!wrap) return;
    wrap.innerHTML='';
    const dims={
      'Grant type': [...new Set(orgList.map(o=>o.grantType))].sort(),
      'Year': [...new Set(orgList.map(o=>o.year))].sort(),
      'Commodity': [...new Set(orgList.map(o=>o.subcat))].sort(),
      'Restoration area': [...new Set(orgList.map(o=>o.restoration))].sort(),
      'Women-led': [...new Set(orgList.map(o=>o.womenLed))].sort(),
      'Province': [...new Set(orgList.map(o=>o.province))].sort()
    };
    // Map COLS_DEF key to dims key (commodity -> subcat)
    const dimKeyMap={'Commodity':'Commodity','Grant type':'Grant type','Year':'Year','Restoration area':'Restoration area','Women-led':'Women-led','Province':'Province'};
    COLS_DEF.forEach(col=>{
      const key=col.key;
      const values=dims[key]||[];
      const row=document.createElement('div');
      row.className='sankey-col-multi';
      row.dataset.col=key;
      const label=document.createElement('span');
      label.className='col-label';
      label.textContent=col.label;
      row.appendChild(label);
      values.forEach(v=>{
        const pill=document.createElement('span');
        pill.className='pill';
        pill.dataset.value=v;
        pill.dataset.col=key;
        // icon for commodity
        if(key==='Commodity'){
          const meta={ icon: COMMODITY_ICON[v]||'❓', color: COMMODITY_COLOR[v]||'#95a5a6' };
          pill.innerHTML=`<span class="box" style="background:${meta.color};color:#fff;border-color:${meta.color}">${meta.icon}</span> ${v}`;
        } else {
          pill.textContent=v;
        }
        pill.addEventListener('click',()=>{
          pill.classList.toggle('checked');
          render();
        });
        row.appendChild(pill);
      });
      wrap.appendChild(row);
    });
    // Wire select all / clear
    document.getElementById('sankeySelectAll')?.addEventListener('click',()=>{
      document.querySelectorAll('#sankeyMultiCols .pill').forEach(p=> p.classList.remove('checked'));
      render();
    });
    document.getElementById('sankeyClearAll')?.addEventListener('click',()=>{
      document.querySelectorAll('#sankeyMultiCols .pill').forEach(p=> p.classList.remove('checked'));
      render();
    });
  }

  function getFilters(){
    const filters={};
    COLS_DEF.forEach(col=>{
      const pills=[...document.querySelectorAll(`.sankey-col-multi[data-col="${col.key}"] .pill.checked`)].map(p=>p.dataset.value);
      if(pills.length) filters[col.key]=new Set(pills);
    });
    return filters; // empty = no filter for that col
  }

  // OR across columns, empty set = all
  function isVisible(org, filters){
    const keys=Object.keys(filters);
    if(!keys.length) return true;
    for(const k of keys){
      const set=filters[k];
      if(!set || !set.size) continue;
      let val;
      if(k==='Grant type') val=org.grantType;
      else if(k==='Year') val=org.year;
      else if(k==='Commodity') val=org.subcat;
      else if(k==='Restoration area') val=org.restoration;
      else if(k==='Women-led') val=org.womenLed;
      else if(k==='Province') val=org.province;
      else val=null;
      if(set.has(val)) return true; // OR
    }
    return false;
  }

  function render(){
    const filters=getFilters();
    const visible=orgList.filter(o=> isVisible(o,filters));
    const scopeLabel=Object.keys(filters).length? Object.entries(filters).map(([k,v])=> `${k}: ${[...v].join('+')}`).join(' · ') : 'All Nepal';
    document.getElementById('sankeyScopeLabel').textContent=scopeLabel;
    document.getElementById('sankeyCountLabel').textContent=`${visible.length} orgs / ${orgList.length}`;
    renderSankey(visible);
  }

  // Sankey rendering (amount and orgs) — adapted from Webmap/js/map.js
  function renderSankey(visible){
    const cols=COLS_DEF.map(c=> c.key).filter(k=> true); // all 6 always
    // For standalone page, cols are fixed, not dropdown-selected; we render full chain FFF Nepal -> col1 -> ... -> col6
    const dims={
      'Grant type': o=> o.grantType,
      'Year': o=> o.year,
      'Commodity': o=> o.subcat,
      'Restoration area': o=> o.restoration,
      'Women-led': o=> o.womenLed,
      'Province': o=> o.province,
      'District': o=> o.district,
      'Palika': o=> o.props.municipality||'Unassigned',
      'Organization': o=> o.orgName
    };
    const byAmount=renderSankeyInto('chartSankeyAmount','amount', visible, cols, dims);
    const byOrgs=renderSankeyInto('chartSankey','orgs', visible, cols, dims);
    renderSankeyTable(byAmount, byOrgs, cols);
  }

  function renderSankeyInto(svgId, metric, visible, cols, dims){
    const svgEl=document.getElementById(svgId);
    if(!svgEl || typeof d3==='undefined' || typeof d3.sankey!=='function') return [];
    const w=Math.max(420, Math.round(((svgEl.parentElement||{}).clientWidth||700)-2));
    const h=520;
    const svg=d3.select(svgEl).attr('width',w).attr('height',h);
    svg.selectAll('*').remove();
    if(!visible.length || !cols.length){
      svg.append('text').attr('x',w/2).attr('y',h/2).attr('text-anchor','middle').attr('fill','#999').style('font','13px Arial').text(!visible.length?'Nothing matches':'Pick a column');
      return [];
    }
    const SEP='\u0000';
    const paths=visible.map(o=>{
      const cells=['FFF Nepal'].concat(cols.map(c=> String(dims[c](o)||'Unassigned')));
      const wgt = metric==='amount'? (o.money||0) : 1;
      return {cells, w: wgt};
    });
    // Order parent-contiguous biggest first
    const order=[['FFF Nepal']];
    for(let lvl=1; lvl<=cols.length; lvl++){
      const kids={};
      paths.forEach(p=>{ const par=p.cells[lvl-1], ch=p.cells[lvl]; (kids[par]=kids[par]||{})[ch]=(kids[par][ch]||0)+p.w; });
      const seen={}; const list=[];
      order[lvl-1].forEach(par=>{ Object.keys(kids[par]||{}).sort((a,b)=>kids[par][b]-kids[par][a]).forEach(c=>{ if(!seen[c]){ seen[c]=1; list.push(c);}});});
      Object.keys(kids).forEach(par=> Object.keys(kids[par]).forEach(c=>{ if(!seen[c]){ seen[c]=1; list.push(c);}}));
      order.push(list);
    }
    const names=[], index={};
    function nodeOf(lvl,name){ const k=lvl+SEP+name; if(index[k]===undefined){ index[k]=names.length; names.push({name});} return index[k];}
    order.forEach((list,lvl)=> list.forEach(n=> nodeOf(lvl,n)));
    const counts={};
    paths.forEach(p=>{ for(let i=0;i<p.cells.length-1;i++){ const a=nodeOf(i,p.cells[i]), b=nodeOf(i+1,p.cells[i+1]); const k=a+SEP+b; counts[k]=(counts[k]||0)+p.w; }});
    const nodes=names.map(n=>({name:n.name}));
    const links=Object.keys(counts).map(k=>{ const p=k.split(SEP); return {source:parseInt(p[0],10), target:parseInt(p[1],10), value:counts[k]};});
    const color=d3.scaleOrdinal(d3.schemeTableau10);
    const sankey=d3.sankey().nodeWidth(12).nodePadding(8).extent([[28,10],[w-110,h-10]]);
    const graph=sankey({nodes:nodes.map(d=>({name:d.name})), links:links.map(d=>({source:d.source,target:d.target,value:d.value}))});
    svg.append('g').selectAll('path').data(graph.links).join('path').attr('d',d3.sankeyLinkHorizontal()).attr('stroke',d=>color(d.source.name)).attr('stroke-width',d=>Math.max(1,d.width)).attr('fill','none').attr('opacity',0.55);
    const g=svg.append('g').selectAll('g').data(graph.nodes).join('g');
    g.append('rect').attr('x',d=>d.x0).attr('y',d=>d.y0).attr('width',d=>d.x1-d.x0).attr('height',d=>Math.max(1,d.y1-d.y0)).attr('fill',d=> d.name==='FFF Nepal'?'#0070b6':color(d.name));
    g.append('text').attr('x',d=>d.x1+6).attr('y',d=>(d.y0+d.y1)/2).attr('dy','0.35em').attr('text-anchor','start').style('font','11px Arial').text(d=>d.name).attr('fill','#1a3c5e');
    // return paths for table (cells + w)
    return paths;
  }

  function renderSankeyTable(byAmount, byOrgs, cols){
    const tbl=document.getElementById('sankeyTable');
    if(!tbl) return;
    const head=tbl.querySelector('thead'), body=tbl.querySelector('tbody');
    const colsLab=COLS_DEF.map(c=>c.label);
    if(!byAmount.length && !byOrgs.length){ head.innerHTML='<tr><th>Flow data</th></tr>'; body.innerHTML='<tr class="empty"><td>Nothing matches</td></tr>'; return; }
    const rows={}; const order=[];
    function add(paths,key){ (paths||[]).forEach(p=>{ const k=p.cells.join('\u0000'); if(!rows[k]){ rows[k]={cells:p.cells, orgs:0, usd:0}; order.push(k);} rows[k][key]+=p.w; }); }
    add(byOrgs,'orgs'); add(byAmount,'usd');
    const list=order.map(k=>rows[k]).sort((a,b)=> b.usd - a.usd || b.orgs - a.orgs);
    let totOrgs=0, totUsd=0, exact=0; list.forEach(r=>{ totOrgs+=r.orgs; totUsd+=Math.round(r.usd); exact+=r.usd; });
    head.innerHTML='<tr>'+ colsLab.map(c=>`<th>${c}</th>`).join('') + '<th class="num">Organizations</th><th class="num">Amount (USD)</th><th class="num">Share</th></tr>';
    body.innerHTML=list.map(r=>{
      const tds=r.cells.slice(1).map(c=> `<td>${c}</td>`).join('');
      const share=exact? (r.usd/exact*100).toFixed(1)+'%':'—';
      return `<tr>${tds}<td class="num">${r.orgs}</td><td class="num">${r.usd? '$'+Math.round(r.usd).toLocaleString(): '—'}</td><td class="num">${share}</td></tr>`;
    }).join('') + `<tr class="total"><td colspan="${colsLab.length}">Total</td><td class="num">${totOrgs}</td><td class="num">$${Math.round(totUsd).toLocaleString()}</td><td class="num">100.0%</td></tr>`;
  }

  document.addEventListener('DOMContentLoaded', load);
})();
