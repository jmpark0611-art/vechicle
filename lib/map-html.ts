import type { SpeedZone, VehiclePosition } from './location-data';

export function generateVehicleMapHtml(
  vehicles: VehiclePosition[],
  zones: SpeedZone[] = [],
  zoneAddMode = false
): string {
  const center = vehicles.length > 0
    ? `[${vehicles[0].latitude}, ${vehicles[0].longitude}]`
    : zones.length > 0
    ? `[${zones[0].latitude}, ${zones[0].longitude}]`
    : '[36.5, 127.9]';
  const zoom = vehicles.length > 0 || zones.length > 0 ? 14 : 7;

  const emptyStateHtml = vehicles.length === 0 && !zoneAddMode
    ? `<div id="empty-state" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;z-index:1000;background:white;padding:20px 28px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.12);pointer-events:none"><div style="font-size:15px;font-weight:700;color:#0F172A;margin-bottom:4px">운행 중인 차량 없음</div><div style="font-size:13px;color:#64748B">현재 운행 중인 차량이 없습니다</div></div>`
    : '';

  const addModeHtml = zoneAddMode
    ? `<div id="add-hint" style="position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:1000;background:#1D4ED8;color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;font-weight:700;box-shadow:0 2px 12px rgba(29,78,216,0.4);pointer-events:none">지도를 탭하여 구역 중심을 선택하세요</div>`
    : '';

  const markersJs = vehicles.map((v) => {
    const speed = v.speedKmh != null ? `${Math.round(v.speedKmh)} km/h` : '-';
    const time = new Date(v.recordedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const route = v.route.replace(/'/g, "\\'");
    const name = v.vehicleNumber.replace(/'/g, "\\'");
    return `L.marker([${v.latitude}, ${v.longitude}], {icon: carIcon})
      .addTo(map)
      .bindPopup('<div style="font-family:sans-serif;min-width:160px"><b style="font-size:15px">${name}</b><br><span style="color:#2563EB">● 운행 중</span><br><span style="color:#64748B;font-size:12px">${route}</span><br><span style="font-size:12px">속도: ${speed} · ${time}</span></div>')`;
  }).join(';\n') + (vehicles.length > 0 ? ';' : '');

  const zonesJs = zones.map((z) => {
    const escaped = z.name.replace(/'/g, "\\'");
    return `L.circle([${z.latitude}, ${z.longitude}], {
      radius: ${z.radiusM},
      color: '#DC2626',
      fillColor: '#FEF2F2',
      fillOpacity: 0.25,
      weight: 2
    }).addTo(map)
    .bindPopup('<div style="font-family:sans-serif"><b>${escaped}</b><br>제한속도: ${z.speedLimitKmh}km/h<br>반경: ${z.radiusM}m</div>');
    L.circleMarker([${z.latitude}, ${z.longitude}], {
      radius: 5, color: '#DC2626', fillColor: '#DC2626', fillOpacity: 1, weight: 0
    }).addTo(map);`;
  }).join('\n');

  const tapHandlerJs = zoneAddMode
    ? `map.on('click', function(e) {
        var msg = JSON.stringify({ type: 'mapTap', lat: e.latlng.lat, lng: e.latlng.lng });
        if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(msg); }
        else { window.parent.postMessage(msg, '*'); }
      });`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; }
    ${zoneAddMode ? 'body { cursor: crosshair; }' : ''}
  </style>
</head>
<body>
  <div id="map"></div>
  ${emptyStateHtml}
  ${addModeHtml}
  <script>
    var map = L.map('map').setView(${center}, ${zoom});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(map);
    var carIcon = L.divIcon({
      html: '<div style="background:#2563EB;width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(37,99,235,0.5)"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -12],
      className: ''
    });
    ${markersJs}
    ${zonesJs}
    ${tapHandlerJs}
  </script>
</body>
</html>`;
}
