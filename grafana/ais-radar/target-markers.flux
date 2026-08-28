import "date"
import "math"
import "strings"

stationaryOnly = __STATIONARY_ONLY__
stationaryWindow = 2m
movingSpeedMps = 0.257222
movingDistanceNM = 0.01

positionHistory = from(bucket: "ais")
  |> range(start: -60m)
  |> filter(fn: (r) => r._measurement == "navigation.position" and (r._field == "lat" or r._field == "lon"))
  |> pivot(rowKey: ["_time", "context"], columnKey: ["_field"], valueColumn: "_value")
  |> filter(fn: (r) => exists r.lat and exists r.lon)
  |> map(fn: (r) => ({
    context: r.context,
    sampleTime: r._time,
    sampleLat: r.lat,
    sampleLon: r.lon,
    self: if exists r.self then r.self else "false"
  }))

positions = positionHistory
  |> group(columns: ["context"])
  |> sort(columns: ["sampleTime"], desc: true)
  |> limit(n: 1)
  |> rename(columns: {sampleTime: "positionTime", sampleLat: "lat", sampleLon: "lon"})

positionMotionFallback = positions
  |> map(fn: (r) => ({context: r.context, positionMoving: true, positionPriority: 0}))

positionMotionDetected = join(tables: {
    sample: positionHistory,
    latest: positions |> keep(columns: ["context", "positionTime", "lat", "lon"])
  }, on: ["context"])
  |> filter(fn: (r) => uint(v: r.positionTime) >= uint(v: r.sampleTime) + uint(v: 120000000000))
  |> group(columns: ["context"])
  |> sort(columns: ["sampleTime"], desc: true)
  |> limit(n: 1)
  |> map(fn: (r) => {
    northNM = (r.lat - r.sampleLat) * 60.0
    eastNM = (r.lon - r.sampleLon) * 60.0 * math.cos(x: r.lat * math.pi / 180.0)
    distanceNM = math.sqrt(x: northNM * northNM + eastNM * eastNM)
    return {context: r.context, positionMoving: distanceNM >= movingDistanceNM, positionPriority: 1}
  })

positionMotion = union(tables: [positionMotionFallback, positionMotionDetected])
  |> group(columns: ["context"])
  |> sort(columns: ["positionPriority"], desc: true)
  |> limit(n: 1)

courseFallback = positions
  |> map(fn: (r) => ({context: r.context, cog: 0.0, motionPriority: 0}))

courseReports = from(bucket: "ais")
  |> range(start: -60m)
  |> filter(fn: (r) => r._measurement == "navigation.courseOverGroundTrue" and r._field == "value")
  |> group(columns: ["context"])
  |> last()
  |> map(fn: (r) => ({context: r.context, cog: float(v: r._value), motionPriority: 1}))

courses = union(tables: [courseFallback, courseReports])
  |> group(columns: ["context"])
  |> sort(columns: ["motionPriority"], desc: true)
  |> limit(n: 1)

speedFallback = positions
  |> map(fn: (r) => ({context: r.context, sog: 0.0, sogTime: r.positionTime, hasSog: false, motionPriority: 0}))

speedReports = from(bucket: "ais")
  |> range(start: -60m)
  |> filter(fn: (r) => r._measurement == "navigation.speedOverGround" and r._field == "value")
  |> group(columns: ["context"])
  |> last()
  |> map(fn: (r) => ({context: r.context, sog: float(v: r._value), sogTime: r._time, hasSog: true, motionPriority: 1}))

speeds = union(tables: [speedFallback, speedReports])
  |> group(columns: ["context"])
  |> sort(columns: ["motionPriority"], desc: true)
  |> limit(n: 1)

recentSpeedFallback = positions
  |> map(fn: (r) => ({context: r.context, speedMoving: false, motionPriority: 0}))

recentMovingSpeeds = from(bucket: "ais")
  |> range(start: date.sub(d: stationaryWindow, from: now()))
  |> filter(fn: (r) => r._measurement == "navigation.speedOverGround" and r._field == "value" and float(v: r._value) >= movingSpeedMps)
  |> group(columns: ["context"])
  |> last()
  |> map(fn: (r) => ({context: r.context, speedMoving: true, motionPriority: 1}))

recentSpeedMotion = union(tables: [recentSpeedFallback, recentMovingSpeeds])
  |> group(columns: ["context"])
  |> sort(columns: ["motionPriority"], desc: true)
  |> limit(n: 1)

