#!/usr/bin/env python3
"""
ゲーム内で実際に使われている文字だけを抽出してフォントをサブセット化する。
CDNを使わず自己ホストしつつ、フォントサイズを実用的な大きさに抑えるため。

素材・台詞・UI文言などのテキストを変更した場合は、このスクリプトを再実行して
src/assets/fonts/*.woff2 を作り直すこと。

実行: python3 scripts/subset-fonts.py
必要: pip install fonttools brotli
"""
import glob
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, "src", "assets", "fonts")

BASE_CHARS = (
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    " 　.,!?…「」『』・：；()（）%＋+×~〜/―ー—-★"
)


def collect_chars() -> str:
    chars = set(BASE_CHARS)

    def walk(node):
        if isinstance(node, str):
            chars.update(node)
        elif isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            for value in node.values():
                walk(value)

    for path in glob.glob(os.path.join(ROOT, "src", "data", "*.json")):
        with open(path, encoding="utf-8") as f:
            walk(json.load(f))

    src_globs = [
        os.path.join(ROOT, "src", "**", "*.ts"),
        os.path.join(ROOT, "index.html"),
    ]
    for pattern in src_globs:
        for path in glob.glob(pattern, recursive=True):
            with open(path, encoding="utf-8") as f:
                chars.update(f.read())

    return "".join(sorted(c for c in chars if c.isprintable()))


def subset(src_ttf: str, out_woff2: str, text: str) -> None:
    subprocess.run(
        [
            "pyftsubset",
            src_ttf,
            f"--text={text}",
            "--flavor=woff2",
            f"--output-file={out_woff2}",
            "--layout-features=*",
        ],
        check=True,
    )


def main() -> None:
    text = collect_chars()
    print(f"subsetting to {len(text)} unique characters")

    targets = [
        ("ShipporiMincho-Regular.ttf", "ShipporiMincho-Regular.woff2"),
        ("ShipporiMincho-Medium.ttf", "ShipporiMincho-Medium.woff2"),
        ("ShipporiMincho-Bold.ttf", "ShipporiMincho-Bold.woff2"),
        ("ZenKakuGothicNew-Regular.ttf", "ZenKakuGothicNew-Regular.woff2"),
        ("ZenKakuGothicNew-Medium.ttf", "ZenKakuGothicNew-Medium.woff2"),
        ("ZenKakuGothicNew-Bold.ttf", "ZenKakuGothicNew-Bold.woff2"),
    ]
    for src_name, out_name in targets:
        src_path = os.path.join(FONT_DIR, src_name)
        out_path = os.path.join(FONT_DIR, out_name)
        if not os.path.exists(src_path):
            print(f"skip (source ttf not found): {src_name}")
            continue
        subset(src_path, out_path, text)
        size_kb = os.path.getsize(out_path) / 1024
        print(f"{out_name}: {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
