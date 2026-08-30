(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TripPlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EARTH_RADIUS_NM = 3440.065;
  const WALKABLE_NM = 1;
  const DEPTH_KEYS = {
    entrance: ['depth:entrance', 'entrance:depth', 'seamark:harbour:minimum_depth'],
    guest: ['depth:guest', 'depth:transient', 'guest_dock:depth'],
    fuel: ['depth:fuel', 'fuel_dock:depth']
  };
  const SERVICES = {
    fuel: ['fuel', 'service:fuel'], pumpout: ['pump_out', 'pumpout', 'sanitary_dump_station'],
    water: ['drinking_water', 'water_point', 'service:water'], power: ['power_supply', 'electricity', 'shore_power'],
    repairs: ['repair', 'boat_repair', 'service:repair'], showers: ['shower', 'showers'],
    laundry: ['laundry'], groceries: [], lodging: ['lodging', 'hotel']
  };

  const radians = value => value * Math.PI / 180;
  const degrees = value => value * 180 / Math.PI;

  function distanceNm(a, b) {
    const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function bearing(a, b) {
    const lat1 = radians(a.latitude), lat2 = radians(b.latitude), dLon = radians(b.longitude - a.longitude);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (degrees(Math.atan2(y, x)) + 360) % 360;
  }

  function compass(deg) {
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
  }

  function numberFromTag(value) {
    if (value == null || value === '') return null;
    const match = String(value).trim().match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    let amount = Number(match[0]);
    // OpenStreetMap depth values default to metres unless an explicit unit is present.
    if (!/ft|feet|foot/i.test(value)) amount *= 3.28084;
    return Number.isFinite(amount) ? amount : null;
  }

  function firstTag(tags, keys) {
    for (const key of keys) if (tags[key] != null && tags[key] !== '') return { key, value: tags[key] };
    return null;
  }

  function depthRecord(tags, location) {
    const found = firstTag(tags, DEPTH_KEYS[location]);
    if (!found) return { status: 'unknown', feet: null, datum: null, source: null, observed: null };
    const feet = numberFromTag(found.value);
    const datum = tags[`${found.key}:datum`] || tags['depth:datum'] || null;
    const source = tags[`${found.key}:source`] || tags['depth:source'] || tags.source || null;
    const observed = tags[`${found.key}:date`] || tags['depth:date'] || tags.check_date || null;
    return {
      status: feet == null ? 'unknown' : (datum && source ? 'reported' : 'verify'),
      feet, datum, source, observed, original: String(found.value)
    };
  }

  function truthyTag(value) {
    return value != null && !['', 'no', 'false', '0', 'none'].includes(String(value).toLowerCase());
  }

  function servicesFromTags(tags) {
    const result = {};
    for (const [service, keys] of Object.entries(SERVICES)) result[service] = keys.some(key => truthyTag(tags[key]));
    if (['supermarket', 'convenience', 'grocery'].includes(tags.shop)) result.groceries = true;
    if (tags.shop === 'laundry') result.laundry = true;
    if (['hotel', 'motel', 'hostel', 'guest_house'].includes(tags.tourism)) result.lodging = true;
    return result;
  }

  function coordinates(element) {
    const point = element.center || element;
    return { latitude: Number(point.lat), longitude: Number(point.lon) };
  }

  function osmUrl(element) {
    return `https://www.openstreetmap.org/${element.type}/${element.id}`;
  }

  function isEatery(tags) {
    return ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream'].includes(tags.amenity);
  }

  function isMarina(element) { return element.tags?.leisure === 'marina'; }

  function normalizeOverpass(elements, origin, fetchedAt) {
    const facilities = elements.filter(element => !isMarina(element) && Number.isFinite(coordinates(element).latitude));
    return elements.filter(isMarina).map(element => {
      const tags = element.tags || {}, point = coordinates(element);
      const nearby = facilities.map(facility => ({ facility, distance: distanceNm(point, coordinates(facility)) }))
        .filter(item => item.distance <= WALKABLE_NM).sort((a, b) => a.distance - b.distance);
      const services = servicesFromTags(tags);
      const marinaPlace = { name: tags.name || 'Marina', distanceNm: 0, sourceUrl: osmUrl(element) };
      const servicePlaces = {};
      for (const [name, present] of Object.entries(services)) if (present) servicePlaces[name] = [marinaPlace];
      const addServicePlace = (name, item) => {
        services[name] = true;
        (servicePlaces[name] ||= []).push({
          name: item.facility.tags?.name || name, distanceNm: item.distance, sourceUrl: osmUrl(item.facility)
        });
      };
      for (const item of nearby) {
        const nearbyServices = servicesFromTags(item.facility.tags || {});
        for (const [name, present] of Object.entries(nearbyServices)) if (present) addServicePlace(name, item);
        if (item.facility.tags?.amenity === 'fuel') addServicePlace('fuel', item);
        if (item.facility.tags?.amenity === 'sanitary_dump_station') addServicePlace('pumpout', item);
        if (item.facility.tags?.amenity === 'shower') addServicePlace('showers', item);
      }
      const eateries = nearby.filter(item => isEatery(item.facility.tags || {})).slice(0, 3).map(item => ({
        name: item.facility.tags.name || item.facility.tags.amenity.replace('_', ' '), distanceNm: item.distance, sourceUrl: osmUrl(item.facility)
      }));
      const onsiteEatery = isEatery(tags) || truthyTag(tags.restaurant) || truthyTag(tags.cafe);
      return {
        id: `${element.type}/${element.id}`, name: tags.name || 'Unnamed marina', ...point,
        distanceNm: distanceNm(origin, point), bearing: bearing(origin, point),
        depths: { entrance: depthRecord(tags, 'entrance'), guest: depthRecord(tags, 'guest'), fuel: depthRecord(tags, 'fuel') },
        services, servicePlaces, food: { onsite: onsiteEatery, nearby: eateries },
        phone: tags['contact:phone'] || tags.phone || '', website: tags['contact:website'] || tags.website || '',
        vhf: tags['contact:vhf'] || tags.vhf || '', sourceUrl: osmUrl(element),
        sourceName: 'OpenStreetMap contributors', sourceDate: element.timestamp || fetchedAt, tags
      };
    });
  }

  function sortMarinas(marinas, sortBy) {
    const copy = [...marinas];
    if (sortBy === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'depth') return copy.sort((a, b) => (b.depths.guest.feet ?? -Infinity) - (a.depths.guest.feet ?? -Infinity));
    return copy.sort((a, b) => a.distanceNm - b.distanceNm);
  }

  function isoDay(value) {
    if (!value) return null;
    if (/^\d{8}$/.test(String(value))) return `${String(value).slice(0, 4)}-${String(value).slice(4, 6)}-${String(value).slice(6, 8)}`;
    const date = new Date(Number(value));
    return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
  }

  function summarizeUsace(features) {
    const rows = (features || []).map(feature => feature.attributes || feature.properties || {})
      .filter(row => Number.isFinite(Number(row.min_depth_ft ?? row.geo_depth_ft)));
    if (!rows.length) return null;
    const latestTime = Math.max(...rows.map(row => Number(row.geo_datetimestamp) || 0));
    const latest = rows.filter(row => (Number(row.geo_datetimestamp) || 0) === latestTime);
    const shallowest = Math.min(...latest.map(row => Number(row.min_depth_ft ?? row.geo_depth_ft)));
    const surveyIds = [...new Set(latest.map(row => row.surveyid).filter(Boolean))];
    const authorized = latest.map(row => Number(row.geo_depthauthorized_ft)).find(Number.isFinite);
    const maintained = latest.map(row => Number(row.geo_depthmaintained_ft)).find(Number.isFinite);
    const sampleCount = latest.reduce((sum, row) => sum + (Number(row.sample_count) || 1), 0);
    return {
      kind: 'usace', feet: shallowest, date: isoDay(latestTime), datum: 'Survey-specific reference datum',
      surveyIds, authorized, maintained, sampleCount,
      sourceName: 'USACE eHydro',
      sourceUrl: 'https://spatial.usace.army.mil/opjarcgis/rest/services/ehydro/RecentSurveyBins/FeatureServer/0'
    };
  }

  function summarizeEnc(features, band, sourceUrl) {
    const rows = (features || []).map(feature => feature.attributes || feature.properties || {})
      .filter(row => Number.isFinite(Number(row.Z)) && Number(row.Z) >= 0);
    if (!rows.length) return null;
    const depths = rows.map(row => Number(row.Z) * 3.28084);
    const dates = rows.map(row => isoDay(row.SORDAT)).filter(Boolean).sort();
    const cells = [...new Set(rows.map(row => row.DSNM).filter(Boolean))];
    return {
      kind: 'noaa-enc', minFeet: Math.min(...depths), maxFeet: Math.max(...depths), count: depths.length,
      date: dates.at(-1) || null, datum: 'ENC chart datum', band, cells,
      sourceName: 'NOAA ENC Direct to GIS', sourceUrl
    };
  }

  function encThumbnailUrl(layerUrl, point, radiusNm = 0.5, size = '640,320') {
    const latitudeDelta = radiusNm / 60.04;
    const longitudeDelta = radiusNm / (60.04 * Math.max(.2, Math.cos(radians(point.latitude))));
    const bbox = [point.longitude - longitudeDelta, point.latitude - latitudeDelta, point.longitude + longitudeDelta, point.latitude + latitudeDelta];
    const serviceUrl = String(layerUrl).replace(/\/\d+\/?$/, '');
    const query = new URLSearchParams({
      bbox: bbox.join(','), bboxSR: '4326', imageSR: '4326', size,
      dpi: '96', format: 'png32', transparent: 'false', f: 'image'
    });
    return `${serviceUrl}/export?${query}`;
  }

  return { WALKABLE_NM, SERVICES, distanceNm, bearing, compass, normalizeOverpass, sortMarinas, summarizeUsace, summarizeEnc, encThumbnailUrl };
});
