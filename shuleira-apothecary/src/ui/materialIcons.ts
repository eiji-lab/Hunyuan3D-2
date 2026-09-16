/**
 * 素材分類ごとの簡易アイコン（線画）。棚を「文字だけのリスト」ではなく
 * 素材箱らしい見た目にするための最小限の作り込み（decisions.md D16参照）。
 * 22種すべてに個別の絵を用意する代わりに、分類（6種）ごとに形と色を変えている。
 */
export const CATEGORY_COLOR: Record<string, string> = {
  植物由来: '#8ba888',
  獣由来: '#c2a67c',
  鉱物由来: '#8ea3b8',
  分泌由来: '#b98ec4',
  加工品: '#d8b56a',
  水: '#8fc4c4',
};

const CATEGORY_PATH: Record<string, string> = {
  植物由来: 'M12 2C8 6 4 10 4 15a8 8 0 0016 0c0-5-4-9-8-13z M12 6v14',
  獣由来: 'M5 3l4 17 M12 2l2 18 M18 4l-2 17',
  鉱物由来: 'M12 2l8 6-3 13H7L4 8z M4 8h16 M7 21l5-13 5 13',
  分泌由来: 'M12 2c-3 5-7 9-7 13a7 7 0 0014 0c0-4-4-8-7-13z',
  加工品: 'M9 2h6 M10 2v6l-5 11a2 2 0 002 3h10a2 2 0 002-3l-5-11V2 M8 15h8',
  水: 'M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0 M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0 M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0',
};

export function categoryColor(category: string): string {
  return CATEGORY_COLOR[category] ?? '#9a94a8';
}

export function materialIconSvg(category: string, size = 20): string {
  const color = categoryColor(category);
  const path = CATEGORY_PATH[category] ?? CATEGORY_PATH['加工品'];
  return `
    <svg class="material-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="${path}" />
    </svg>
  `;
}
