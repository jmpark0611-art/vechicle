export type VehiclePosition = {
  vehicleNumber: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  recordedAt: string | null;
  startPlace: string | null;
  endPlace: string | null;
};

export function generateVehicleMapHtml(vehicles: VehiclePosition[]): string {
  const center = vehicles.length > 0
    ? `[${vehicles[0].latitude}, ${vehicles[0].longitude}]`
    : '[36.5, 127.9]';
  const zoom = vehicles.length > 0 ? 14 : 7;

  const markersJs = vehicles.map((v) => {
    const speed = v.speedKmh != null ? `${v.speedKmh.toFixed(1)} km/h` : '-';
    const time = v.recordedAt
      ? new Date(v.recordedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      : '-';
    const route = v.startPlace && v.endPlace
      ? `${v.startPlace} → ${v.endPlace}`
      : (v.startPlace ?? '-');
    return `L.marker([${v.latitude}, ${v.longitude}], {icon: carIcon})
      .addTo(map)
      .bindPopup('<div style="font-family:sans-serif;min-width:160px"><b style="font-size:15px">${v.vehicleNumber}</b><br><span style="color:#2563EB">● 운행 중</span><br><span style="color:#64748B;font-size:12px">${route}</span><br><span style="font-size:12px">속도: ${speed} · ${time}</span></div>')`;
  }).join(';\n') + (vehicles.length > 0 ? ';' : '');

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
  </style>
</head>
<body>
  <div id="map"></div>
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
  </script>
</body>
</html>`;
}
