#!/usr/bin/env python3
"""Split a projections payload into upload chunks for setVegasProjectionsChunk.

Usage: make_chunks.py <projections_json> <out_dir> [chunk_size=25]

Each chunk: {season, week, built_at, source, leagues, projections[..],
chunk_index, chunk_count}. built_at is stamped fresh so the build
supersedes any older committed build.
"""
import json
import sys
from datetime import datetime, timezone

CHUNK_SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 25

payload = json.load(open(sys.argv[1]))
out_dir = sys.argv[2]

import os
os.makedirs(out_dir, exist_ok=True)

built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
projs = payload["projections"]
n = len(projs)
chunks = [projs[i:i + CHUNK_SIZE] for i in range(0, n, CHUNK_SIZE)]

for i, chunk in enumerate(chunks):
    doc = {
        "season": payload["season"],
        "week": payload["week"],
        "built_at": built_at,
        "source": payload.get("source", "vegas-consensus"),
        "leagues": payload["leagues"],
        "projections": chunk,
        "chunk_index": i,
        "chunk_count": len(chunks),
    }
    path = os.path.join(out_dir, f"chunk_{i:02d}.json")
    json.dump(doc, open(path, "w"), indent=1)

print(f"built_at={built_at} players={n} chunks={len(chunks)} "
      f"sizes={[len(c) for c in chunks]} -> {out_dir}")
