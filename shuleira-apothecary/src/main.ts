import materialsData from './data/materials.json';
import customersData from './data/customers.json';
import advisorsData from './data/advisors.json';
import eventsData from './data/events.json';
import type { Material } from './engine/types';
import {
  addMaterialToTable,
  clearTableQueue,
  CUSTOMER_PATIENCE_MS,
  deliverToCustomer,
  endDay,
  giveTobaccoToCustomer,
  MATERIALS_BY_ID,
  playerStage,
  smokeSelf,
  startDay,
  tick,
} from './state/gameState';
import type { GameState } from './state/types';
import { saveStore, STORAGE_KEYS } from './state/storage';
import { applyHallucinationRewrite, currentDialogueLine, switchIntervalMs } from './ui/dialogue';
import { categoryColor, materialIconSvg } from './ui/materialIcons';

const MATERIALS = materialsData.materials as Material[];
const CUSTOMERS_BY_ID = Object.fromEntries(customersData.customers.map((c) => [c.id, c]));
const ADVISORS_BY_ID = Object.fromEntries(advisorsData.advisors.map((a) => [a.id, a]));
const CATEGORIES = materialsData.categories as string[];
const APPEARANCE_LABELS: Record<string, string> = {
  wings: '翼',
  skin: '皮膚',
  eyes: '瞳',
  posture: '姿勢',
  belongings: '所持品',
  other: 'その他',
};

/** 立ち絵が用意されるまでの仮の色味（客ごとの印象を色だけで示す）。 */
const CUSTOMER_ACCENT: Record<string, string> = {
  C01: '#8fd0c9', // ミル
  C02: '#c98a5e', // ハウ
  C03: '#9b7fc4', // ネル
  C04: '#9aa583', // トビ
  C05: '#a8a0b8',
  C06: '#c47a86',
  C07: '#b0687a',
  C08: '#7c8aa0',
  C09: '#d8c48a', // オルガ
  C10: '#6f6b78',
};
const ADVISOR_ACCENT: Record<string, string> = {
  shuleira: '#5e6f9e',
  laplace: '#e3a8c9',
};

/**
 * 作者から画像を受け取ったら、決められたキーで
 * src/assets/characters/ または src/assets/backgrounds/ に配置するだけで
 * 自動的に表示へ反映される（コード変更不要）。詳細は各フォルダのREADME参照。
 * ファイルが無いキーは自動的にプレースホルダー（人影SVG／グラデーション背景）
 * にフォールバックする。
 */
function keyByFilename(modules: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(modules).map(([path, url]) => [path.replace(/^.*\/([^/]+)\.[^.]+$/, '$1'), url]),
  );
}

