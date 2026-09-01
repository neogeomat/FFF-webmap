function style_Notables_1_0(feature) {
    return {
        pane: 'pane_Notables_1',
        radius: 4.0,
        opacity: 1,
        color: getColor(feature),
        dashArray: '',
        lineCap: 'butt',
        lineJoin: 'miter',
        weight: 1,
        fill: true,
        fillOpacity: 1,
        fillColor: 'rgba(141,90,153,1.0)',
    }
}

function style_Notables_div_icon(feature) {
    return {
        pane: 'pane_Notables_1',
        radius: 4.0,
        opacity: 1,
        color: getColor(feature),
        dashArray: '',
        lineCap: 'butt',
        lineJoin: 'miter',
        weight: 1,
        fill: true,
        fillOpacity: 1,
        fillColor: 'rgba(141,90,153,1.0)',
    }
}

function getColor(feature) {
    let color = 'rgba(35,35,35,1.0)';
    const diff = new Date() - new Date(feature.properties.Death);

    if (diff > 3153600000000) {
        // debugger;
        color = 'red';
    }
    return color;
}