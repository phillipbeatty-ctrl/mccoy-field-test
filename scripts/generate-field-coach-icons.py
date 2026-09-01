#!/usr/bin/env python3
"""Generate deterministic PWA and native Field Coach icon assets from assets/logo.svg."""
from __future__ import annotations

import io
import re
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "logo.svg"
BLACK = (5, 5, 5, 255)


def render_svg(svg: str, size: int) -> Image.Image:
    data = cairosvg.svg2png(bytestring=svg.encode("utf-8"), output_width=size, output_height=size)
    return Image.open(io.BytesIO(data)).convert("RGBA")


def save_png(image: Image.Image, name: str) -> None:
    target = ASSETS / name
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, format="PNG", optimize=True, compress_level=9)
    print(f"generated {target.relative_to(ROOT)} {image.width}x{image.height} {target.stat().st_size} bytes")


def resize(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def centered_on_black(image: Image.Image, size: int, fraction: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BLACK)
    logo_size = max(1, round(size * fraction))
    logo = resize(image, logo_size)
    canvas.alpha_composite(logo, ((size - logo_size) // 2, (size - logo_size) // 2))
    return canvas


def main() -> None:
    svg = SOURCE.read_text(encoding="utf-8")
    if "<image" in svg.lower() or "data:image" in svg.lower():
        raise SystemExit("assets/logo.svg must be pure vector artwork; embedded raster images are forbidden")

    full = render_svg(svg, 1024)
    foreground_svg = re.sub(r'<rect\b[^>]*/>\s*', "", svg, count=1, flags=re.IGNORECASE)
    foreground_mark = render_svg(foreground_svg, 900)

    save_png(resize(full, 64), "favicon-64.png")
    save_png(resize(full, 180), "apple-touch-icon-180.png")
    save_png(resize(full, 192), "icon-192.png")
    save_png(resize(full, 512), "icon-512.png")
    save_png(centered_on_black(full, 512, 0.76), "icon-maskable-512.png")
    save_png(centered_on_black(full, 1024, 0.90), "icon-only.png")

    foreground = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    foreground.alpha_composite(foreground_mark, ((1024 - 900) // 2, (1024 - 900) // 2))
    save_png(foreground, "icon-foreground.png")
    save_png(Image.new("RGBA", (1024, 1024), BLACK), "icon-background.png")

    splash = Image.new("RGBA", (2732, 2732), BLACK)
    splash_logo = centered_on_black(full, 1180, 0.90)
    splash.alpha_composite(splash_logo, ((2732 - 1180) // 2, (2732 - 1180) // 2))
    save_png(splash, "splash.png")


if __name__ == "__main__":
    main()
