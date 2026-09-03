from pathlib import Path
import base64
import gzip

FILES = {
    ".github/live-feed-preview-payload/app-live-feed.js.gz.b64": "app-live-feed.js",
    ".github/live-feed-preview-payload/service-worker.js.gz.b64": "service-worker.js",
    ".github/live-feed-preview-payload/migration.sql.gz.b64": "supabase/migrations/20260903062000_live_feed_comments_vertical_slice.sql",
    ".github/live-feed-preview-payload/canary.sql.gz.b64": "supabase/tests/live-feed-comments-preview-canary.sql",
    ".github/live-feed-preview-payload/contract.test.mjs.gz.b64": "live-feed-comments-contract.test.mjs",
    ".github/live-feed-preview-payload/docs.md.gz.b64": "docs/live-feed-comments-preview.md",
}

for source, target in FILES.items():
    payload = Path(source).read_text(encoding="utf-8").strip()
    data = gzip.decompress(base64.b64decode(payload, validate=True))
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(f"wrote {path} ({len(data)} bytes)")
