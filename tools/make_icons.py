"""生成快搜的 PNG 图标（16/32/48/128）。

用法：python tools/make_icons.py
依赖：Pillow + numpy（DSH 自带环境已包含）。
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "icons"
SIZES = (16, 32, 48, 128)

CANVAS = 1024
START_COLOR = (37, 99, 235)   # #2563eb
END_COLOR = (124, 58, 237)    # #7c3aed


def gradient(size: int) -> Image.Image:
    """左上→右下 的蓝色到紫色线性渐变。"""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    t = (x + y) / (2.0 * (size - 1))
    start = np.array(START_COLOR, dtype=np.float32)
    end = np.array(END_COLOR, dtype=np.float32)
    rgb = start[None, None, :] * (1.0 - t[..., None]) + end[None, None, :] * t[..., None]
    return Image.fromarray(np.round(rgb).astype(np.uint8), "RGB").convert("RGBA")


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_icon() -> Image.Image:
    image = gradient(CANVAS)
    image.putalpha(rounded_mask(CANVAS, round(CANVAS * 0.235)))

    draw = ImageDraw.Draw(image)
    cx = cy = CANVAS * 0.42
    radius = CANVAS * 0.205
    stroke = round(CANVAS * 0.098)
    white = (255, 255, 255, 255)

    # 手柄：从圆环中心线开始画，末端补一个圆头；起点被圆环盖住，接缝自然
    start = (cx + radius * 0.70, cy + radius * 0.70)
    end = (cx + radius * 1.68, cy + radius * 1.68)
    draw.line([start, end], fill=white, width=stroke)
    draw.ellipse(
        (end[0] - stroke / 2, end[1] - stroke / 2, end[0] + stroke / 2, end[1] + stroke / 2),
        fill=white,
    )

    # 镜片圆环
    draw.ellipse(
        (cx - radius - stroke / 2, cy - radius - stroke / 2,
         cx + radius + stroke / 2, cy + radius + stroke / 2),
        outline=white,
        width=stroke,
    )
    return image


def contact_sheet(icon: Image.Image) -> Image.Image:
    """把各尺寸放大 4 倍排成一行，方便检查小尺寸的辨识度。"""
    scale = 4
    gap = 20
    sizes = (16, 32, 48, 128)
    width = sum(size * scale for size in sizes) + gap * (len(sizes) + 1)
    height = 128 * scale + gap * 2
    sheet = Image.new("RGB", (width, height), (245, 247, 251))
    x = gap
    for size in sizes:
        tile = icon.resize((size * scale, size * scale), Image.NEAREST)
        sheet.paste(tile, (x, gap))
        x += size * scale + gap
    return sheet


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    icon = draw_icon()
    for size in SIZES:
        path = ICON_DIR / f"icon{size}.png"
        icon.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print(f"写入 {path.relative_to(ROOT)}")

    docs_dir = ROOT / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    sheet_path = docs_dir / "icon-sizes.png"
    contact_sheet(icon).save(sheet_path, optimize=True)
    print(f"写入 {sheet_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
