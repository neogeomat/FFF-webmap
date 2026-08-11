var bio_table_generator = function(feature) {
    if (feature) {
        bio =
            '<div class="row">' +
              '<div class="col-sm-3 col-md-6">' +
                '<table class="table">' +
                  '<tr><td colspan="2"><strong>S.N.</strong> ' +
                    (feature.properties['S_N'] != null ? feature.properties['S_N'] : '') + '</td></tr>' +
                  '<tr><td colspan="2"><strong>Organization</strong><br />' +
                    (feature.properties['Name_of_Organization'] || '') + '</td></tr>' +
                  '<tr><th scope="row">Location</th><td>' +
                    (feature.properties['Location'] || '') + '</td></tr>' +
                  '<tr><th scope="row">Type of Grant</th><td>' +
                    (feature.properties['Type_of_Grant'] || '') + '</td></tr>' +
                  '<tr><th scope="row">Commodities / Enterprises</th><td>' +
                    (feature.properties['Commodities'] || '') + '</td></tr>' +
                '</table>' +
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
