import { defineConfig } from 'vite';

// CDN依存を作らない・オフラインで完全に動作する制約のため、
// 外部フォント・外部スクリプトは一切参照しない。ビルド後は静的ファイルのみ。
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  test: {
    environment: 'node',
  },
});
