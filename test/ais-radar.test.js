const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const radarDir = path.join(__dirname, '..', 'grafana', 'ais-radar');
const dashboard = JSON.parse(fs.readFileSync(path.join(radarDir, 'dashboard.json'), 'utf8'));
const radar = dashboard.panels.find((panel) => panel.id === 1);

test('splits underway and anchored AIS targets into distinct marker layers', () => {
  const underway = radar.options.layers.find((layer) => layer.name === 'Underway AIS targets');
  const anchored = radar.options.layers.find((layer) => layer.name === 'Anchored AIS targets');

  assert.equal(underway.filterData.options, 'A');
  assert.equal(underway.config.style.symbol.fixed, '/public/img/icons/marker/ais-boat.svg');
  assert.equal(underway.config.style.opacity, 0.95);
  assert.equal(anchored.filterData.options, 'S');
  assert.equal(anchored.config.style.symbol.fixed, '/public/img/icons/marker/ais-boat-anchored.svg');
  assert.equal(anchored.config.style.opacity, 0.5);
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
  assert.equal(underway, source.replace('__STATIONARY_ONLY__', 'false'));
  assert.equal(anchored, source.replace('__STATIONARY_ONLY__', 'true'));
});

test('uses a visible anchor cutout inside the stationary boat silhouette', () => {
  const icon = fs.readFileSync(path.join(radarDir, 'ais-boat-anchored.svg'), 'utf8');

  assert.match(icon, /mask id="anchor-cutout"/);
  assert.match(icon, /circle cx="16" cy="17"/);
  assert.match(icon, /M14\.5 19h3v13\.5/);
});
