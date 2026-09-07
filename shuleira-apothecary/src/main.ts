import materialsData from './data/materials.json';
import customersData from './data/customers.json';
import advisorsData from './data/advisors.json';
import eventsData from './data/events.json';
import type { Material } from './engine/types';
import {
  addMaterialToTable,
  clearTableQueue,
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

function renderHud(s: GameState): string {
  const advisor = ADVISORS_BY_ID[s.advisorId as keyof typeof ADVISORS_BY_ID];
  const eventDef = s.supplyEventId ? eventsData.events.find((e) => e.id === s.supplyEventId) : null;
  return `
    <header class="hud">
      <div class="hud-item">Day ${s.day}/7</div>
      <div class="hud-item">助言: ${advisor ? escapeHtml(advisor.name) : 'なし'}</div>
      <div class="hud-item">🚬 ${s.tobacco}</div>
      <div class="hud-item">${eventDef ? '⚠ ' + escapeHtml(eventDef.name) : ''}</div>
    </header>
  `;
}

function renderCustomerRow(s: GameState): string {
  const seated = s.tables.filter((t) => t.customer).map((t) => t.customer!);
  const waiting = s.waitingQueue;
  const thumbs = [...seated, ...waiting]
    .map((c) => {
      const def = CUSTOMERS_BY_ID[c.customerId as keyof typeof CUSTOMERS_BY_ID];
      const isWaiting = waiting.includes(c);
      return `<div class="customer-thumb ${isWaiting ? 'waiting' : ''}" data-action="select-customer" data-id="${c.instanceId}">${escapeHtml(def?.name.split('・')[0] ?? '?')}</div>`;
    })
    .join('');
  const detail = renderCustomerDetail(s);
  return `<div class="customer-row">${thumbs || '<div style="font-size:11px;color:var(--fg-dim);padding:8px;">誰も来ていない</div>'}</div>${detail}`;
}

function renderCustomerDetail(s: GameState): string {
  if (!selectedCustomerInstanceId) return '';
  const all = [...s.tables.map((t) => t.customer).filter(Boolean), ...s.waitingQueue] as NonNullable<
    GameState['tables'][number]['customer']
  >[];
  const c = all.find((c) => c!.instanceId === selectedCustomerInstanceId);
  if (!c) return '';
  const def = CUSTOMERS_BY_ID[c.customerId as keyof typeof CUSTOMERS_BY_ID];
  if (!def) return '';
  const stage = playerStage(s.playerMeter).id;
  const line = currentDialogueLine(c.customerId, c.lineIndex).text;
  const shown = applyHallucinationRewrite(line, stage);
  const appearance = def.appearance as Record<string, unknown>;
  const appearanceText = Object.entries(appearance)
    .filter(([, v]) => typeof v === 'string')
    .map(([k, v]) => `${APPEARANCE_LABELS[k] ?? k}: ${v}`)
    .join(' / ');
  return `
    <div style="padding:8px;border-bottom:1px solid var(--border);font-size:12px;background:var(--bg);">
      <div style="font-weight:bold;">${escapeHtml(def.name)}（${escapeHtml(def.age)}）</div>
      <div style="color:var(--fg-dim);font-size:10px;margin:2px 0;">${escapeHtml(appearanceText)}</div>
      <div class="dialogue-line">${escapeHtml(shown)}</div>
    </div>
  `;
}

function renderTables(s: GameState): string {
  const stage = playerStage(s.playerMeter).id;
  return `
    <div class="tables">
      ${s.tables
        .map((t) => {
          const line = t.customer ? currentDialogueLine(t.customer.customerId, t.customer.lineIndex).text : '';
          const shownLine = t.customer ? applyHallucinationRewrite(line, stage) : '';
          const customerName = t.customer
            ? CUSTOMERS_BY_ID[t.customer.customerId as keyof typeof CUSTOMERS_BY_ID]?.name ?? ''
            : '（空き）';
          const queueText = t.queue
            .map((id) => MATERIALS_BY_ID[id]?.name ?? id)
            .join(' → ');
          return `
            <div class="table-card ${t.id === selectedTableId ? 'selected' : ''} ${t.table.scorched ? 'scorched' : ''}" data-action="select-table" data-id="${t.id}">
              <div class="customer-name">${escapeHtml(customerName)}</div>
              <div class="dialogue-line">${t.table.scorched ? '（この台は今日はもう使えない）' : escapeHtml(shownLine)}</div>
              <div class="queue">${escapeHtml(queueText)}</div>
              <div class="actions">
                <button data-action="clear-table" data-id="${t.id}" ${t.queue.length === 0 ? 'disabled' : ''}>戻す</button>
                <button data-action="deliver" data-id="${t.id}" ${!t.customer || t.queue.length === 0 ? 'disabled' : ''}>渡す</button>
              </div>
              ${t.customer ? `<button data-action="give-tobacco" data-id="${t.customer.instanceId}" ${s.tobacco <= 0 ? 'disabled' : ''} style="font-size:10px;">煙草を渡す</button>` : ''}
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderShelf(s: GameState): string {
  const tabs = CATEGORIES.map(
    (cat) => `<button class="${cat === shelfCategory ? 'active' : ''}" data-action="select-category" data-id="${cat}">${escapeHtml(cat)}</button>`,
  ).join('');

  const items = MATERIALS.filter((m) => m.category === shelfCategory)
    .map((m) => {
      const stock = s.inventory[m.id] ?? 0;
      const effects = m.effects.map((e) => `${e.axis}${'+'.repeat(e.strength)}`).join(' ');
      const side = m.sideEffects.map((e) => `${e.axis}${'+'.repeat(e.strength)}`).join(' ');
      return `
        <div class="material-card ${stock <= 0 ? 'out-of-stock' : ''}" data-action="add-material" data-id="${m.id}">
          <div class="name"><span>${escapeHtml(m.name)}</span><span>×${stock}</span></div>
          <div class="effects">${escapeHtml(effects) || '（希釈用）'}</div>
          <div class="side-effects">${escapeHtml(side)}</div>
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
    <div class="settings-bar">
      <button class="tobacco-btn" data-action="smoke" ${s.tobacco <= 0 ? 'disabled' : ''}>自分で吸う</button>
      <span>選択中: ${selectedTableId}</span>
      <button class="mute-btn" data-action="mute">${s.muted ? 'ミュート中' : 'ミュート'}</button>
      <button class="mute-btn" data-action="reset">リセット</button>
      <label style="display:flex;align-items:center;gap:4px;flex-basis:100%;">
        音量
        <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-action="volume" />
      </label>
    </div>
  `;
}

function renderDayStartOverlay(s: GameState): string {
  const advisor = ADVISORS_BY_ID[s.advisorId as keyof typeof ADVISORS_BY_ID];
  const eventDef = s.supplyEventId ? eventsData.events.find((e) => e.id === s.supplyEventId) : null;
  return `
    <div class="overlay">
      <div style="font-size:20px;">${s.day}日目</div>
      <div>助言役: ${advisor ? escapeHtml(advisor.name) : '誰も居ない日'}</div>
      <div>煙草の配給: ${s.tobacco}本</div>
      <div>${eventDef ? '本日の出来事: ' + escapeHtml(eventDef.name) + '\n' + escapeHtml(eventDef.description) : '特に変わったことはない'}</div>
      <button data-action="begin-day">始める</button>
    </div>
  `;
}

function renderDayEndOverlay(s: GameState): string {
  return `
    <div class="overlay">
      <div style="font-size:16px;">${s.day}日目 終了</div>
      <div>${escapeHtml(s.closingLine ?? '')}</div>
      <div style="font-size:11px;color:#cfc7dd;">対応: ${s.servedCount} / 倒壊: ${s.collapsedCount} / 焦げた台: ${s.tablesRuinedCount}</div>
      <button data-action="next-day">${s.day >= 7 ? '試作はここまで' : '次の日へ'}</button>
    </div>
  `;
}

function render(): void {
  const stage = playerStage(state.playerMeter);
  app.className = `stage-${stage.id}`;

  let overlay = '';
  if (!dayStarted) overlay = renderDayStartOverlay(state);
  else if (state.finished) overlay = renderDayEndOverlay(state);

  app.innerHTML = `
    ${renderHud(state)}
    ${renderCustomerRow(state)}
    ${renderTables(state)}
    ${renderShelf(state)}
    ${renderSettingsBar(state)}
    ${flashMessage ? `<div style="position:absolute;bottom:60px;left:0;right:0;text-align:center;font-size:12px;background:rgba(0,0,0,0.7);color:#fff;padding:4px;">${escapeHtml(flashMessage)}</div>` : ''}
    ${overlay}
  `;
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

render();
