#!/usr/bin/env python3
"""Fail closed unless the approved logo source and original upload are exact."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "brand"
ORIGINAL = BRAND / "approved-upload-original.jpg"
SOURCE = BRAND / "official-logo-source.png"
CHECKSUM = BRAND / "official-logo-source.sha256"
EXPECTED_ORIGINAL_SHA256 = "227203e1c0ab14a1aa400e6f0d1411a6512222a685589df92dac3f3c1633cd90"
EXPECTED_SOURCE_SHA256 = "ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5"
EXPECTED_SIZE = (1024, 1024)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message: str) -> None:
    raise SystemExit(f"Approved logo verification failed: {message}")


def main() -> None:
    for path in (ORIGINAL, SOURCE, CHECKSUM):
        if not path.is_file():
            fail(f"missing {path.relative_to(ROOT)}")

    original_sha256 = sha256(ORIGINAL)
    source_sha256 = sha256(SOURCE)
    if original_sha256 != EXPECTED_ORIGINAL_SHA256:
        fail(f"original JPEG checksum changed: {original_sha256}")
    if source_sha256 != EXPECTED_SOURCE_SHA256:
        fail(f"normalized PNG checksum changed: {source_sha256}")

    expected_checksum_line = (
        f"{EXPECTED_SOURCE_SHA256}  assets/brand/official-logo-source.png"
    )
    checksum_line = CHECKSUM.read_text(encoding="utf-8").strip()
    if checksum_line != expected_checksum_line:
        fail("official-logo-source.sha256 does not contain the approved source checksum")

    with Image.open(ORIGINAL) as original_image, Image.open(SOURCE) as source_image:
        original_image.load()
        source_image.load()
        original_rgb = original_image.convert("RGB")
        source_rgb = source_image.convert("RGB")
        if original_rgb.size != EXPECTED_SIZE or source_rgb.size != EXPECTED_SIZE:
            fail(
                "approved source dimensions changed: "
                f"original={original_rgb.size}, normalized={source_rgb.size}"
            )
        if ImageChops.difference(original_rgb, source_rgb).getbbox() is not None:
            fail("normalized PNG decoded pixels differ from the approved JPEG")

    print(
        json.dumps(
            {
                "ok": True,
                "approved_upload": str(ORIGINAL.relative_to(ROOT)),
                "approved_upload_sha256": original_sha256,
                "normalized_source": str(SOURCE.relative_to(ROOT)),
                "normalized_source_sha256": source_sha256,
                "dimensions": list(EXPECTED_SIZE),
                "pixel_identical": True,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
