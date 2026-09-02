#!/usr/bin/env python3
"""
調査資料画像 一括WebP軽量化・正方形リサイズスクリプト
使い方:
  python3 scratch/convert_evidence_images.py [入力フォルダ]
  デフォルトの入力フォルダ: assets/raw_evidence
  出力先: assets/evidence/
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

def check_command(cmd):
    return shutil.which(cmd) is not None

def main():
    script_dir = Path(__file__).parent.parent.resolve()
    input_dir = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (script_dir / "assets" / "raw_evidence")
    output_dir = script_dir / "assets" / "evidence"
    temp_dir = script_dir / "scratch" / "temp_evidence_conv"

    output_dir.mkdir(parents=True, exist_ok=True)
    temp_dir.mkdir(parents=True, exist_ok=True)

    if not input_dir.exists():
        print(f"📁 入力フォルダを作成しました: {input_dir}")
        input_dir.mkdir(parents=True, exist_ok=True)
        return

    valid_exts = {".png", ".jpg", ".jpeg", ".heic", ".webp"}
    raw_files = [f for f in input_dir.iterdir() if f.is_file() and f.suffix.lower() in valid_exts]

    if not raw_files:
        print(f"ℹ️ {input_dir} に変換対象の画像ファイル（.png, .jpg, .heic, .webp）がありません。")
        return

    print(f"🚀 {len(raw_files)} 個の画像を検知しました。一括変換・正方形軽量化を開始します...")

    has_sips = check_command("sips")
    has_cwebp = check_command("cwebp")

    for f in raw_files:
        stem = f.stem.upper()
        target_name = stem
        out_webp = output_dir / f"{target_name}.webp"
        temp_jpg = temp_dir / f"{target_name}.jpg"

        print(f"📸 処理中: {f.name} ➔ {out_webp.name}")

        try:
            if has_sips:
                subprocess.run(["sips", "-s", "format", "jpeg", str(f), "--out", str(temp_jpg)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                subprocess.run(["sips", "--resampleHeightWidthMax", "600", str(temp_jpg)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                
                if has_cwebp:
                    subprocess.run(["cwebp", "-q", "82", str(temp_jpg), "-o", str(out_webp)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    try:
                        from PIL import Image
                        with Image.open(temp_jpg) as img:
                            img.save(out_webp, "WEBP", quality=82)
                    except ImportError:
                        shutil.copy(temp_jpg, out_webp)
            else:
                from PIL import Image
                with Image.open(f) as img:
                    w, h = img.size
                    min_dim = min(w, h)
                    left = (w - min_dim) / 2
                    top = (h - min_dim) / 2
                    right = (w + min_dim) / 2
                    bottom = (h + min_dim) / 2
                    cropped = img.crop((left, top, right, bottom))
                    cropped = cropped.resize((600, 600), Image.Resampling.LANCZOS)
                    cropped.save(out_webp, "WEBP", quality=82)

            orig_size = f.stat().st_size / 1024
            new_size = out_webp.stat().st_size / 1024
            print(f"  ✅ 完了: {orig_size:.1f} KB ➔ {new_size:.1f} KB")

        except Exception as e:
            print(f"  ❌ エラー ({f.name}): {e}")

    shutil.rmtree(temp_dir, ignore_errors=True)
    print("\n🎉 画像の最適化・配置が完了しました！")

if __name__ == "__main__":
    main()
