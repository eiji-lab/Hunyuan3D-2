// hud/hud.js — the ONLY hardcoded HUD elements are HP and the special
// gauge (shared by every avatar per the design doc). Everything else — the
// per-avatar readouts like IMPACT RESERVE or FRACTURE stage — is generated
// from that avatar's own `hud` block in its JSON, so two different avatars
// never render the same HUD.

function resolveValue(combatant, source) {
  switch (source) {
    case 'chargeStore':
      return combatant.chargeStore ? { value: combatant.chargeStore.value, max: combatant.chargeStore.max } : null;
    case 'fractureStage':
      return combatant.damageDefer ? { value: combatant.fractureStage, max: combatant.damageDefer.stages } : null;
    case 'anchorActive':
      return { flag: combatant.anchor.active };
    case 'guardDurabilityPct':
      return combatant.guard ? { value: combatant.guard.durability, max: combatant.guard.maxDurability, broken: combatant.guard.broken } : null;
    default:
      return null;
  }
}

function buildPanel(root, side) {
  root.innerHTML = `
    <div class="hud-name"></div>
    <div class="hud-bar hud-hp"><div class="hud-bar-fill"></div></div>
    <div class="hud-bar hud-sp"><div class="hud-bar-fill"></div></div>
    <div class="hud-custom"></div>
  `;
  root.classList.add('hud-panel', `hud-${side}`);
  return {
    name: root.querySelector('.hud-name'),
    hpFill: root.querySelector('.hud-hp .hud-bar-fill'),
    spFill: root.querySelector('.hud-sp .hud-bar-fill'),
    custom: root.querySelector('.hud-custom'),
  };
}

export class HUD {
  constructor(leftEl, rightEl, timerEl, resultEl) {
    this.leftEl = leftEl;
    this.rightEl = rightEl;
    this.timerEl = timerEl;
    this.resultEl = resultEl;
    this.left = null;
    this.right = null;
  }

  init(playerCombatant, opponentCombatant) {
    this.left = buildPanel(this.leftEl, 'left');
    this.right = buildPanel(this.rightEl, 'right');
    this.left.name.textContent = playerCombatant.name;
    this.right.name.textContent = opponentCombatant.name;
    this._buildCustomRows(this.left.custom, playerCombatant);
    this._buildCustomRows(this.right.custom, opponentCombatant);
  }

  _buildCustomRows(container, combatant) {
    container.innerHTML = '';
    const spec = combatant.hudSpec || {};
    const rows = [...(spec.customGauges || []), ...(spec.customFlags || [])];
    for (const row of rows) {
      const div = document.createElement('div');
      div.className = 'hud-custom-row';
      div.dataset.rowId = row.id;
      div.innerHTML = `<span class="hud-custom-label">${row.label}</span><span class="hud-custom-value"></span>`;
      container.appendChild(div);
    }
  }

  update(playerCombatant, opponentCombatant, timeLeftSec) {
    this._updatePanel(this.left, playerCombatant);
    this._updatePanel(this.right, opponentCombatant);
    if (this.timerEl) this.timerEl.textContent = Math.max(0, Math.ceil(timeLeftSec)).toString();
  }

  _updatePanel(panel, combatant) {
    panel.hpFill.style.width = `${Math.max(0, (combatant.hp / combatant.maxHp) * 100)}%`;
    panel.spFill.style.width = `${Math.max(0, (combatant.specialGauge / 100) * 100)}%`;
    const spec = combatant.hudSpec || {};
    const rows = [...(spec.customGauges || []), ...(spec.customFlags || [])];
    for (const row of rows) {
      const el = panel.custom.querySelector(`[data-row-id="${row.id}"] .hud-custom-value`);
      if (!el) continue;
      const resolved = resolveValue(combatant, row.source);
      if (!resolved) { el.textContent = '—'; continue; }
      if ('flag' in resolved) {
        el.textContent = resolved.flag ? 'ON' : 'off';
        el.classList.toggle('hud-flag-on', resolved.flag);
      } else {
        el.textContent = `${Math.round(resolved.value)}/${Math.round(resolved.max)}`;
        el.classList.toggle('hud-flag-on', resolved.broken === true);
      }
    }
  }

  showResult(text) {
    if (!this.resultEl) return;
    const span = this.resultEl.querySelector('.hud-result-text');
    if (span) span.textContent = text;
    this.resultEl.classList.add('visible');
  }

  hideResult() {
    if (!this.resultEl) return;
    this.resultEl.classList.remove('visible');
  }
}
