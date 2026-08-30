const test = require('node:test');
const assert = require('node:assert/strict');
const Trips = require('../public/trips.js');

test('calculates nautical-mile distance and bearing', () => {
  const start = { latitude: 47.6, longitude: -122.34 };
  const north = { latitude: 48.6, longitude: -122.34 };
  assert.ok(Math.abs(Trips.distanceNm(start, north) - 60.04) < 0.1);
  assert.ok(Trips.bearing(start, north) < 0.01);
  assert.equal(Trips.compass(359), 'N');
});

test('normalizes marinas without inventing missing depths', () => {
  const origin = { latitude: 47.6, longitude: -122.34 };
  const marinas = Trips.normalizeOverpass([{
    type: 'node', id: 1, lat: 47.61, lon: -122.34,
    timestamp: '2026-08-01T00:00:00Z',
    tags: { leisure: 'marina', name: 'Safe Harbor', fuel: 'yes', 'depth:entrance': '3 m', 'depth:entrance:datum': 'MLLW', 'depth:entrance:source': 'Harbormaster', 'depth:fuel': '2' }
  }], origin, '2026-08-21T00:00:00Z');

  assert.equal(marinas.length, 1);
  assert.equal(marinas[0].services.fuel, true);
  assert.equal(marinas[0].servicePlaces.fuel[0].sourceUrl, 'https://www.openstreetmap.org/node/1');
  assert.ok(Math.abs(marinas[0].depths.entrance.feet - 9.84252) < 0.0001);
  assert.equal(marinas[0].depths.entrance.status, 'reported');
  assert.equal(marinas[0].depths.guest.status, 'unknown');
  assert.equal(marinas[0].depths.guest.feet, null);
  assert.ok(Math.abs(marinas[0].depths.fuel.feet - 6.56168) < 0.0001, 'unitless OSM depths default to metres');
});

test('associates walkable food and services with a marina', () => {
  const origin = { latitude: 47.6, longitude: -122.34 };
  const result = Trips.normalizeOverpass([
    { type: 'node', id: 1, lat: 47.6, lon: -122.34, tags: { leisure: 'marina', name: 'Port' } },
    { type: 'node', id: 2, lat: 47.601, lon: -122.34, tags: { amenity: 'restaurant', name: 'Dock Cafe' } },
    { type: 'node', id: 3, lat: 47.602, lon: -122.34, tags: { amenity: 'shower' } }
  ], origin, '2026-08-21T00:00:00Z')[0];

  assert.equal(result.food.nearby[0].name, 'Dock Cafe');
  assert.equal(result.services.showers, true);
  assert.equal(result.servicePlaces.showers[0].sourceUrl, 'https://www.openstreetmap.org/node/3');
});

test('summarizes only the latest USACE survey bins', () => {
  const result = Trips.summarizeUsace([
    { attributes: { surveyid: 'old', geo_datetimestamp: 1609459200000, min_depth_ft: 4, sample_count: 10 } },
    { attributes: { surveyid: 'new-a', geo_datetimestamp: 1726272000000, min_depth_ft: 14.9, sample_count: 20, geo_depthauthorized_ft: 16 } },
    { attributes: { surveyid: 'new-b', geo_datetimestamp: 1726272000000, min_depth_ft: 15.1, sample_count: 3, geo_depthauthorized_ft: 16 } }
  ]);

  assert.equal(result.feet, 14.9);
  assert.equal(result.date, '2024-09-14');
  assert.equal(result.sampleCount, 23);
  assert.deepEqual(result.surveyIds, ['new-a', 'new-b']);
});

test('summarizes NOAA ENC sounding range in feet', () => {
  const result = Trips.summarizeEnc([
    { attributes: { Z: 0.3, SORDAT: '19990501', DSNM: 'US5OAKFG.000' } },
    { attributes: { Z: 6, SORDAT: '20040211', DSNM: 'US5OAKFG.000' } }
  ], 'harbour', 'https://example.test/noaa');

  assert.ok(Math.abs(result.minFeet - 0.984252) < 0.0001);
  assert.ok(Math.abs(result.maxFeet - 19.68504) < 0.0001);
  assert.equal(result.date, '2004-02-11');
  assert.equal(result.count, 2);
});

test('builds a NOAA ENC chart thumbnail centered on a marina', () => {
  const url = new URL(Trips.encThumbnailUrl(
    'https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_harbour/MapServer/76',
    { latitude: 37.807, longitude: -122.432 }
  ));

  assert.equal(url.pathname.endsWith('/enc_harbour/MapServer/export'), true);
  assert.equal(url.searchParams.get('size'), '640,320');
  const [west, south, east, north] = url.searchParams.get('bbox').split(',').map(Number);
  assert.ok(west < -122.432 && east > -122.432);
  assert.ok(south < 37.807 && north > 37.807);
});
