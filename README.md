# Tide window planner

A dependency-free HTML planner using NOAA station **9414290 (San Francisco, CA)** as its initial example. It charts 6-minute tide predictions, highlights water at or above a configurable threshold (4.0 ft by default), and finds the longest daylight outing:

- returning within the same above-threshold tide period; and
- returning during the immediately following above-threshold tide period.

For each result it shows the full usable departure and return ranges, plus the earliest departure and latest return that produce the maximum outing.

The default view is one day. Use the arrow buttons beside the date to paginate backward or forward one day at a time; the chart and results update together. The span control can expand the view to 3, 7, 14, or 30 days.

## Run it

Browsers can restrict API requests from a `file://` page, so serve the directory locally:

```sh
make
```

Then open <http://localhost:8000>.

To use another port, run `make PORT=9000`.

There is no package install, build step, Node.js, or server-side code. Tide data is fetched directly from NOAA in the browser. Sunrise and sunset are calculated locally using NOAA's fractional-year solar approximation.

## Interpretation

- Tide height is in feet relative to **Mean Lower Low Water (MLLW)**.
- “Daylight” means sunrise through sunset in Pacific local time.
- For the “next high tide” result, the entire outing must fit between sunrise and sunset; it crosses exactly one below-threshold tide period.
- This is a planning aid, not a clearance guarantee. Weather, river flow, waves, vessel draft, and local conditions matter.
