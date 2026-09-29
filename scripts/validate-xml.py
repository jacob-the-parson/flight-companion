"""Check the XML this app writes against the schemas the formats' owners publish.

    python scripts/validate-xml.py <schemas-dir> <written-dir>

<written-dir> is what `node scripts/verify-mission.mjs --out <written-dir>` leaves.
<schemas-dir> holds the three schemas, downloaded from their owners:

    FlightPlanv1.xsd   https://www8.garmin.com/xmlschemas/FlightPlanv1.xsd
    gpx.xsd            https://www.topografix.com/GPX/1/1/gpx.xsd
    ogckml22.xsd       https://schemas.opengis.net/kml/2.2.0/ogckml22.xsd
      and the two it imports, beside it:
    atom-author-link.xsd  https://schemas.opengis.net/kml/2.2.0/atom-author-link.xsd
    xAL.xsd               https://docs.oasis-open.org/election/external/xAL.xsd

Needs the `xmlschema` package (pip install xmlschema). The schemas are not kept
in this repository; they belong to Garmin, TopoGrafix and the OGC.

DJI publishes no schema for WPML, so a DJI route cannot be checked this way.
verify-mission.mjs compares its element order with the samples in DJI's
specification instead.
"""
import glob
import os
import sys

import xmlschema

if len(sys.argv) != 3:
    print(__doc__)
    sys.exit(2)
schemas, written = sys.argv[1], sys.argv[2]

CHECKS = [
    ("Garmin flight plan", "FlightPlanv1.xsd", "*.fpl"),
    ("GPX 1.1", "gpx.xsd", "*.gpx"),
    ("KML 2.2", "ogckml22.xsd", "*.kml"),
]

failed = 0
checked = 0
for label, xsd, pattern in CHECKS:
    path = os.path.join(schemas, xsd)
    if not os.path.exists(path):
        print(f"  skipped: {label} (no {xsd} in {schemas})")
        continue
    schema = xmlschema.XMLSchema(path)
    files = [f for f in sorted(glob.glob(os.path.join(written, pattern))) if not os.path.basename(f).startswith("dji-")]
    if not files:
        print(f"  skipped: {label} (no {pattern} in {written})")
        continue
    for f in files:
        checked += 1
        errors = list(schema.iter_errors(f))
        if errors:
            failed += 1
            print(f"  FAIL {label}: {os.path.basename(f)}")
            for e in errors[:5]:
                print(f"       {e.reason} at {e.path}")
        else:
            print(f"  valid {label}: {os.path.basename(f)}")

print(f"\nschemas: {checked} file(s) checked, {failed} failed")
sys.exit(1 if failed else 0)
