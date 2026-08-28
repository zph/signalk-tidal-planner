# AIS Radar Watch dashboard

This directory contains the reproducible Grafana dashboard and Signal K writer patch for the
`AIS Radar Watch` cabin display.

The dashboard uses only Grafana's built-in Geomap, Stat, and Text panels. It displays AIS vessels
as course-oriented boat silhouettes on an intentionally blank radar background, with nautical-mile range
rings and configurable thresholds:

- normal: green
- at or inside `warning_nm` (default `0.5` NM): amber
- at or inside `danger_nm` (default `0.1` NM): red

The position query projects each vessel from its last fix using its latest COG and SOG. Projection
is capped at 60 seconds. Targets remain visible for 60 minutes after their last position fix and
progressively dim after 3, 15, and 30 minutes. Labels prefer the latest VHF callsign in the bucket
and fall back to the bare MMSI. The dashboard refreshes every 10 seconds without resetting a
manually selected zoom or pan position. Moving targets with a position, course, and speed report in
the last two minutes also show a bright cyan, arrow-ended 10-minute course vector. Vectors are hidden
below 0.5 knots so stationary targets do not produce distracting direction artifacts.

A target becomes stationary only after a full 120-second observation baseline contains neither a
SOG report at or above 0.5 knots nor at least 0.01 NM of observed position displacement. Stationary
targets use the boat-with-anchor symbol at 50 percent opacity. Each ten-second refresh reevaluates
the state, so a qualifying SOG report or observed movement immediately restores the normal boat
symbol and opacity.

The right column includes current depth below the transducer, converted explicitly from meters to
feet (`m * 3.280839895`), rounded to an integer, and backed by a 30-minute sparkline. The query uses
`createEmpty: true` and never fills missing samples, so outages remain visible as gaps.

## Data isolation

Do not change the existing `signalk` writer from `onlySelf: true`. AIS targets belong in a separate
`ais` bucket with short retention so adding external vessel contexts does not pollute the boat's
permanent self-history bucket.

Create the bucket with seven-day retention using an Influx administrator token:

```sh
influx bucket create \
  --host http://127.0.0.1:8086 \
  --org boat \
  --name ais \
  --retention 168h \
  --token "$INFLUX_ADMIN_TOKEN"
```

Create a scoped writer authorization for the new bucket, then apply `add-ais-output.jq` to a copy of
`~/.signalk/plugin-config-data/signalk-to-influxdb2.json` and submit the complete result to Signal
K's authenticated `POST /skServer/plugins/signalk-to-influxdb2/config` endpoint. Pass the token to
jq as `--arg aisWriteToken "$AIS_WRITE_TOKEN"`. The generated second output disables `onlySelf`,
samples at five seconds, and uses a final deny rule so only position, COG, SOG, name, AIS type,
callsign, and length are written. The token is intentionally supplied at deploy time and is never
stored in this repository.

The `signalk-to-influxdb2` plugin resolves organization, bucket, and DBRP metadata during startup.
Its least-privilege authorization therefore needs read access to the `boat` organization, the
`ais` bucket, and the organization's DBRP mappings in addition to write access to the `ais` bucket.
It does not need read access to vessel measurements. Create the `ais` DBRP mapping before enabling
the output.

## Grafana provisioning

Install `provisioning.yaml` under `/etc/grafana/provisioning/dashboards/`, `dashboard.json` under
`/var/lib/grafana/boat-dashboards/`, and both `ais-boat.svg` and `ais-boat-anchored.svg` under
`/usr/share/grafana/public/img/icons/marker/`, all owned by `grafana:grafana`. The provider places
the dashboard in the existing `Boat Operations` folder and polls the JSON every ten seconds.
Grafana UI edits are allowed, but any later file change becomes authoritative again.

The dashboard expects the existing Signal K datasource UID `afw2gu6ucbnk0f` to have read-only
access to both buckets. On the Pi this is maintained by a root-owned Grafana datasource provisioning
file whose token is generated at deploy time and is never stored here.

- `ais`: filtered external and self navigation data, seven-day retention
- `signalk`: existing self-only history, used by the depth panel
