const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const radarDir = path.join(__dirname, '..', 'grafana', 'ais-radar');
const dashboard = JSON.parse(fs.readFileSync(path.join(radarDir, 'dashboard.json'), 'utf8'));
const radar = dashboard.panels.find((panel) => panel.id === 1);

test('keeps the minimum two stable marker buffers across live data refreshes', () => {
  const markerLayers = radar.options.layers.filter((layer) => layer.type === 'markers');
  const targetQueries = radar.targets.filter((target) => ['A', 'S', 'O'].includes(target.refId));

  assert.equal(dashboard.refresh, '10s');
  assert.equal(radar.options.view.id, 'coords');
  assert.equal(radar.options.view.dashboardVariable, undefined);
  assert.equal(markerLayers.length, 2);
  assert.equal(markerLayers[0].name, 'Underway and own ship');
  assert.equal(markerLayers[0].filterData.options, 'A');
  assert.equal(markerLayers[0].config.style.opacity, 0.95);
  assert.equal(markerLayers[1].name, 'Anchored AIS targets');
  assert.equal(markerLayers[1].filterData.options, 'S');
  assert.equal(markerLayers[1].config.style.opacity, 0.5);
  assert.deepEqual(targetQueries.map((target) => target.refId), ['A', 'S']);
});

test('classifies stationary targets from both SOG and observed position over 120 seconds', () => {
  const source = fs.readFileSync(path.join(radarDir, 'target-markers.flux'), 'utf8');
  const underway = radar.targets.find((target) => target.refId === 'A').query;
  const anchored = radar.targets.find((target) => target.refId === 'S').query;

  assert.match(source, /stationaryWindow = 2m/);
  assert.match(source, /movingSpeedMps = 0\.257222/);
  assert.match(source, /movingDistanceNM = 0\.01/);
  assert.match(source, /stationary = not r\.speedMoving and not r\.positionMoving/);
  assert.match(source, /projectedNM = if r\.hasSog and sogAge <= 120\.0 and not stationary/);
  assert.match(source, /union\(tables: \[targetMarkers, ownMarker\]\)/);
  assert.match(source, /r\.self == "true" and not stationaryOnly/);
  assert.equal(underway, source.replace('__STATIONARY_ONLY__', 'false'));
  assert.equal(anchored, source.replace('__STATIONARY_ONLY__', 'true'));
});

test('uses a visible anchor cutout inside the stationary boat silhouette', () => {
  const icon = fs.readFileSync(path.join(radarDir, 'ais-boat-anchored.svg'), 'utf8');

  assert.match(icon, /mask id="anchor-cutout"/);
  assert.match(icon, /circle cx="16" cy="17"/);
  assert.match(icon, /M14\.5 19h3v13\.5/);
});
