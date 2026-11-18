"""生成品牌 favicon.ico（多尺寸），视觉与 icon.svg 保持一致。

用法：
    python scripts/gen-icons.py
依赖：Pillow
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SCALE = 4                      # 先在高分辨率画布绘制，再缩放到各尺寸
BASE = 64
W = BASE * SCALE


def s(v):
    return int(round(v * SCALE))


img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

INK = "#18181B"      # 深墨背景
WHITE = "#FFFFFF"    # 机器人主体
ACCENT = "#818CF8"   # 靛蓝点缀

# 圆角方块背景
d.rounded_rectangle([0, 0, W - 1, W - 1], radius=s(16), fill=INK)

# 机器人脸（空心圆角矩形描边）
d.rounded_rectangle(
    [s(13), s(23), s(13 + 38), s(23 + 29)],
    radius=s(9), outline=WHITE, width=s(4),
)

# 天线竖线 + 顶端靛蓝圆点
d.line([s(32), s(23), s(32), s(15)], fill=WHITE, width=s(4))
d.ellipse([s(32) - s(3.5), s(11) - s(3.5), s(32) + s(3.5), s(11) + s(3.5)], fill=ACCENT)

# 双眼
for cx in (24, 40):
    r = s(2.6)
    d.ellipse([s(cx) - r, s(35) - r, s(cx) + r, s(35) + r], fill=WHITE)

# 嘴
d.line([s(26), s(43), s(38), s(43)], fill=WHITE, width=s(3))

# 右上角四角星
star = [(50, 20), (51.6, 23.4), (55, 25), (51.6, 26.6),
        (50, 30), (48.4, 26.6), (45, 25), (48.4, 23.4)]
d.polygon([(s(x), s(y)) for x, y in star], fill=ACCENT)

sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
out = ROOT / "favicon.ico"
img.save(out, format="ICO", sizes=sizes)
print(f"generated: {out.name} -> {', '.join(f'{sz}x{sz}' for sz, _ in sizes)}")

# iOS 添加到主屏不支持 SVG；PWA 安装通常需要 PNG 192/512
for name, px in [("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)]:
    img.resize((px, px), Image.LANCZOS).save(ROOT / name, format="PNG")
    print(f"generated: {name} ({px}x{px})")
