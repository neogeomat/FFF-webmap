var escapeHtml = function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };
var bio_table_generator = function(feature) {
    if (feature) {
        var p = feature.properties || {};
        bio =
            '<div class="row">' +
              '<div class="col-12">' +
                '<div class="org-card">' +
                '<table class="table">' +
                  '<tr><td colspan="2"><strong>S.N.</strong> ' +
                    escapeHtml(p['S_N'] != null ? p['S_N'] : '') + '</td></tr>' +
                  '<tr><td colspan="2"><strong>Organization</strong><br />' +
                    escapeHtml(p['Name_of_Organization'] || '') + '</td></tr>' +
                  '<tr><th scope="row">Location</th><td>' +
                    escapeHtml(p['Location'] || '') + '</td></tr>' +
                  '<tr><th scope="row">Type of Grant</th><td>' +
                    escapeHtml(p['Type_of_Grant'] || '') + '</td></tr>' +
                  '<tr><th scope="row">Commodities / Enterprises</th><td>' +
                    escapeHtml(p['Commodities'] || '') + '</td></tr>';

        // Enterprise classification (from the moreDataFromFFF Enterprise
        // Commodity / Nature of Enterprises CSVs, via grantees_attributes.json).
        if (p.enterprise_classifications && p.enterprise_classifications.length) {
            bio += '<tr><th scope="row">Enterprise Classification</th><td>' +
                escapeHtml(p.enterprise_classifications.join(', ')) + '</td></tr>';
        }

        // Grants list: period, title, classification and commodity per grant.
        if (p.grants && p.grants.length) {
            var gHtml = p.grants.map(function(g) {
                var line = '<div class="grant-line">';
                if (g.grant_title) { line += '<strong>' + escapeHtml(g.grant_title) + '</strong>'; }
                if (g.implementation_period) {
                    line += '<br /><span class="text-muted">' + escapeHtml(g.implementation_period) + '</span>';
                }
                var meta = [];
                if (g.enterprise_classification) { meta.push(escapeHtml(g.enterprise_classification)); }
                if (g.subcategory || g.enterprise_commodity) { meta.push(escapeHtml(g.subcategory || g.enterprise_commodity)); }
                if (meta.length) { line += '<br /><span class="text-muted">' + meta.join(' \u00b7 ') + '</span>'; }
                line += '</div>';
                return line;
            }).join('');
            bio += '<tr><th scope="row">Grants</th><td>' + gHtml + '</td></tr>';
        }

        // Restoration records: direct vs contributed area and people benefited.
        if (p.restoration && p.restoration.length) {
            var rHtml = p.restoration.map(function(r) {
                var bits = [];
                if (r.area_direct_ha != null) { bits.push('Direct ' + escapeHtml(r.area_direct_ha) + ' ha'); }
                if (r.area_contributed_ha != null) { bits.push('Contributed ' + escapeHtml(r.area_contributed_ha) + ' ha'); }
                if (r.people_benefited != null) { bits.push(escapeHtml(r.people_benefited) + ' people'); }
                var line = '<div class="grant-line">';
                if (r.year_block) { line += '<strong>' + escapeHtml(r.year_block) + '</strong>'; }
                if (bits.length) { line += (r.year_block ? '<br />' : '') + '<span class="text-muted">' + bits.join(' \u00b7 ') + '</span>'; }
                line += '</div>';
                return line;
            }).join('');
            bio += '<tr><th scope="row">Restoration</th><td>' + rHtml + '</td></tr>';
        }

        // Women-led enterprise records.
        if (p.women && p.women.length) {
            var wHtml = p.women.map(function(w) {
                var line = '<div class="grant-line">';
                if (w.producer_group) { line += '<strong>' + escapeHtml(w.producer_group) + '</strong>'; }
                var meta = [];
                if (w.women_count != null) { meta.push(escapeHtml(w.women_count) + ' women'); }
                if (w.product) { meta.push(escapeHtml(w.product)); }
                if (meta.length) { line += (w.producer_group ? '<br />' : '') + '<span class="text-muted">' + meta.join(' \u00b7 ') + '</span>'; }
                line += '</div>';
                return line;
            }).join('');
            bio += '<tr><th scope="row">Women-led</th><td>' + wHtml + '</td></tr>';
        }

        bio +=
                '</table>' +
                '</div>' +
              '</div>' +
            '</div>';
    } else {
        bio = 'Hover over a point to see organization information.';
    }
    return bio;
};

// ---------------------------------------------------------------------------
// Literal crop drawings — per-commodity icons + palette
// Preferred palette (distinct, color-blind friendly, FAO-adjacent)
// Stacked mini-icons for multi-commodity orgs (e.g. Ginger+Turmeric)
// ---------------------------------------------------------------------------
var COMMODITY_ICON = {
    'Bamboo': '🎋',
    'Biofertilizer': '🧪',
    'Dairy': '🥛',
    'Furniture': '🪑',
    'Ginger': '🫚',
    'Herbal products': '🌿',
    'Non-timber forest products': '🍄',
    'Sal leaf plates': '🍃',
    'Silage': '🌾',
    'Timber': '🪵',
    'Timur': '🌶️',
    'Turmeric': '🟡',
    'Vegetables': '🥬',
    'Unclassified': '❓'
};