identityFallback = positions
  |> map(fn: (r) => ({context: r.context, callsign: "", identityPriority: 0}))

callsigns = from(bucket: "ais")
  |> range(start: -7d)
  |> filter(fn: (r) => r._measurement == "communication.callsignVhf" and r._field == "value")
  |> group(columns: ["context"])
  |> last()
  |> map(fn: (r) => ({context: r.context, callsign: string(v: r._value), identityPriority: 1}))

identities = union(tables: [identityFallback, callsigns])
  |> group(columns: ["context"])
  |> sort(columns: ["identityPriority"], desc: true)
  |> limit(n: 1)

withCourse = join(tables: {p: positions, c: courses}, on: ["context"])
withSpeed = join(tables: {p: withCourse, s: speeds}, on: ["context"])
withPositionMotion = join(tables: {p: withSpeed, m: positionMotion}, on: ["context"])
withMotion = join(tables: {p: withPositionMotion, m: recentSpeedMotion}, on: ["context"])
withIdentity = join(tables: {p: withMotion, i: identities}, on: ["context"])

own = withSpeed
  |> filter(fn: (r) => r.self == "true")
  |> map(fn: (r) => ({joinKey: "own", ownLat: r.lat, ownLon: r.lon}))
  |> limit(n: 1)

targets = withIdentity
  |> filter(fn: (r) => r.self != "true")
  |> map(fn: (r) => ({r with joinKey: "own"}))

targetMarkers = join(tables: {t: targets, o: own}, on: ["joinKey"])
  |> map(fn: (r) => {
    age = float(v: uint(v: now()) - uint(v: r.positionTime)) / 1000000000.0
    sogAge = float(v: uint(v: now()) - uint(v: r.sogTime)) / 1000000000.0
    stationary = not r.speedMoving and not r.positionMoving
    projectedAge = if age > 60.0 then 60.0 else if age < 0.0 then 0.0 else age
    projectedNM = if r.hasSog and sogAge <= 120.0 and not stationary then r.sog * projectedAge / 1852.0 else 0.0
    latitude = r.lat + projectedNM * math.cos(x: r.cog) / 60.0
    longitude = r.lon + projectedNM * math.sin(x: r.cog) / (60.0 * math.cos(x: r.ownLat * math.pi / 180.0))
    northNM = (latitude - r.ownLat) * 60.0
    eastNM = (longitude - r.ownLon) * 60.0 * math.cos(x: r.ownLat * math.pi / 180.0)
    rangeNM = math.sqrt(x: northNM * northNM + eastNM * eastNM)
    risk = if rangeNM <= float(v: ${danger_nm}) then 2.0 else if rangeNM <= float(v: ${warning_nm}) then 1.0 else 0.0
    ageBand = if age <= 180.0 then 0.0 else if age <= 900.0 then 1.0 else if age <= 1800.0 then 2.0 else 3.0
    fallbackMMSI = strings.replaceAll(v: r.context, t: "vessels.urn:mrn:imo:mmsi:", u: "")
    return {
      _time: r.positionTime,
      Latitude: latitude,
      Longitude: longitude,
      Label: if r.callsign != "" then r.callsign else fallbackMMSI,
      Course: r.cog * 180.0 / math.pi,
      SpeedKnots: r.sog * 1.9438444924,
      RangeNM: rangeNM,
      AgeMinutes: age / 60.0,
      Risk: risk,
      Stationary: stationary,
      ColorLevel: risk * 4.0 + ageBand
    }
  })
  |> filter(fn: (r) => r.Stationary == stationaryOnly and r.RangeNM <= float(v: ${range_nm}))

ownMarker = withSpeed
  |> filter(fn: (r) => r.self == "true" and not stationaryOnly)
  |> limit(n: 1)
  |> map(fn: (r) => ({
    _time: r.positionTime,
    Latitude: r.lat,
    Longitude: r.lon,
    Label: "OWN SHIP",
    Course: r.cog * 180.0 / math.pi,
    SpeedKnots: r.sog * 1.9438444924,
    RangeNM: 0.0,
    AgeMinutes: float(v: uint(v: now()) - uint(v: r.positionTime)) / 60000000000.0,
    Risk: 0.0,
    Stationary: false,
    ColorLevel: 12.0
  }))

union(tables: [targetMarkers, ownMarker])
  |> group()
