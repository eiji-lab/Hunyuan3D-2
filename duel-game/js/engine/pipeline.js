// engine/pipeline.js — the damage pipeline.
//
// This is the structural piece the design doc calls out as impossible to
// retrofit: guard / damage_defer / charge_store are NOT "abilities you
// activate", they are modifiers that sit inside this pipeline and run on
// every hit a combatant takes, regardless of who they are. A combatant that
// has none of these hooks just falls straight through to step (f).

export const GAUGE_MAX = 100;
const GAUGE_PER_DAMAGE_DEALT = 0.42;
const GAUGE_PER_DAMAGE_TAKEN = 0.28;
export const GAUGE_PER_PROP_DESTROYED = 9;

function withinGuardArc(defender, hitOrigin) {
  // no origin means no attack direction exists (e.g. fall damage) — a shield
  // has nothing to interpose against, so it cannot reduce it
  if (!hitOrigin) return false;
  const toHit = hitOrigin.clone().sub(defender.position()).setY(0).normalize();
  const facing = defender.forwardVector();
  return toHit.dot(facing) < 0.15; // guard only covers the front ~100 degrees
}

export class DamagePipeline {
  constructor() {
    this.log = [];
  }

  // hit: { amount, knockback: THREE.Vector3, origin: THREE.Vector3, tags: string[], kind }
  applyHit(attacker, defender, hit) {
    const events = [];
    let amount = hit.amount;

    // --- C group hook 1: guard ---
    const guard = defender.guard;
    if (guard && guard.durability > 0 && withinGuardArc(defender, hit.origin)) {
      const reduced = amount * guard.reduction;
      amount -= reduced;
      guard.durability -= hit.amount * guard.wearRate;
      events.push({ type: 'guard_block', reduced, x: defender.mesh.position.x, z: defender.mesh.position.z });
      if (guard.durability <= 0) {
        guard.durability = 0;
        guard.broken = true;
        events.push({ type: 'guard_break' });
      }
    }

    // --- B group hook: charge_store accumulates from the *raw* impact, not
    //     from what finally lands on HP. It never reduces damage. ---
    if (defender.chargeStore && defender.chargeStore.sources.includes(hit.kind)) {
      const cs = defender.chargeStore;
      cs.value = Math.min(cs.max, cs.value + hit.amount * cs.rate);
      events.push({ type: 'charge_gain', value: cs.value, max: cs.max });
    }

    // --- C group hook 2: damage_defer ---
    if (defender.damageDefer && hit.amount >= defender.damageDefer.threshold) {
      const dd = defender.damageDefer;
      const deferredTotal = amount * dd.deferRate;
      const immediate = amount - deferredTotal;
      amount = immediate;
      defender.deferQueue.push({
        remaining: deferredTotal,
        stagesLeft: dd.stages,
        stageAmount: deferredTotal / dd.stages,
        intervalMs: dd.intervalMs,
        nextTickAt: performance.now() + dd.intervalMs,
      });
      defender.fractureStage = Math.min(dd.stages, defender.fractureStage + 1);
      events.push({ type: 'defer_start', deferred: deferredTotal, stage: defender.fractureStage });
    }

    amount = Math.max(0, amount);
    defender.hp = Math.max(0, defender.hp - amount);

    // knockback, reduced by anchor resistance
    if (hit.knockback) {
      const resist = defender.anchor && defender.anchor.active ? defender.anchor.kbResistance : 0;
      defender.velocity.add(hit.knockback.clone().multiplyScalar(1 - resist));
      defender.hitstunUntil = performance.now() + 200;
    }

    // special gauge accumulates from combat only — never from waiting.
    // Self-inflicted damage (fall damage: attacker === defender) only
    // applies the "took damage" side — otherwise the same hit would stack
    // both multipliers onto one combatant, making deliberately falling off
    // a roof a more gauge-efficient move than actually getting hit.
    if (!hit.selfInflicted) {
      attacker.specialGauge = Math.min(GAUGE_MAX, attacker.specialGauge + amount * GAUGE_PER_DAMAGE_DEALT);
    }
    defender.specialGauge = Math.min(GAUGE_MAX, defender.specialGauge + amount * GAUGE_PER_DAMAGE_TAKEN);

    events.push({ type: 'hit', amount, hp: defender.hp });
    return { amount, events };
  }

  onPropDestroyed(attacker) {
    attacker.specialGauge = Math.min(GAUGE_MAX, attacker.specialGauge + GAUGE_PER_PROP_DESTROYED);
  }

  // advances deferred-damage queues (JADE GLASS style fracture ticking)
  tick(combatants) {
    const now = performance.now();
    for (const c of combatants) {
      if (!c.deferQueue.length) continue;
      for (let i = c.deferQueue.length - 1; i >= 0; i--) {
        const chunk = c.deferQueue[i];
        if (now < chunk.nextTickAt) continue;
        const amt = Math.min(chunk.stageAmount, chunk.remaining);
        c.hp = Math.max(0, c.hp - amt);
        chunk.remaining -= amt;
        chunk.stagesLeft -= 1;
        chunk.nextTickAt = now + chunk.intervalMs;
        if (chunk.stagesLeft <= 0 || chunk.remaining <= 0.001) {
          c.deferQueue.splice(i, 1);
          if (c.deferQueue.length === 0) c.fractureStage = Math.max(0, c.fractureStage - 1);
        }
      }
    }
  }
}
