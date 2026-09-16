#!/usr/bin/env bash
# フォントのサブセット化に使う元TTFを取得する（OFLライセンス、Google Fonts配布）。
# 元TTFはリポジトリには含めない（容量が大きいため）。
# 実行後、scripts/subset-fonts.py でサブセット化されたwoff2を再生成すること。
set -euo pipefail
cd "$(dirname "$0")/../src/assets/fonts"

curl -sS -o ShipporiMincho-Regular.ttf "https://fonts.gstatic.com/s/shipporimincho/v17/VdGGAZweH5EbgHY6YExcZfDoj0BA2w.ttf"
curl -sS -o ShipporiMincho-Medium.ttf "https://fonts.gstatic.com/s/shipporimincho/v17/VdGDAZweH5EbgHY6YExcZfDoj0B4L9am5A.ttf"
curl -sS -o ShipporiMincho-Bold.ttf "https://fonts.gstatic.com/s/shipporimincho/v17/VdGDAZweH5EbgHY6YExcZfDoj0B4Z9Cm5A.ttf"
curl -sS -o ZenKakuGothicNew-Regular.ttf "https://fonts.gstatic.com/s/zenkakugothicnew/v18/gNMYW2drQpDw0GjzrVNFf_valaDBcznOkjs.ttf"
curl -sS -o ZenKakuGothicNew-Medium.ttf "https://fonts.gstatic.com/s/zenkakugothicnew/v18/gNMVW2drQpDw0GjzrVNFf_valaDBcznOqs9LaWQ.ttf"
curl -sS -o ZenKakuGothicNew-Bold.ttf "https://fonts.gstatic.com/s/zenkakugothicnew/v18/gNMVW2drQpDw0GjzrVNFf_valaDBcznOqodNaWQ.ttf"

echo "done. next: pip install fonttools brotli && python3 scripts/subset-fonts.py"