const CHARACTER_IMAGES = keyByFilename(
  import.meta.glob('./assets/characters/*.{png,jpg,jpeg,webp}', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
);
const BACKGROUND_IMAGES = keyByFilename(
  import.meta.glob('./assets/backgrounds/*.{png,jpg,jpeg,webp}', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
);

interface PersistedSave {
  state: GameState;
  dayStarted: boolean;
}

let state: GameState = saveStore.load<PersistedSave>(STORAGE_KEYS.gameState)?.state ?? startDay(1, null);
let dayStarted = saveStore.load<PersistedSave>(STORAGE_KEYS.gameState)?.dayStarted ?? false;
let selectedTableId: string = state.tables[0]?.id ?? 'T1';
let shelfCategory: string = CATEGORIES[0];
let selectedCustomerInstanceId: string | null = null;
let flashMessage: string | null = null;

const app = document.getElementById('app')!;

function persist(): void {
  saveStore.save<PersistedSave>(STORAGE_KEYS.gameState, { state, dayStarted });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function advanceDialogueRotation(s: GameState): GameState {
  const stage = playerStage(s.playerMeter).id;
  const interval = switchIntervalMs(stage);
  const tables = s.tables.map((t) => {
    if (!t.customer) return t;
    if (s.elapsedMs - t.customer.lastSwitchAtMs < interval) return t;
    return {
      ...t,
      customer: {
        ...t.customer,
        lineIndex: t.customer.lineIndex + 1,
        lastSwitchAtMs: s.elapsedMs,
      },
    };
  });
  return { ...s, tables };
}

/**
 * 立ち絵の代わりに、霧の中に立つ人影を抽象化したプレースホルダーを描く。
 * 「客の顔がはっきり見えない」という世界観に寄せた仮表現（decisions.md D14）。
 * 将来、実イラストに差し替える場合はこの関数の呼び出し箇所を置き換えるだけでよい。
 */
function renderPortraitSilhouette(accent: string): string {
  return `
    <svg class="portrait-svg" viewBox="0 0 200 260" aria-hidden="true">
      <defs>
        <filter id="soft-blur"><feGaussianBlur stdDeviation="6" /></filter>
        <filter id="soft-blur-lg"><feGaussianBlur stdDeviation="14" /></filter>
        <linearGradient id="body-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${accent}" stop-opacity="0.95" />
          <stop offset="1" stop-color="${accent}" stop-opacity="0.55" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="150" rx="92" ry="108" fill="${accent}" opacity="0.16" filter="url(#soft-blur-lg)" />
      <ellipse cx="55" cy="118" rx="46" ry="20" fill="${accent}" opacity="0.3" filter="url(#soft-blur)" transform="rotate(-28 55 118)" />
      <ellipse cx="145" cy="118" rx="46" ry="20" fill="${accent}" opacity="0.3" filter="url(#soft-blur)" transform="rotate(28 145 118)" />
      <ellipse cx="100" cy="185" rx="52" ry="72" fill="url(#body-grad)" filter="url(#soft-blur)" />
      <ellipse cx="100" cy="82" rx="30" ry="34" fill="url(#body-grad)" filter="url(#soft-blur)" />
      <ellipse cx="90" cy="66" rx="16" ry="10" fill="#fff" opacity="0.14" filter="url(#soft-blur)" />
    </svg>
  `;
}

function renderStageParticles(): string {
  return Array.from({ length: 14 })
    .map((_, i) => `<span class="mote" style="--i:${i}"></span>`)
    .join('');
}

interface StageContent {
  switcherHtml: string;
  portraitHtml: string;
  vnBoxHtml: string;
}

/**
 * ステージの「中身」だけを計算する。背景・パーティクルなど装飾のDOMは
 * mount()で一度だけ作り、ここでは触らない（毎ティック作り直すとCSSアニメーションが
 * 常にリセットされてしまうため。decisions.md D17参照）。
 */
function computeStageContent(s: GameState): StageContent {
  const focusedTable = s.tables.find((t) => t.id === selectedTableId) ?? s.tables[0];
  const focusedCustomer = focusedTable?.customer ?? null;
  const stage = playerStage(s.playerMeter).id;

  const tabs = s.tables
    .map((t) => {
      const def = t.customer ? CUSTOMERS_BY_ID[t.customer.customerId as keyof typeof CUSTOMERS_BY_ID] : null;
      const label = t.table.scorched ? '使用不可' : def ? def.name.split('・')[0] : '空き';
      return `<button class="stage-tab ${t.id === selectedTableId ? 'active' : ''} ${t.table.scorched ? 'scorched' : ''}" data-action="select-table" data-id="${t.id}">${escapeHtml(t.id)} ${escapeHtml(label)}</button>`;
    })
    .join('');
  const waitingBadge =
    s.waitingQueue.length > 0
      ? `<span class="stage-waiting" data-action="select-customer" data-id="${s.waitingQueue[0].instanceId}">＋${s.waitingQueue.length} 待ち</span>`
      : '';

  let portraitHtml = '<div class="portrait-empty">……</div>';
  let nameplate = '——';
  let vnText = focusedTable?.table.scorched ? '（この台は今日はもう使えない）' : '……特に何も起きていない。';
  let appearanceLine = '';

  if (focusedCustomer) {
    const def = CUSTOMERS_BY_ID[focusedCustomer.customerId as keyof typeof CUSTOMERS_BY_ID];
    if (def) {
      const accent = CUSTOMER_ACCENT[def.id] ?? '#a98bc9';
      const imageUrl = CHARACTER_IMAGES[def.dialogueId];
      portraitHtml = imageUrl
        ? `<img class="portrait-image" src="${imageUrl}" alt="${escapeHtml(def.name)}" />`
        : renderPortraitSilhouette(accent);
      nameplate = `${def.name}（${def.age}）`;
      const line = currentDialogueLine(focusedCustomer.customerId, focusedCustomer.lineIndex).text;
      vnText = applyHallucinationRewrite(line, stage);
      const appearance = def.appearance as Record<string, unknown>;
      appearanceLine = Object.entries(appearance)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => `${APPEARANCE_LABELS[k] ?? k}: ${v}`)
        .join(' / ');
    }
  }

  const vnBoxHtml = `
    ${focusedCustomer ? `<div class="vn-nameplate">${escapeHtml(nameplate)}</div>` : ''}
    ${appearanceLine ? `<div class="vn-appearance">${escapeHtml(appearanceLine)}</div>` : ''}
    <div class="vn-text dialogue-line">${escapeHtml(vnText)}</div>
  `;

  return { switcherHtml: tabs + waitingBadge, portraitHtml, vnBoxHtml };
}

function renderWaitingPeek(s: GameState): string {
  if (!selectedCustomerInstanceId) return '';
  const c = s.waitingQueue.find((w) => w.instanceId === selectedCustomerInstanceId);
  if (!c) return '';
  const def = CUSTOMERS_BY_ID[c.customerId as keyof typeof CUSTOMERS_BY_ID];
  if (!def) return '';
  const appearance = def.appearance as Record<string, unknown>;
  const appearanceText = Object.entries(appearance)
    .filter(([, v]) => typeof v === 'string')
    .map(([k, v]) => `${APPEARANCE_LABELS[k] ?? k}: ${v}`)
    .join(' / ');
  return `
    <div class="waiting-peek">
      <div class="vn-nameplate">${escapeHtml(def.name)}（${escapeHtml(def.age)}・待機中）</div>
      <div class="vn-appearance">${escapeHtml(appearanceText)}</div>
    </div>
  `;
}

function renderHud(s: GameState): string {
  const advisor = ADVISORS_BY_ID[s.advisorId as keyof typeof ADVISORS_BY_ID];
  const eventDef = s.supplyEventId ? eventsData.events.find((e) => e.id === s.supplyEventId) : null;
  return `
    <div class="hud-item">Day ${s.day}/7</div>
    <div class="hud-item">助言: ${advisor ? escapeHtml(advisor.name) : 'なし'}</div>
    <div class="hud-item hud-quota">本日 ${s.servedCount}/${s.dayTargetCustomers}人　倒壊 ${s.collapsedCount}</div>
    <div class="hud-item">🚬 ${s.tobacco}</div>
    <div class="hud-item">${eventDef ? '⚠ ' + escapeHtml(eventDef.name) : ''}</div>
  `;
}

/** ステージ下の「作業台」帯。選択中の台の状態と操作ボタンだけを簡潔に示す
 * （客の名前・台詞・外見はステージ上のVNボックスに集約したため、ここでは繰り返さない）。 */
/** 台＝「調合中の器」。投入済み素材をアイコンチップで見せ、中身が一目でわかるようにする。 */
function renderTableStrip(s: GameState): string {
  return `
    <div class="table-strip">
      ${s.tables
        .map((t) => {
          const chips = t.queue
            .map((id) => {
              const m = MATERIALS_BY_ID[id];
              return m ? `<span class="vessel-chip" title="${escapeHtml(m.name)}">${materialIconSvg(m.category, 14)}</span>` : '';
            })
            .join('');
          const statusText = t.table.scorched ? '使用不可' : t.customer ? '接客中' : '空き';
          const patienceRatio = t.customer
            ? Math.max(0, 1 - (s.elapsedMs - t.customer.arrivedAtMs) / CUSTOMER_PATIENCE_MS)
            : null;
          const patienceLevel = patienceRatio === null ? '' : patienceRatio < 0.25 ? 'urgent' : patienceRatio < 0.55 ? 'warn' : 'calm';
          const patienceGauge =
            patienceRatio === null
              ? ''
              : `<div class="patience-gauge ${patienceLevel}"><div class="patience-fill" style="width:${Math.round(patienceRatio * 100)}%"></div></div>`;
          return `
            <div class="table-chip ${t.id === selectedTableId ? 'selected' : ''} ${t.table.scorched ? 'scorched' : ''}" data-action="select-table" data-id="${t.id}">
              <div class="table-chip-head"><span>${escapeHtml(t.id)}</span><span class="table-chip-status">${escapeHtml(statusText)}</span></div>
              ${patienceGauge}
              <div class="vessel">${chips || '<span class="vessel-empty">（素材未投入）</span>'}</div>
              <div class="actions">
                <button data-action="clear-table" data-id="${t.id}" ${t.queue.length === 0 ? 'disabled' : ''}>戻す</button>
                <button data-action="deliver" data-id="${t.id}" ${!t.customer || t.queue.length === 0 ? 'disabled' : ''}>渡す</button>
                ${t.customer ? `<button data-action="give-tobacco" data-id="${t.customer.instanceId}" ${s.tobacco <= 0 ? 'disabled' : ''}>煙草</button>` : ''}
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

/** 素材箱。分類ごとに色とアイコン形状を変え、文字だけの一覧にしない。 */
function renderShelf(s: GameState): string {
  const tabs = CATEGORIES.map(
    (cat) =>
      `<button class="${cat === shelfCategory ? 'active' : ''}" style="--tab-color:${categoryColor(cat)}" data-action="select-category" data-id="${cat}">${materialIconSvg(cat, 15)}<span>${escapeHtml(cat)}</span></button>`,
  ).join('');

  const items = MATERIALS.filter((m) => m.category === shelfCategory)
    .map((m) => {
      const stock = s.inventory[m.id] ?? 0;
      const effects = m.effects.map((e) => `${e.axis}${'+'.repeat(e.strength)}`).join(' ');
      const side = m.sideEffects.map((e) => `${e.axis}${'+'.repeat(e.strength)}`).join(' ');
      return `
        <div class="material-card ${stock <= 0 ? 'out-of-stock' : ''}" style="--tab-color:${categoryColor(m.category)}" data-action="add-material" data-id="${m.id}">
          <div class="material-icon-wrap">${materialIconSvg(m.category, 26)}</div>
          <div class="material-body">
            <div class="name"><span>${escapeHtml(m.name)}</span><span>×${stock}</span></div>
            <div class="effects">${escapeHtml(effects) || '（希釈用）'}</div>
            <div class="side-effects">${escapeHtml(side)}</div>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="shelf-tabs">${tabs}</div>
    <div class="shelf">${items}</div>
  `;
}

function renderSettingsBar(s: GameState): string {
  return `
    <button class="tobacco-btn" data-action="smoke" ${s.tobacco <= 0 ? 'disabled' : ''}>自分で吸う</button>
    <span>選択中: ${selectedTableId}</span>
    <button class="mute-btn" data-action="mute">${s.muted ? 'ミュート中' : 'ミュート'}</button>
    <button class="mute-btn" data-action="reset">リセット</button>
    <label style="display:flex;align-items:center;gap:4px;flex-basis:100%;">
      音量
      <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-action="volume" />
    </label>
  `;
}

function renderDayStartOverlay(s: GameState): string {
  const advisor = ADVISORS_BY_ID[s.advisorId as keyof typeof ADVISORS_BY_ID];
  const eventDef = s.supplyEventId ? eventsData.events.find((e) => e.id === s.supplyEventId) : null;
  return `
    <div class="overlay">
      <div class="logotype">シュレイラ調薬所</div>
      <div class="day-index">Day ${s.day} / 7</div>
      <div>助言役　${advisor ? escapeHtml(advisor.name) : '誰も居ない日'}</div>
      <div>煙草の配給　${s.tobacco}本</div>
      <div>${eventDef ? '本日の出来事　' + escapeHtml(eventDef.name) + '\n' + escapeHtml(eventDef.description) : '特に変わったことはない'}</div>
      <button data-action="begin-day">始める</button>
    </div>
  `;
}

/** その日の評価を★1〜3で示す（NTE『店長スペシャル』の評価画面を参考。decisions.md D18）。 */
function dayStarRating(s: GameState): number {
  if (s.collapsedCount > 0) return 1;
  if (s.tablesRuinedCount > 0 || s.patienceExpiredCount > 0) return 2;
  return 3;
}

function renderStars(count: number): string {
  return Array.from({ length: 3 }, (_, i) => `<span class="star ${i < count ? 'filled' : ''}">★</span>`).join('');
}

function renderDayEndOverlay(s: GameState): string {
  const stars = dayStarRating(s);
  return `
    <div class="overlay">
      <div class="day-index">Day ${s.day} 終了</div>
      <div class="star-rating">${renderStars(stars)}</div>
      <div style="font-size:15px;">${escapeHtml(s.closingLine ?? '')}</div>
      <div class="day-index">対応 ${s.servedCount}/${s.dayTargetCustomers}　倒壊 ${s.collapsedCount}　焦げた台 ${s.tablesRuinedCount}　待ちきれず帰った客 ${s.patienceExpiredCount}</div>
      <button data-action="next-day">${s.day >= 7 ? '試作はここまで' : '次の日へ'}</button>
    </div>
  `;
}

/**
 * 装飾用DOM（背景・パーティクルなど）は起動時に一度だけ作る。
 * render()はデータに依存する部分だけを、変化した時だけ書き換える
 * （毎ティックinnerHTMLを丸ごと作り直すと、鱗粉パーティクルや立ち絵の
 * 呼吸アニメーションが常にリセットされて止まって見えるため。decisions.md D17）。
 */
function mount(): void {
  const bgImageUrl = BACKGROUND_IMAGES['apothecary'];
  app.innerHTML = `
    <header class="hud" id="hud-root"></header>
    <div class="stage">
      ${bgImageUrl ? `<div class="stage-photo" style="background-image:url('${bgImageUrl}');"></div>` : ''}
      <div class="stage-bg"></div>
      <div class="stage-particles">${renderStageParticles()}</div>
      <div class="stage-switcher" id="stage-switcher-root"></div>
      <div class="stage-portrait" id="stage-portrait-root"></div>
      <div id="waiting-peek-root"></div>
      <div class="vn-box" id="vn-box-root"></div>
    </div>
    <div class="workbench">
      <div class="workbench-tickets" id="workbench-tickets-root"></div>
      <div class="workbench-shelf" id="workbench-shelf-root"></div>
    </div>
    <div class="settings-bar" id="settings-root"></div>
    <div id="flash-root"></div>
    <div id="overlay-root"></div>
  `;
}

const lastHtml: Record<string, string> = {};
function setHtml(id: string, html: string): void {
  if (lastHtml[id] === html) return;
  lastHtml[id] = html;
  document.getElementById(id)!.innerHTML = html;
}

function render(): void {
  const stage = playerStage(state.playerMeter);
  app.className = `stage-${stage.id}`;

  setHtml('hud-root', renderHud(state));

  const stageContent = computeStageContent(state);
  setHtml('stage-switcher-root', stageContent.switcherHtml);
  setHtml('stage-portrait-root', stageContent.portraitHtml);
  setHtml('waiting-peek-root', renderWaitingPeek(state));
  setHtml('vn-box-root', stageContent.vnBoxHtml);

  setHtml('workbench-tickets-root', renderTableStrip(state));
  setHtml('workbench-shelf-root', renderShelf(state));
  setHtml('settings-root', renderSettingsBar(state));

  setHtml(
    'flash-root',
    flashMessage
      ? `<div style="position:absolute;bottom:60px;left:0;right:0;text-align:center;font-size:12px;background:rgba(0,0,0,0.7);color:#fff;padding:4px;">${escapeHtml(flashMessage)}</div>`
      : '',
  );

  let overlay = '';
  if (!dayStarted) overlay = renderDayStartOverlay(state);
  else if (state.finished) overlay = renderDayEndOverlay(state);
  setHtml('overlay-root', overlay);
}

function setFlash(text: string): void {
  flashMessage = text;
  window.setTimeout(() => {
    flashMessage = null;
    render();
  }, 1800);
}

app.addEventListener('click', (ev) => {
  const target = (ev.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;

  switch (action) {
    case 'begin-day':
      dayStarted = true;
      break;
    case 'next-day': {
      if (state.day >= 7) {
        break;
      }
      state = startDay(state.day + 1, state.inventory);
      dayStarted = false;
      selectedCustomerInstanceId = null;
      break;
    }
    case 'select-table':
      if (id) selectedTableId = id;
      break;
    case 'select-category':
      if (id) shelfCategory = id;
      break;
    case 'select-customer':
      selectedCustomerInstanceId = id === selectedCustomerInstanceId ? null : id ?? null;
      break;
    case 'add-material':
      if (id) state = addMaterialToTable(state, selectedTableId, id);
      break;
    case 'clear-table':
      if (id) state = clearTableQueue(state, id);
      break;
    case 'deliver': {
      if (id) {
        const { state: next, summary } = deliverToCustomer(state, id);
        state = next;
        if (summary) {
          const msg =
            summary.outcome === 'collapse'
              ? '……倒れた。'
              : summary.outcome === 'worsen'
                ? '薬にならなかった。'
                : summary.symptomSatisfied
                  ? '症状は落ち着いたようだ。'
                  : '効いているかどうかは分からない。';
          setFlash(msg);
        }
      }
      break;
    }
    case 'smoke':
      state = smokeSelf(state);
      break;
    case 'give-tobacco':
      if (id) state = giveTobaccoToCustomer(state, id);
      break;
    case 'mute':
      state = { ...state, muted: !state.muted };
      break;
    case 'reset': {
      const confirmed = window.confirm('進行状況を消して1日目からやり直します。よろしいですか？');
      if (confirmed) {
        saveStore.remove(STORAGE_KEYS.gameState);
        state = startDay(1, null);
        dayStarted = false;
        selectedCustomerInstanceId = null;
        selectedTableId = state.tables[0]?.id ?? 'T1';
      }
      break;
    }
    default:
      break;
  }
  persist();
  render();
});

app.addEventListener('input', (ev) => {
  const target = ev.target as HTMLInputElement;
  if (target.dataset.action === 'volume') {
    state = { ...state, volume: Number(target.value) };
    persist();
  }
});

const TICK_MS = 250;
window.setInterval(() => {
  if (!dayStarted || state.finished) return;
  state = tick(state, TICK_MS);
  state = advanceDialogueRotation(state);
  if (state.finished) {
    state = endDay(state);
  }
  persist();
  render();
}, TICK_MS);

mount();
render();