var COMMODITY_COLOR = {
    'Bamboo': '#27ae60',
    'Biofertilizer': '#8e44ad',
    'Dairy': '#2980b9',
    'Furniture': '#d35400',
    'Ginger': '#e67e22',
    'Herbal products': '#16a085',
    'Non-timber forest products': '#1abc9c',
    'Sal leaf plates': '#1e8449',
    'Silage': '#f39c12',
    'Timber': '#6d4c41',
    'Timur': '#c0392b',
    'Turmeric': '#f1c40f',
    'Vegetables': '#2ecc71',
    'Unclassified': '#95a5a6'
};

function getCommodityMeta(subcat) {
    var s = (subcat || 'Unclassified').trim() || 'Unclassified';
    // normalize Unclassified variations
    if (!COMMODITY_ICON[s]) s = 'Unclassified';
    return { icon: COMMODITY_ICON[s], color: COMMODITY_COLOR[s], label: s };
}

function commodityPinHtml(subcategories) {
    var subs = (subcategories && subcategories.length) ? subcategories.slice(0,3) : ['Unclassified'];
    // filter to known, keep Unclassified if empty
    var metas = subs.map(function(s){ return getCommodityMeta(s); });
    if (metas.length === 1) {
        var m = metas[0];
        return '<div class="commodity-pin" style="background:' + m.color + ';border-color:' + m.color + '"><span class="commodity-emoji">' + m.icon + '</span></div>';
    }
    // stacked mini-pins (2-3)
    var html = '<div class="commodity-stack">';
    metas.forEach(function(m){
        html += '<span class="mini-pin" style="background:' + m.color + ';border-color:' + m.color + '" title="' + m.label + '">' + m.icon + '</span>';
    });
    html += '</div>';
    return html;
}

// Single-point marker: literal crop drawing (or stacked mini-icons)
function style_Grantees_div_icon(feature) {
    var p = feature && feature.properties ? feature.properties : {};
    // Prefer merged subcategories (post-attributesPromise), fallback to Commodities text
    var subs = p.subcategories;
    if (!subs || !subs.length) {
        var rawTokens = p.Commodities ? p.Commodities.split(',').map(function(s){ return s.trim(); }).filter(Boolean) : [];
        var mapped = [];
        var alias = {
            'sal leaf plate': 'Sal leaf plates',
            'sal leaf plates': 'Sal leaf plates',
            'leaf plate': 'Sal leaf plates',
            'timber': 'Timber',
            'furniture': 'Furniture',
            'saw mill': 'Timber',
            'bamboo': 'Bamboo',
            'dairy': 'Dairy',
            'milk': 'Dairy',
            'vegetable': 'Vegetables',
            'vegetables': 'Vegetables',
            'timur': 'Timur',
            'turmeric': 'Turmeric',
            'ginger': 'Ginger',
            'biofertilizer': 'Biofertilizer',
            'bio-fertiliser': 'Biofertilizer',
            'silage': 'Silage',
            'ntfp': 'Non-timber forest products',
            'non-timber': 'Non-timber forest products',
            'herbal': 'Herbal products',
            'allo': 'Herbal products'
        };
        rawTokens.forEach(function(raw){
            var low = raw.toLowerCase();
            var found = null;
            // exact alias match first
            Object.keys(alias).forEach(function(k){
                if (low.indexOf(k) !== -1) found = alias[k];
            });
            if (!found) {
                Object.keys(COMMODITY_ICON).forEach(function(k){
                    if (k !== 'Unclassified' && low === k.toLowerCase()) found = k;
                });
            }
            if (!found) {
                Object.keys(COMMODITY_ICON).forEach(function(k){
                    if (k !== 'Unclassified' && low.indexOf(k.toLowerCase()) !== -1) found = k;
                });
            }
            if (found) mapped.push(found);
        });
        // dedupe and cap
        var uniq = {};
        mapped.forEach(function(m){ uniq[m]=true; });
        subs = Object.keys(uniq);
        if (!subs.length) subs = ['Unclassified'];
    }
    var capped = subs.slice(0,3);
    var isStack = capped.length > 1;
    var size = isStack ? [ capped.length * 24 + 4, 28 ] : [32, 32];
    var anchor = isStack ? [ size[0]/2, 14 ] : [16, 16];
    subs = capped;
    return {
        icon: L.divIcon({
            className: 'org-pin-wrap',
            html: commodityPinHtml(subs),
            iconSize: size,
            iconAnchor: anchor
        })
    };
}

// Helper to refresh icons after attributes merge (called from data:loaded)
function refreshCommodityIcons(layerGroup) {
    if (!layerGroup || !layerGroup.eachLayer) return;
    layerGroup.eachLayer(function(layer){
        if (layer.feature && layer.setIcon) {
            var newIcon = style_Grantees_div_icon(layer.feature);
            layer.setIcon(newIcon.icon);
        }
    });
    if (typeof clusters_Grantees !== 'undefined' && clusters_Grantees && typeof clusters_Grantees.refreshClusters === 'function') {
        try { clusters_Grantees.refreshClusters(); } catch(e){}
    }
}
