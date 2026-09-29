"""Dump reference numbers from pyulog for every log, for comparison with the TypeScript reader."""
import glob, json, math, sys, os
import numpy as np
from pyulog import ULog

out = {}
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.ulg"))):
    u = ULog(f)
    topics = {}
    for d in u.data_list:
        key = d.name if d.multi_id == 0 else f"{d.name}#{d.multi_id}"
        fields = {}
        for name, arr in d.data.items():
            a = np.asarray(arr, dtype=np.float64)
            finite = a[np.isfinite(a)]
            fields[name] = {
                "n": int(a.size),
                "sum": float(finite.sum()) if finite.size else 0.0,
                "first": None if a.size == 0 or not math.isfinite(a[0]) else float(a[0]),
                "last": None if a.size == 0 or not math.isfinite(a[-1]) else float(a[-1]),
                "nan": int(a.size - finite.size),
            }
        topics[key] = fields
    out[os.path.basename(f)] = {
        "start": int(u.start_timestamp), "last": int(u.last_timestamp),
        "topics": topics,
        "params": {k: float(v) for k, v in u.initial_parameters.items()},
        "changed": len(u.changed_parameters),
        "messages": [[int(m.timestamp), m.log_level_str(), m.message] for m in u.logged_messages],
        "dropouts": len(u.dropouts),
        "info": {k: (v if isinstance(v, (str, int, float)) else str(v)) for k, v in u.msg_info_dict.items()},
    }
json.dump(out, open(sys.argv[2], "w"))
print("logs", len(out), "topics in first", len(next(iter(out.values()))["topics"]))
