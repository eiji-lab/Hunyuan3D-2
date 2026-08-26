// engine/stateManager.js — timed state modifiers that sit alongside the
// damage pipeline: anchor (fixed stance), self_state/target_state buffs with
// durations, and state snapshot/restore slots (D group).
//
// Like the pipeline hooks, these are read every frame by movement/attack
// code rather than being one-off "activate and forget" calls.

export class StateManager {
  tick(dt, combatants) {
    const now = performance.now();
    for (const c of combatants) {
      for (let i = c.buffs.length - 1; i >= 0; i--) {
        const b = c.buffs[i];
        if (b.expiresAt !== Infinity && now >= b.expiresAt) {
          if (b.onExpire) b.onExpire(c);
          c.buffs.splice(i, 1);
        }
      }
    }
  }

  setAnchor(combatant, active, params) {
    combatant.anchor.active = active;
    if (active) {
      combatant.anchor.kbResistance = params.kbResistance;
      combatant.anchor.moveMultiplier = params.moveMultiplier;
      combatant.anchor.turnMultiplier = params.turnMultiplier ?? 1;
    } else {
      combatant.anchor.kbResistance = 0;
      combatant.anchor.moveMultiplier = 1;
      combatant.anchor.turnMultiplier = 1;
    }
  }

  addBuff(combatant, buff) {
    // buff: {tag, durationMs, apply(c), onExpire(c)}
    const now = performance.now();
    const instance = { ...buff, expiresAt: buff.durationMs ? now + buff.durationMs : Infinity };
    combatant.buffs.push(instance);
    if (instance.apply) instance.apply(combatant);
    return instance;
  }

  // D group — record position/rotation/hp into a numbered slot
  snapshot(combatant, slotIndex) {
    combatant.stateSlots[slotIndex] = {
      position: combatant.mesh.position.clone(),
      rotation: combatant.mesh.rotation.y,
      hp: combatant.hp,
      lockedAt: combatant.stateSlots[slotIndex]?.locked ? combatant.stateSlots[slotIndex] : null,
    };
  }

  restore(combatant, slotIndex) {
    const slot = combatant.stateSlots[slotIndex];
    if (!slot) return false;
    combatant.mesh.position.copy(slot.position);
    combatant.mesh.rotation.y = slot.rotation;
    combatant.hp = slot.hp;
    if (!slot.locked) combatant.stateSlots[slotIndex] = null;
    return true;
  }
}
