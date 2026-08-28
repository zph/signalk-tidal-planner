def ais_rules:
  [
    {"allow": true, "path": "^navigation\\.position$", "source": ""},
    {"allow": true, "path": "^navigation\\.courseOverGroundTrue$", "source": ""},
    {"allow": true, "path": "^navigation\\.speedOverGround$", "source": ""},
    {"allow": true, "path": "^name$", "source": ""},
    {"allow": true, "path": "^design\\.aisShipType$", "source": ""},
    {"allow": true, "path": "^communication\\.callsignVhf$", "source": ""},
    {"allow": true, "path": "^design\\.length$", "source": ""},
    {"allow": false, "path": ".*", "source": ""}
  ];

if any(.configuration.influxes[]; .bucket == "ais") then
  .
else
  .configuration.influxes += [
    .configuration.influxes[0]
    | .bucket = "ais"
    | .token = $aisWriteToken
    | .onlySelf = false
    | .resolution = 5000
    | .useSKTimestamp = true
    | .filteringRules = ais_rules
    | .ignoredPaths = []
    | .ignoredSources = []
    | .ignoredValues = []
  ]
end
