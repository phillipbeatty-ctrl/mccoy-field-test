#!/usr/bin/env python3
"""Apply approved PNG icon and full-brand references to browser HTML."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPROVED_SOURCE = "/assets/brand/official-logo-source.png"
changed: list[str] = []

for path in sorted(ROOT.glob("*.html")):
    original = path.read_text(encoding="utf-8")
    text = re.sub(
        r'<link\s+rel=["\']icon["\']\s+href=["\']/assets/logo\.svg["\']\s+type=["\']image/svg\+xml["\']\s*/?>',
        '<link rel="icon" href="/assets/favicon-64.png" type="image/png">',
        original,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r'<link\s+rel=["\']apple-touch-icon["\'](?:\s+sizes=["\'][^"\']+["\'])?\s+href=["\']/assets/logo\.svg["\']\s*/?>',
        '<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon-180.png">',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r'(<img\b[^>]*\bsrc=["\'])/assets/logo\.svg(["\'])',
        rf'\1{APPROVED_SOURCE}\2',
        text,
        flags=re.IGNORECASE,
    )
    if text != original:
        path.write_text(text, encoding="utf-8")
        changed.append(path.name)

print({"changed": changed, "count": len(changed), "approved_source": APPROVED_SOURCE})
