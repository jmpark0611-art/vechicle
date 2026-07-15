import type { SpeedZone, VehiclePosition, ZonePoint } from './location-data';

type SelectionMode = 'circle' | 'polygon';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pointArray(points: ZonePoint[]) {
  return JSON.stringify(points.map((point) => [point.latitude, point.longitude]));
}

export function generateVehicleMapHtml(
  vehicles: VehiclePosition[],
  zones: SpeedZone[] = [],
  zoneAddMode = false,
  polygonDraft: ZonePoint[] = [],
  selectionMode: SelectionMode = 'polygon'
): string {
  const center = vehicles.length > 0
    ? `[${vehicles[0].latitude}, ${vehicles[0].longitude}]`
    : zones.length > 0
    ? `[${zones[0].latitude}, ${zones[0].longitude}]`
    : polygonDraft.length > 0
    ? `[${polygonDraft[0].latitude}, ${polygonDraft[0].longitude}]`
    : '[36.5, 127.9]';
  const zoom = vehicles.length > 0 || zones.length > 0 || polygonDraft.length > 0 ? 15 : 7;

  const emptyStateHtml = vehicles.length === 0 && !zoneAddMode
    ? `<div id="empty-state" class="floating-note"><strong>운행 중 차량 없음</strong><span>구역 설정은 큰 지도에서 더 편하게 할 수 있습니다.</span></div>`
    : '';

  const addModeHtml = zoneAddMode
    ? `<div id="add-hint" class="add-hint">${
        selectionMode === 'polygon'
          ? '면적 설정: 지도를 한 번씩 탭해 경계점을 추가하세요. 두 번 탭하면 지도가 확대될 수 있어요.'
          : '원형 설정: 지도를 움직인 뒤 중심 좌표 사용을 누르세요.'
      }</div>
       <div class="center-pin"></div>
       <button id="use-center" type="button">중심 좌표 사용</button>`
    : '';

  const markersJs = vehicles.map((vehicle) => {
    const speed = vehicle.speedKmh != null ? `${Math.round(vehicle.speedKmh)} km/h` : '-';
    const time = new Date(vehicle.recordedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const route = escapeHtml(vehicle.route);
    const name = escapeHtml(vehicle.vehicleNumber);
    return `L.marker([${vehicle.latitude}, ${vehicle.longitude}], {icon: carIcon})
      .addTo(map)
      .bindPopup('<div class="popup"><b>${name}</b><span class="blue">운행 중</span><span>${route}</span><span>속도: ${speed} · ${time}</span></div>')`;
  }).join(';\n') + (vehicles.length > 0 ? ';' : '');

  const zonesJs = zones.map((zone) => {
    const name = escapeHtml(zone.name);
    if (zone.zoneKind === 'polygon' && zone.polygonPoints.length >= 3) {
      return `L.polygon(${pointArray(zone.polygonPoints)}, {
        color: '#0F766E',
        fillColor: '#CCFBF1',
        fillOpacity: 0.32,
        weight: 3
      }).addTo(map)
      .bindPopup('<div class="popup"><b>${name}</b><span>면적 구역</span><span>제한속도: ${zone.speedLimitKmh}km/h</span></div>');`;
    }
    return `L.circle([${zone.latitude}, ${zone.longitude}], {
      radius: ${zone.radiusM},
      color: '#DC2626',
      fillColor: '#FEF2F2',
      fillOpacity: 0.25,
      weight: 2
    }).addTo(map)
    .bindPopup('<div class="popup"><b>${name}</b><span>원형 구역</span><span>제한속도: ${zone.speedLimitKmh}km/h</span><span>반경: ${Math.round(zone.radiusM)}m</span></div>');`;
  }).join('\n');

  const draftPointsJson = JSON.stringify(polygonDraft.map((point) => ({ latitude: point.latitude, longitude: point.longitude })));

  const postMessageJs = `
    function postRaw(msg) {
      var text = JSON.stringify(msg);
      if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(text); }
      else { window.parent.postMessage(text, '*'); }
    }
    function postToApp(type, latlng) {
      postRaw({ type: type, lat: latlng.lat, lng: latlng.lng });
    }
    function postPolygon(points) {
      postRaw({ type: 'polygonChange', points: points });
    }
  `;

  const selectionJs = zoneAddMode
    ? `
      var selectionMode = '${selectionMode}';
      var draftPoints = ${draftPointsJson};
      var draftLayer = L.layerGroup().addTo(map);

      function drawDraft() {
        draftLayer.clearLayers();
        var latLngs = draftPoints.map(function(point) { return [point.latitude, point.longitude]; });
        if (latLngs.length >= 2) {
          L.polyline(latLngs, { color: '#2563EB', weight: 3, dashArray: '6,6' }).addTo(draftLayer);
        }
        if (latLngs.length >= 3) {
          L.polygon(latLngs, { color: '#2563EB', fillColor: '#DBEAFE', fillOpacity: 0.24, weight: 2 }).addTo(draftLayer);
        }
        latLngs.forEach(function(point, index) {
          L.circleMarker(point, { radius: 8, color: '#2563EB', fillColor: '#FFFFFF', fillOpacity: 1, weight: 3 })
            .addTo(draftLayer)
            .bindTooltip(String(index + 1), { permanent: true, direction: 'center', className: 'vertex-label' });
        });
      }
      drawDraft();

      map.on('click', function(e) {
        if (selectionMode === 'polygon') {
          draftPoints.push({ latitude: e.latlng.lat, longitude: e.latlng.lng });
          drawDraft();
          postPolygon(draftPoints);
        } else {
          postToApp('mapTap', e.latlng);
        }
      });
      document.getElementById('use-center').addEventListener('click', function() {
        postToApp('mapCenter', map.getCenter());
      });
    `
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
    html, body, #map { width: 100%; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    body { background: #E8EEF6; }
    .leaflet-container { touch-action: pan-x pan-y; }
    .floating-note {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      z-index: 1000; background: #FFFFFF; padding: 16px 18px; border-radius: 14px;
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.16); text-align: center; pointer-events: none;
      display: flex; flex-direction: column; gap: 4px; min-width: 220px;
    }
    .floating-note strong { font-size: 15px; color: #0F172A; }
    .floating-note span { font-size: 12px; color: #64748B; line-height: 1.4; }
    .add-hint {
      position: absolute; top: 12px; left: 12px; right: 12px; z-index: 1000;
      background: rgba(15, 23, 42, 0.9); color: #fff; padding: 10px 12px; border-radius: 12px;
      font-size: 12px; font-weight: 800; line-height: 1.35; box-shadow: 0 10px 24px rgba(15,23,42,0.24);
      pointer-events: none;
    }
    .center-pin {
      position: absolute; left: 50%; top: 50%; z-index: 999; width: 26px; height: 26px;
      margin-left: -13px; margin-top: -13px; border-radius: 999px; border: 3px solid #2563EB;
      box-shadow: 0 0 0 5px rgba(37,99,235,0.14); pointer-events: none;
    }
    .center-pin:after {
      content: ''; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px;
      margin-left: -3px; margin-top: -3px; border-radius: 999px; background: #2563EB;
    }
    #use-center {
      position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 1000;
      border: 0; background: #2563EB; color: #fff; padding: 12px 18px; border-radius: 999px;
      font-size: 13px; font-weight: 900; box-shadow: 0 12px 26px rgba(37,99,235,0.28);
    }
    .vertex-label {
      background: #2563EB; border: 0; border-radius: 999px; color: #fff; font-size: 11px; font-weight: 900;
      box-shadow: none;
    }
    .popup { min-width: 150px; display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #475569; }
    .popup b { color: #0F172A; font-size: 14px; }
    .popup .blue { color: #2563EB; font-weight: 800; }
  </style>
</head>
<body>
  <div id="map"></div>
  ${emptyStateHtml}
  ${addModeHtml}
  <script>
    var map = L.map('map', { zoomControl: true, tap: false, doubleClickZoom: false }).setView(${center}, ${zoom});
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
    ${postMessageJs}
    ${selectionJs}
  </script>
</body>
</html>`;
}
