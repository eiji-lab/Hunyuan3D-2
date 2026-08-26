// ai/aiController.js — behavior-template AI with deliberate human-like
// imprecision. It never inspects an avatar by name; it only reads generic
// signals available to any combatant (distance, cooldown state, own
// input-slot declarations) so the same controller can pilot any avatar.
//
// Imperfections modeled, per the design brief's explicit requirement that
// no NPC may act with 100% precision:
//  - range misjudgment (noisy distance estimate)
//  - reaction delay before acting on a new observation
//  - hesitation: a random chance per tick to simply do nothing
//  - miss chance on the attack trigger itself
//  - cooldown jitter: never fires the instant a cooldown clears

import * as THREE from '../vendor/three.module.js';
import { STEP_UP } from '../field/city.js';

export function createAIState() {
  return {
    reactionTimer: 0,
    nextDecisionAt: 0,
    hesitating: false,
    anchorHeld: false,
    anchorToggleAt: 0,
    lastRangeNoise: 0,
    retreatUntil: 0,
    stuckTimer: 0,
    lastCheckedPos: new THREE.Vector3(),
    avoidSign: 1,
  };
}

// Straight-line-to-target steering fails constantly in a city of rectangular
// blocks — the AI needs to know when a building is actually in its way and
// slide along its edge instead of pushing uselessly into the wall. This is
// intentionally simple (no navmesh): find the block AABB dead ahead, and
// steer along whichever side of it is nearer, biased back toward the target.
function steerAroundObstacles(city, self, dir, ai, dt) {
  const lookAhead = 3.2;
  const aheadX = self.mesh.position.x + dir.x * lookAhead;
  const aheadZ = self.mesh.position.z + dir.z * lookAhead;
  let blocker = null;
  for (const b of city.buildings) {
    if (aheadX >= b.x0 && aheadX <= b.x1 && aheadZ >= b.z0 && aheadZ <= b.z1) {
      if (b.h - self.mesh.position.y > STEP_UP) { blocker = b; break; }
    }
  }

  // stuck-breakout: if barely moving for a while (wedged in a corner),
  // force a stronger, randomized lateral kick until it breaks free
  const moved = self.mesh.position.distanceTo(ai.lastCheckedPos);
  ai.lastCheckedPos.copy(self.mesh.position);
  if (moved < 0.03) ai.stuckTimer += dt; else ai.stuckTimer = Math.max(0, ai.stuckTimer - dt * 2);

  if (!blocker && ai.stuckTimer < 0.6) return dir;

  const centerX = (blocker ? (blocker.x0 + blocker.x1) / 2 : self.mesh.position.x);
  const centerZ = (blocker ? (blocker.z0 + blocker.z1) / 2 : self.mesh.position.z);
  const toCenter = new THREE.Vector3(centerX - self.mesh.position.x, 0, centerZ - self.mesh.position.z);
  const perp = new THREE.Vector3(dir.z, 0, -dir.x);

  if (ai.stuckTimer > 0.6) {
    // been wedged for a while: commit hard to one side until it clears
    if (ai.stuckTimer < 0.62) ai.avoidSign = Math.random() < 0.5 ? 1 : -1;
    return dir.clone().multiplyScalar(0.2).addScaledVector(perp, ai.avoidSign).normalize();
  }

  const sign = perp.dot(toCenter) > 0 ? -1 : 1; // steer to the side the obstacle center is NOT on
  ai.avoidSign = sign;
  return dir.clone().multiplyScalar(0.45).addScaledVector(perp, sign * 0.95).normalize();
}

function noisyDistance(trueDist, ai) {
  // range misjudgment updates on its own cadence, not every frame — an AI
  // that re-measures perfectly every tick is not "human enough"
  if (performance.now() > ai.nextDecisionAt) {
    ai.lastRangeNoise = (Math.random() - 0.5) * 1.6;
    ai.nextDecisionAt = performance.now() + 180 + Math.random() * 220;
  }
  return trueDist + ai.lastRangeNoise;
}

