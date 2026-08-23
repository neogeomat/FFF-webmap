var bio_table_generator = function(feature) {
    if (feature) {
        var p = feature.properties || {};
        bio =
            '<div class="row">' +
              '<div class="col-12">' +
                '<div class="org-card">' +
                '<table class="table">' +
                  '<tr><td colspan="2"><strong>S.N.</strong> ' +
                    (p['S_N'] != null ? p['S_N'] : '') + '</td></tr>' +
                  '<tr><td colspan="2"><strong>Organization</strong><br />' +
                    (p['Name_of_Organization'] || '') + '</td></tr>' +
                  '<tr><th scope="row">Location</th><td>' +
                    (p['Location'] || '') + '</td></tr>' +
                  '<tr><th scope="row">Type of Grant</th><td>' +
                    (p['Type_of_Grant'] || '') + '</td></tr>' +
                  '<tr><th scope="row">Commodities / Enterprises</th><td>' +
                    (p['Commodities'] || '') + '</td></tr>';

        // Enterprise classification (from the moreDataFromFFF Enterprise
        // Commodity / Nature of Enterprises CSVs, via grantees_attributes.json).
        if (p.enterprise_classifications && p.enterprise_classifications.length) {
            bio += '<tr><th scope="row">Enterprise Classification</th><td>' +
                p.enterprise_classifications.join(', ') + '</td></tr>';
        }

        // Grants list: period, title, classification and commodity per grant.
        if (p.grants && p.grants.length) {
            var gHtml = p.grants.map(function(g) {
                var line = '<div class="grant-line">';
                if (g.grant_title) { line += '<strong>' + g.grant_title + '</strong>'; }
                if (g.implementation_period) {
                    line += '<br /><span class="text-muted">' + g.implementation_period + '</span>';
                }
                var meta = [];
                if (g.enterprise_classification) { meta.push(g.enterprise_classification); }
                if (g.subcategory || g.enterprise_commodity) { meta.push(g.subcategory || g.enterprise_commodity); }
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
                if (r.area_direct_ha != null) { bits.push('Direct ' + r.area_direct_ha + ' ha'); }
                if (r.area_contributed_ha != null) { bits.push('Contributed ' + r.area_contributed_ha + ' ha'); }
                if (r.people_benefited != null) { bits.push(r.people_benefited + ' people'); }
                var line = '<div class="grant-line">';
                if (r.year_block) { line += '<strong>' + r.year_block + '</strong>'; }
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
                if (w.producer_group) { line += '<strong>' + w.producer_group + '</strong>'; }
                var meta = [];
                if (w.women_count != null) { meta.push(w.women_count + ' women'); }
                if (w.product) { meta.push(w.product); }
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

// Blue round pin showing the S.N. number; compact so names do not overlap.
function style_Grantees_div_icon(feature) {
    var sn = feature.properties.S_N != null ? feature.properties.S_N : '';
    return {
        icon: L.divIcon({
            className: 'org-pin-wrap',
            html: '<div class="org-pin">' + sn + '</div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        })
    };
}
