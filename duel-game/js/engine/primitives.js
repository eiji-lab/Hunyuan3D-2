// engine/primitives.js — the 14-word effect vocabulary. The engine itself
// knows nothing about any specific avatar; every ability in every avatar's
// JSON loadout resolves to one of these calls. Passive hooks (guard,
// damage_defer, charge_store, anchor) are *attached* at load time by
// avatarRuntime and read directly by pipeline.js / stateManager.js — the
// functions below are only the A-group "do something now" primitives plus
// the D-group snapshot/restore pair.

import * as THREE from '../vendor/three.module.js';

function findMeleeTarget(ctx, effect) {
  const origin = ctx.attacker.mesh.position;
  const forward = ctx.attacker.forwardVector();
  const arcCos = Math.cos((effect.arcDeg * Math.PI) / 360); // half-angle
  const candidates = [];

  if (ctx.defender && ctx.defender.isAlive()) {
    candidates.push({ kind: 'combatant', ref: ctx.defender, pos: ctx.defender.mesh.position });
  }
  for (const prop of ctx.engine.city.props) {
    if (!prop.alive) continue;
    candidates.push({ kind: 'prop', ref: prop, pos: prop.mesh.position });
  }

  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const to = c.pos.clone().sub(origin);
    to.y = 0;
    const dist = to.length();
    if (dist > effect.reach) continue;
    if (dist > 0.001) {
      const dir = to.clone().normalize();
      if (dir.dot(forward) < arcCos) continue;
    }
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  return best;
}

export function meleeAttack(ctx, entry, effect) {
  const attacker = ctx.attacker;
  if (!attacker.cooldownReady(entry.id) || attacker.pendingSwing) return { events: [] };
  attacker.setCooldown(entry.id, effect.cooldownMs);

  attacker.attackWindup = 1;
  attacker.pendingSwing = { entry, effect, ctx, triggerAt: performance.now() + effect.windupMs, resolved: false };
  attacker.playAnimation?.('punch', { fadeTime: 0.08, once: true });
  return { events: [{ type: 'windup', id: entry.id }] };
}

// called by main.js once the swing animation reaches impact time
export function resolveSwing(ctx, entry, effect) {
  const attacker = ctx.attacker;
  let bonus = 0;
  if (effect.consumesChargeId && attacker.chargeStore && attacker.chargeStore.id === effect.consumesChargeId) {
    bonus = attacker.chargeStore.value * (effect.chargeBonusRatio ?? 1);
  }
  const power = effect.power + bonus;
  const target = findMeleeTarget(ctx, effect);
  const events = [{ type: 'swing', power, consumedCharge: bonus }];

  if (target) {
    const forward = attacker.forwardVector();
    const knockback = forward.clone().multiplyScalar(effect.knockback ?? 0).setY(0.15 * (effect.knockback ?? 0));
    if (target.kind === 'combatant') {
      const result = ctx.engine.pipeline.applyHit(attacker, target.ref, {
        amount: power,
        knockback,
        origin: attacker.mesh.position.clone(),
        kind: 'melee',
      });
      events.push(...result.events, { type: 'hit_landed', x: target.ref.mesh.position.x, z: target.ref.mesh.position.z });
    } else {
      const destroyed = ctx.engine.city.damageProp(target.ref, power);
      if (destroyed) {
        ctx.engine.pipeline.onPropDestroyed(attacker);
        events.push({ type: 'prop_destroyed', x: target.ref.x, z: target.ref.z });
      } else {
        events.push({ type: 'prop_hit', x: target.ref.x, z: target.ref.z });
      }
    }
  } else {
    events.push({ type: 'whiff' });
    if (window.__DEBUG_MELEE) {
      const origin = attacker.mesh.position;
      const forward = attacker.forwardVector();
      const toDef = ctx.defender.mesh.position.clone().sub(origin).setY(0);
      console.log('[whiff]', attacker.name, 'dist=', toDef.length().toFixed(2), 'reach=', effect.reach,
        'dot=', forward.dot(toDef.clone().normalize()).toFixed(2), 'arcCos=', Math.cos((effect.arcDeg * Math.PI) / 360).toFixed(2));
    }
  }

  if (bonus > 0) attacker.chargeStore.value = 0;
  return events;
}

export function toggleAnchor(ctx, active) {
  const attacker = ctx.attacker;
  if (!attacker.anchorConfig) return [];
  const wasActive = attacker.anchor.active;
  ctx.engine.stateManager.setAnchor(attacker, active, attacker.anchorConfig);
  const events = [{ type: active ? 'anchor_on' : 'anchor_off' }];

  if (wasActive && !active) {
    const releaseEntry = attacker.activeLoadout.find((e) => e.trigger === 'on_anchor_release');
    if (releaseEntry) {
      for (const effect of releaseEntry.effects) {
        if (effect.type === 'self_state' && effect.kind === 'dash') {
          const impulse = attacker.forwardVector().multiplyScalar(effect.impulse);
          attacker.velocity.add(impulse);
          events.push({ type: 'counter_step' });
        }
      }
    }
  }
  return events;
}

export function surfaceWrite(ctx, effect) {
  const p = ctx.attacker.mesh.position;
  ctx.engine.city.surfaceGrid.paint(p.x, p.z, effect.radius ?? 3, effect.tag);
  return [{ type: 'surface_write', tag: effect.tag }];
}

export function globalFlip(ctx, effect) {
  ctx.engine.city.surfaceGrid.flipAll(effect.mapping);
  return [{ type: 'global_flip' }];
}

export function spawnProjectile(ctx, entry, effect) {
  const attacker = ctx.attacker;
  const origin = attacker.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0));
  const dir = attacker.forwardVector();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 8),
    new THREE.MeshStandardMaterial({ color: attacker.color, emissive: attacker.color, emissiveIntensity: 0.6 })
  );
  mesh.position.copy(origin);
  ctx.engine.scene.add(mesh);
  ctx.engine.projectiles.push({
    mesh, velocity: dir.clone().multiplyScalar(effect.speed ?? 20),
    attacker, effect, life: effect.lifeMs ?? 2500, bornAt: performance.now(),
  });
  return [{ type: 'projectile_spawned' }];
}

export function targetState(ctx, effect) {
  if (!ctx.defender) return [];
  ctx.engine.stateManager.addBuff(ctx.defender, {
    tag: effect.tag,
    durationMs: effect.durationMs,
    apply: (c) => { c.moveMultiplier = (c.moveMultiplier ?? 1) * (effect.moveMultiplier ?? 1); },
    onExpire: (c) => { c.moveMultiplier = 1; },
  });
  return [{ type: 'target_state', tag: effect.tag }];
}

export function selfState(ctx, effect) {
  if (effect.kind === 'dash') {
    ctx.attacker.velocity.add(ctx.attacker.forwardVector().multiplyScalar(effect.impulse));
    return [{ type: 'self_dash' }];
  }
  ctx.engine.stateManager.addBuff(ctx.attacker, { tag: effect.tag, durationMs: effect.durationMs });
  return [{ type: 'self_state', tag: effect.tag }];
}

export function snapshotState(ctx, effect) {
  ctx.engine.stateManager.snapshot(ctx.attacker, effect.slot ?? 0);
  return [{ type: 'state_snapshot', slot: effect.slot ?? 0 }];
}

export function restoreState(ctx, effect) {
  const ok = ctx.engine.stateManager.restore(ctx.attacker, effect.slot ?? 0);
  return [{ type: 'state_restore', ok }];
}