export function tickAI(ai, self, opponent, city, dt) {
  const move = new THREE.Vector3();
  const result = { triggeredEntryIds: [], heldSlots: new Set(), move, wantsJump: false };

  if (!self.isAlive() || !opponent.isAlive()) return result;

  const toOpponent = opponent.mesh.position.clone().sub(self.mesh.position);
  toOpponent.y = 0;
  const trueDist = toOpponent.length();
  const dist = noisyDistance(trueDist, ai);
  const dir = trueDist > 0.001 ? toOpponent.clone().normalize() : new THREE.Vector3(0, 0, 1);

  // hesitation: brief random freezes so movement doesn't read as a script
  ai.reactionTimer -= dt;
  if (ai.reactionTimer <= 0) {
    ai.hesitating = Math.random() < 0.12;
    ai.reactionTimer = 0.25 + Math.random() * 0.5;
  }

  const lowHp = self.hp / self.maxHp < 0.28;
  if (lowHp && performance.now() > ai.retreatUntil && Math.random() < 0.004) {
    ai.retreatUntil = performance.now() + 900 + Math.random() * 900;
  }
  const retreating = performance.now() < ai.retreatUntil;

  const meleeEntries = self.activeLoadout.filter((e) => e.input && e.effects.some((fx) => fx.type === 'melee'));
  const anchorEntry = self.activeLoadout.find((e) => e.input && e.effects.some((fx) => fx.type === 'anchor'));
  const primaryReach = meleeEntries[0]?.effects.find((fx) => fx.type === 'melee')?.reach ?? 2;

  if (!ai.hesitating) {
    if (retreating) {
      move.copy(dir).multiplyScalar(-1);
    } else if (dist > primaryReach * 0.85) {
      move.copy(dir);
    } else {
      // in range: mostly hold ground, drift slightly to avoid looking static
      move.set(Math.sin(performance.now() * 0.001 + self.mesh.id) * 0.15, 0, 0);
    }
  }

  // attack decision: reaction delay + accuracy roll, never instant-on-cooldown.
  // The attempt roll is a rate-per-second scaled by dt rather than a flat
  // per-frame chance — a flat per-frame roll would make the AI attack ~9x
  // more often at 60fps than at 7fps, which is exactly the kind of
  // frame-rate-coupled behavior that made this untestable headlessly and
  // would also make it play differently across users' machines.
  const ATTACK_ATTEMPTS_PER_SEC = 2.4;
  if (!retreating && meleeEntries.length && trueDist <= primaryReach * 1.05) {
    const entry = meleeEntries[0];
    if (self.cooldownReady(entry.id) && Math.random() < ATTACK_ATTEMPTS_PER_SEC * dt) {
      const accuracyRoll = Math.random();
      if (accuracyRoll < 0.82) {
        result.triggeredEntryIds.push(entry.id);
      }
    }
  }

  // anchor: brace when the opponent is close and not currently retreating,
  // release periodically rather than holding forever (jittered duty cycle)
  if (anchorEntry) {
    if (!ai.anchorHeld && trueDist < primaryReach * 1.3 && !retreating && performance.now() > ai.anchorToggleAt) {
      ai.anchorHeld = Math.random() < 0.5;
      ai.anchorToggleAt = performance.now() + 900 + Math.random() * 1200;
    } else if (ai.anchorHeld && (trueDist > primaryReach * 1.6 || performance.now() > ai.anchorToggleAt)) {
      ai.anchorHeld = false;
      ai.anchorToggleAt = performance.now() + 600 + Math.random() * 800;
    }
    if (ai.anchorHeld) result.heldSlots.add(anchorEntry.input.slot);
  }

  if (move.lengthSq() > 0) {
    move.normalize();
    const steered = steerAroundObstacles(city, self, move, ai, dt);
    move.copy(steered);
  }
  return result;
}
