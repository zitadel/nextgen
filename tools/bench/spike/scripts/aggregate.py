#!/usr/bin/env python3
"""Aggregate a sweep directory of k6 raw JSON outputs into comparison tables.

For every run it reports, per operation: request count, throughput, and the
phase breakdown (blocked / connecting / sending / waiting / receiving /
duration) at p50 and p95, taken from http_req_* (shapes delegated, prepared)
or nextgen_req_* (shape owned). It also counts the distinct time series the
run produced, which is the tag-cardinality criterion.
"""
import gzip
import json
import os
import re
import sys
from collections import defaultdict


def quantile(values, q):
    if not values:
        return float("nan")
    s = sorted(values)
    k = (len(s) - 1) * q
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


PHASES = ["blocked", "connecting", "sending", "waiting", "receiving", "duration"]


def load(path):
    """Return (samples[(metric, op)] -> values, series set, time span, failures, conn_reused)."""
    samples = defaultdict(list)
    series = set()
    first = last = None
    failed = defaultdict(lambda: [0, 0])
    reused = defaultdict(lambda: [0, 0])
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt") as f:
        for line in f:
            rec = json.loads(line)
            if rec.get("type") != "Point":
                continue
            m = rec["metric"]
            d = rec["data"]
            tags = d.get("tags") or {}
            series.add((m, tuple(sorted(tags.items()))))
            op = tags.get("op", "-")
            samples[(m, op)].append(d["value"])
            t = d["time"]
            first = t if first is None or t < first else first
            last = t if last is None or t > last else last
            if m in ("http_req_failed", "nextgen_req_failed"):
                failed[op][0] += int(d["value"])
                failed[op][1] += 1
            if m == "nextgen_conn_reused":
                reused[op][0] += int(d["value"])
                reused[op][1] += 1
    return samples, series, (first, last), failed, reused


def span_seconds(span):
    from datetime import datetime

    def parse(s):
        s = re.sub(r"(\.\d{6})\d+", r"\1", s)
        return datetime.fromisoformat(s.replace("Z", "+00:00"))

    if not span[0]:
        return float("nan")
    return (parse(span[1]) - parse(span[0])).total_seconds()


def main(sweep):
    runs = sorted(p for p in os.listdir(sweep) if p.endswith(".json.gz"))
    rows = []
    for fn in runs:
        scen, shape, vus = re.match(r"(.+?)-(.+)-(\d+)\.json\.gz", fn).groups()
        samples, series, span, failed, reused = load(os.path.join(sweep, fn))
        prefix = "nextgen_req_" if shape.startswith("owned") else "http_req_"
        ops = sorted({op for (m, op) in samples if m == prefix + "duration"})
        secs = span_seconds(span)
        for op in ops:
            n = len(samples[(prefix + "duration", op)])
            row = {
                "scenario": scen, "shape": shape, "vus": int(vus), "op": op, "n": n,
                "rps": n / secs if secs else float("nan"),
                "failed": failed[op][0], "series": len(series),
                "reused": (reused[op][0] / reused[op][1]) if reused[op][1] else None,
            }
            for ph in PHASES:
                v = samples[(prefix + ph, op)]
                row[ph + "_p50"] = quantile(v, 0.5)
                row[ph + "_p95"] = quantile(v, 0.95)
            rows.append(row)
    rows.sort(key=lambda r: (r["scenario"], r["op"], r["vus"], r["shape"]))

    print("| scenario | op | vus | shape | n | req/s | failed | series | dur p50 | dur p95 | blocked p95 | conn p95 | send p95 | wait p95 | recv p95 | reused |")
    print("|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for r in rows:
        reused = "" if r["reused"] is None else f"{r['reused']*100:.0f}%"
        print(
            f"| {r['scenario']} | {r['op']} | {r['vus']} | {r['shape']} | {r['n']} | {r['rps']:.0f} | {r['failed']} | {r['series']} "
            f"| {r['duration_p50']:.2f} | {r['duration_p95']:.2f} | {r['blocked_p95']:.3f} | {r['connecting_p95']:.3f} "
            f"| {r['sending_p95']:.3f} | {r['waiting_p95']:.2f} | {r['receiving_p95']:.3f} | {reused} |"
        )
    with open(os.path.join(sweep, "aggregate.json"), "w") as f:
        json.dump(rows, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
