#!/usr/bin/env python3
"""Fail closed unless the immutable approved Field Coach PNG is exact."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "brand"
SOURCE = BRAND / "official-logo-source.png"
CHECKSUM = BRAND / "official-logo-source.sha256"
EXPECTED_SOURCE_SHA256 = "ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5"
EXPECTED_PIXEL_SHA256 = "a07761316ddcbf77af92a7d6abbb2393ab1cde6ef251d0d39731788535a0279e"
EXPECTED_SIZE = (1024, 1024)
EXPECTED_FORMAT = "PNG"
EXPECTED_MODE = "RGB"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message: str) -> None:
    raise SystemExit(f"Approved logo verification failed: {message}")


def main() -> None:
    for path in (SOURCE, CHECKSUM):
        if not path.is_file():
            fail(f"missing {path.relative_to(ROOT)}")

    source_sha256 = sha256_file(SOURCE)
    if source_sha256 != EXPECTED_SOURCE_SHA256:
        fail(f"approved PNG checksum changed: {source_sha256}")

    expected_checksum_line = (
        f"{EXPECTED_SOURCE_SHA256}  assets/brand/official-logo-source.png"
    )
    checksum_line = CHECKSUM.read_text(encoding="utf-8").strip()
    if checksum_line != expected_checksum_line:
        fail("official-logo-source.sha256 does not contain the approved source checksum")

    try:
        with Image.open(SOURCE) as source_image:
            source_image.verify()
        with Image.open(SOURCE) as source_image:
            source_image.load()
            if source_image.format != EXPECTED_FORMAT:
                fail(f"approved source format changed: {source_image.format}")
            if source_image.mode != EXPECTED_MODE:
                fail(f"approved source mode changed: {source_image.mode}")
            if source_image.size != EXPECTED_SIZE:
                fail(f"approved source dimensions changed: {source_image.size}")
            pixel_sha256 = sha256_bytes(source_image.tobytes())
    except SystemExit:
        raise
    except Exception as error:
        fail(f"approved PNG is unreadable: {error}")

    if pixel_sha256 != EXPECTED_PIXEL_SHA256:
        fail(f"approved source decoded pixels changed: {pixel_sha256}")

    print(
        json.dumps(
            {
                "ok": True,
                "authoritative_source": str(SOURCE.relative_to(ROOT)),
                "source_sha256": source_sha256,
                "pixel_sha256": pixel_sha256,
                "dimensions": list(EXPECTED_SIZE),
                "format": EXPECTED_FORMAT,
                "mode": EXPECTED_MODE,
                "original_upload_evidence_sha256": (
                    "227203e1c0ab14a1aa400e6f0d1411a6512222a685589df92dac3f3c1633cd90"
                ),
                "original_upload_required_at_build_time": False,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
