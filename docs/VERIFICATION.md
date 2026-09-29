# Verification — what is checked, and against what

This app tells people things about an aircraft. Each of the three pieces below is
checked against something independent of itself. None of them needs a browser.

Node 24 runs the TypeScript in `lib/` directly, which is why those files carry `.ts` on
their imports and use no enums.

## 1. The log reader — against pyulog
`lib/ulog/parser.ts` is compared, field by field, with **pyulog** (the PX4 project's own
Python reader) on real logs.

```bash
npm run verify:ulog
```
That compares against `scripts/ulog-reference.json`, which holds pyulog's numbers for the
project's eleven logs, so the check runs without Python. After adding logs, write the
reference again with a Python that has pyulog:
```bash
python scripts/pyulog_reference.py ../logs scripts/ulog-reference.json
```
For every topic and every field: the number of samples, the count of non-finite values,
the sum, the first and the last value. Also parameters, logged messages, dropouts and the
information block. On 2026-09-29, on the project's eleven logs: **25,790 fields, 0 failures.**

Three differences are conventions, handled in the script and stated here:
- pyulog keeps the padding bytes of nested messages as fields; this reader drops them.
- pyulog reads `bool` as a signed byte; this reader reads it unsigned. An uninitialised
  flag holding 164 reads as −92 there.
- Both count time from the moment logging started (the file header).

## 2. The flight analysis — against figures worked out by hand
`lib/ulog/analysis.ts` is run on the project's logs and compared with numbers recorded
in `build-log.md` on 2026-09-28, which were worked out with pyulog before this app existed.

```bash
npm run verify:analysis
```
58 checks. They include: the roll-over is found, is first, and is timed right; the motor
means of the 25 s hover match to 15 µs; the yaw imbalance names motors 1 and 2; the
battery figures of the 39 s hover match; pack resistance lands at 55 to 68 mΩ (pyulog
gives 57 to 63); a crash's figures are not reported as findings.

One of these checks caught an error in the build log rather than in the app: the
resistance had been estimated by eye at 70 to 90 mΩ. Measured, it is about 60.

## 3. The planner — against known answers
`lib/planner/` is checked against results worked out on paper.

```bash
npm run verify:planner
```
124 checks: the footprint of a named camera at a named height; line count, line length,
direction and spacing of a grid over a 100 m by 60 m rectangle, both ways round; a
concave area; a corridor; an orbit and the heading at each point; every warning; both
export formats, column by column; and the limits that stop an oversized area.

## What is NOT verified
- **Exported plans have not been opened in QGroundControl or Mission Planner.** The file
  is built to the published format and its structure is checked, but no ground station
  has loaded one. Open a plan there and look at it before trusting it. The app says so on
  the Export page.
- **The thresholds in findings are rules of thumb**, not published limits: 100 µs for
  motor balance, 0.2 V per cell for sag, 8 satellites. Each finding states what was
  measured so the reader can judge.
- **Only PX4 v1.16.0 logs from one aircraft** have been read. Older or newer firmware may
  name a field differently; a missing field leaves a chart out, it does not fail.
- **Flight time is a still-air estimate.** The assumptions are printed beside it.

## In a browser
The screens were driven end to end in Chrome at four sizes and both themes: open three
logs, zoom, reset, reload from the stored copy, refuse a `.bin`; draw, switch survey type,
export, save; tick, fail a go/no-go item, edit, print. Zero console errors. That script
lives outside the repo; it is a smoke test, not a suite.
