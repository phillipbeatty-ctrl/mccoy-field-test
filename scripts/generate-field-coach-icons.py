#!/usr/bin/env python3
"""Generate deterministic Field Coach browser and native icons from the approved PNG."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "brand" / "official-logo-source.png"
BLACK = (5, 5, 5, 255)
EXPECTED_SIZE = (1024, 1024)


def load_approved_source() -> Image.Image:
    if not SOURCE.is_file():
        raise SystemExit(
            "Approved source is missing: assets/brand/official-logo-source.png"
        )
    with Image.open(SOURCE) as image:
        image.load()
        source = image.convert("RGBA")
    if source.size != EXPECTED_SIZE:
        raise SystemExit(
            f"Approved source must remain {EXPECTED_SIZE[0]}x{EXPECTED_SIZE[1]}; "
            f"received {source.size[0]}x{source.size[1]}"
        )
    return source


def save_png(image: Image.Image, name: str) -> None:
    target = ASSETS / name
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, format="PNG", optimize=True, compress_level=9)
    print(
        f"generated {target.relative_to(ROOT)} "
        f"{image.width}x{image.height} {target.stat().st_size} bytes"
    )


def resize(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def centered_on_background(
    image: Image.Image,
    size: int,
    fraction: float,
    background: tuple[int, int, int, int] = BLACK,
) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), background)
    logo_size = max(1, round(size * fraction))
    logo = resize(image, logo_size)
    canvas.alpha_composite(logo, ((size - logo_size) // 2, (size - logo_size) // 2))
    return canvas


def main() -> None:
    source = load_approved_source()

    # Complete approved composition, resized only. No crop, redraw, or recolor.
    save_png(resize(source, 64), "favicon-64.png")
    save_png(resize(source, 180), "apple-touch-icon-180.png")
    save_png(resize(source, 192), "icon-192.png")
    save_png(resize(source, 512), "icon-512.png")

    # Platform-safe padding retains the entire approved composition.
    save_png(centered_on_background(source, 512, 0.76), "icon-maskable-512.png")
    save_png(centered_on_background(source, 1024, 0.90), "icon-only.png")

    foreground = centered_on_background(
        source,
        1024,
        0.88,
        background=(0, 0, 0, 0),
    )
    save_png(foreground, "icon-foreground.png")
    save_png(Image.new("RGBA", (1024, 1024), BLACK), "icon-background.png")

    splash = Image.new("RGBA", (2732, 2732), BLACK)
    splash_logo = centered_on_background(source, 1180, 0.90)
    splash.alpha_composite(
        splash_logo,
        ((2732 - 1180) // 2, (2732 - 1180) // 2),
    )
    save_png(splash, "splash.png")


if __name__ == "__main__":
    main()
