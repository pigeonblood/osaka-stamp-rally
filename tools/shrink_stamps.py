"""stamps/ のPNGを480px・軽量化して上書きする（1枚300KB前後 → 20〜30KB程度）。

使い方（このリポジトリのフォルダで）:
    pip install pillow
    python3 tools/shrink_stamps.py

元の画像は stamps_original/ にコピーして残す。
"""
import shutil
from pathlib import Path
from PIL import Image

SIZE = 480
COLORS = 64  # スタンプは色数が少ないので64色で十分きれいに残る

src = Path("stamps")
backup = Path("stamps_original")
backup.mkdir(exist_ok=True)

for path in sorted(src.glob("*.png")):
    if not (backup / path.name).exists():
        shutil.copy2(path, backup / path.name)
    before = path.stat().st_size
    im = Image.open(backup / path.name).convert("RGBA")
    if max(im.size) > SIZE:
        im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    im.quantize(colors=COLORS, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)
    print(f"{path.name}: {before // 1024}KB -> {path.stat().st_size // 1024}KB")

print("完了。stamps_original/ はGitHubにアップしなくて大丈夫です。")
