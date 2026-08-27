import * as THREE from './vendor/three.module.js';
import { buildCity } from './field/city.js';
import { buildCombatant, loadAvatarData } from './engine/avatarRuntime.js';
import { DamagePipeline } from './engine/pipeline.js';
import { StateManager } from './engine/stateManager.js';
import * as primitives from './engine/primitives.js';
import { VfxSystem } from './engine/vfx.js';
import { KeyState } from './input/keyState.js';
import { pollAvatarInput } from './engine/inputManager.js';
import { ThirdPersonCamera } from './camera/thirdPersonCamera.js';
import { createAIState, tickAI } from './ai/aiController.js';
import { HUD } from './hud/hud.js';
import { loadBodyTemplate } from './engine/modelLoader.js';
import { playSfx } from './engine/audio.js';

const AVATAR_LIST = [
  { id: 'celadon_anvil', path: './js/avatars/celadon_anvil.json' },
  { id: 'jade_glass', path: './js/avatars/jade_glass.json' },
  { id: 'olive_wedge', path: './js/avatars/olive_wedge.json' },
];
const ROUND_TIME_SEC = 90;
const COUNTDOWN_SEC = 3;
const GRAVITY = 24;
// A fall/knockback off a rooftop or bridge edge only means something if
// landing hurts. Ordinary jumps (small hops, stepping off a low ledge) stay
// free — only a fall faster than FALL_SAFE_SPEED starts costing HP. This is
// also what makes CELADON ANVIL's IMPACT RESERVE "fall" charge source (see
// celadon_anvil.json) actually reachable — it was declared but never fed.
const FALL_SAFE_SPEED = 14;
const FALL_DAMAGE_PER_SPEED = 6;

// test-only simulation speedup (?turbo=N in the URL). Real play never sets
// this; it exists so automated verification isn't bottlenecked by a
// headless/no-GPU environment's render fps, which caps how much wall-clock
// time can be converted into simulated seconds. Movement/attack logic is
// unaffected in shape — only how much sim-time each rendered frame covers.
// clamped to 8: higher values were observed to occasionally wedge the AI's
// obstacle-avoidance into a permanent stuck state, because the physics
// timestep gets large enough to jump clean through a corner's escape route
// in one frame. Real play (turbo unset) is unaffected — its dt is capped at
// 0.05 real seconds before this multiplier is even applied.
const TIME_SCALE = Math.max(1, Math.min(8, parseFloat(new URLSearchParams(location.search).get('turbo')) || 1));

// ---------------------------------------------------------------- bootstrap
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 500);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const city = buildCity(scene, { seed: 20260826 });
const pipeline = new DamagePipeline();
const stateManager = new StateManager();
const vfx = new VfxSystem(scene);
const keys = new KeyState();
const tpCamera = new ThirdPersonCamera(camera, renderer.domElement, city.raycastMeshes);
const engine = { scene, city, pipeline, stateManager, projectiles: [] };

const hud = new HUD(
  document.getElementById('hud-left'),
  document.getElementById('hud-right'),
  document.getElementById('hud-timer'),
  document.getElementById('hud-result')
);

const overlaySelect = document.getElementById('select-overlay');
const overlayCountdown = document.getElementById('countdown-overlay');
const overlayCountdownText = document.getElementById('countdown-text');
const overlayResult = document.getElementById('hud-result');
const rematchBtn = document.getElementById('rematch-btn');

let avatarDataCache = {};
let bodyTemplate = null;
let player, opponent, aiState;
let matchState = 'loading'; // loading | select | countdown | battle | result
let countdownRemaining = COUNTDOWN_SEC;
let roundTimeRemaining = ROUND_TIME_SEC;
const prevHeld = { player: new Set(), opponent: new Set() };

// -------------------------------------------------------------- avatar load
async function preloadAvatars() {
  for (const a of AVATAR_LIST) avatarDataCache[a.id] = await loadAvatarData(a.path);
  bodyTemplate = await loadBodyTemplate(); // null if the asset failed to load — Combatant falls back to primitives
}

function setupSelectScreen() {
  overlaySelect.innerHTML = '';
  for (const a of AVATAR_LIST) {
    const data = avatarDataCache[a.id];
    const btn = document.createElement('button');
    btn.className = 'select-card';
    btn.style.setProperty('--avatar-color', data.color.hex);
    btn.innerHTML = `
      <div class="select-swatch"></div>
      <div class="select-name">${data.name.en}</div>
      <div class="select-sub">${data.name.ja}</div>
      <div class="select-type">${data.type.join(' / ')}</div>`;
    btn.addEventListener('click', () => {
      overlaySelect.classList.remove('visible');
      startMatch(a.id);
    });
    overlaySelect.appendChild(btn);
  }
  overlaySelect.classList.add('visible');
  matchState = 'select';
}

function clearCombatants() {
  if (player) scene.remove(player.mesh);
  if (opponent) scene.remove(opponent.mesh);
}

function startMatch(playerId) {
  clearCombatants();
  const remaining = AVATAR_LIST.filter((a) => a.id !== playerId);
  const opponentDef = remaining[Math.floor(Math.random() * remaining.length)];
  player = buildCombatant(avatarDataCache[playerId], avatarDataCache[playerId].level, scene, bodyTemplate);
  opponent = buildCombatant(avatarDataCache[opponentDef.id], avatarDataCache[opponentDef.id].level, scene, bodyTemplate);

  const sp = city.spawnPoints;
  player.mesh.position.set(sp[0].x, 0, sp[0].z);
  opponent.mesh.position.set(sp[1].x, 0, sp[1].z);
  player.facingYaw = Math.atan2(sp[1].x - sp[0].x, sp[1].z - sp[0].z);
  opponent.facingYaw = Math.atan2(sp[0].x - sp[1].x, sp[0].z - sp[1].z);
  player.mesh.rotation.y = player.facingYaw;
  opponent.mesh.rotation.y = opponent.facingYaw;
  engine.projectiles.length = 0;

  aiState = createAIState();
  tpCamera.yaw = player.facingYaw + Math.PI;
  prevHeld.player.clear();
  prevHeld.opponent.clear();

  hud.init(player, opponent);
  overlayResult.classList.remove('visible');
  countdownRemaining = COUNTDOWN_SEC;
  roundTimeRemaining = ROUND_TIME_SEC;
  matchState = 'countdown';
  overlayCountdown.classList.add('visible');
}

rematchBtn.addEventListener('click', () => setupSelectScreen());

// ----------------------------------------------------------------- combat
function buildCtx(attacker, defender) {
  return { engine, attacker, defender };
}

const debugEventLog = [];
function handleEvents(attacker, defender, events) {
  for (const ev of events) {
    debugEventLog.push({ t: Math.round(performance.now()), attacker: attacker.name, type: ev.type });
    if (debugEventLog.length > 200) debugEventLog.shift();
    switch (ev.type) {
      case 'hit':
        vfx.spawnBurst(defender.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xffdd66);
        break;
      case 'guard_block':
        vfx.spawnBurst(defender.mesh.position.clone().add(new THREE.Vector3(0, 1.3, 0)), 0x9fd0ff, 6, 3);
        break;
      case 'guard_break':
        vfx.spawnBurst(defender.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)), 0xffffff, 16, 6);
        break;
      case 'prop_destroyed':
        vfx.spawnDebris(new THREE.Vector3(ev.x, 1, ev.z), 0xb5744a);
        break;
      case 'counter_step':
        vfx.spawnBurst(attacker.mesh.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xdddddd, 5, 2);
        break;
      case 'surface_write': {
        const color = ev.tag === 'slip' ? 0x6fa8d8 : 0x8fbf6a;
        vfx.spawnBurst(new THREE.Vector3(ev.x, 0.3, ev.z), color, 8, 2.5);
        break;
      }
      case 'global_flip':
        vfx.spawnBurst(attacker.mesh.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xffffff, 10, 3);
        break;
      case 'mode_toggle':
        vfx.spawnBurst(attacker.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 0)), ev.mode === 'slip' ? 0x6fa8d8 : 0x8fbf6a, 4, 1.5);
        break;
      default:
        break;
    }
  }
}

function processInput(self, opponentRef, inputResult, prevHeldSet) {
  for (const entryId of inputResult.triggeredEntryIds) {
    const entry = self.activeLoadout.find((e) => e.id === entryId);
    if (!entry) continue;

    // 必殺技ゲージ消費: gated at the entry level so a special with
    // insufficient gauge simply does nothing (no partial effect, no
    // refund needed) — engine-generic, not specific to any one avatar.
    if (entry.layer === 'special' && entry.gaugeCost) {
      if (self.specialGauge < entry.gaugeCost) continue;
      self.specialGauge -= entry.gaugeCost;
      playSfx(entry.id); // technique-name voice line hook, once a file exists
    }

    for (const effect of entry.effects) {
      const events = primitives.runTriggeredEffect(buildCtx(self, opponentRef), entry, effect);
      handleEvents(self, opponentRef, events);
    }
  }
  for (const control of self.controls) {
    if (control.mode !== 'hold') continue;
    const nowHeld = inputResult.heldSlots.has(control.slot);
    const wasHeld = prevHeldSet.has(control.slot);
    if (nowHeld && !wasHeld) {
      primitives.toggleAnchor(buildCtx(self, opponentRef), true);
    } else if (!nowHeld && wasHeld) {
      const events = primitives.toggleAnchor(buildCtx(self, opponentRef), false);
      handleEvents(self, opponentRef, events);
    }
  }
  prevHeldSet.clear();
  for (const s of inputResult.heldSlots) prevHeldSet.add(s);
}

function resolvePendingSwings() {
  for (const c of [player, opponent]) {
    if (c.pendingSwing && !c.pendingSwing.resolved && performance.now() >= c.pendingSwing.triggerAt) {
      const { ctx, entry, effect } = c.pendingSwing;
      const events = primitives.resolveSwing(ctx, entry, effect);
      handleEvents(ctx.attacker, ctx.defender, events);
      c.pendingSwing.resolved = true;
      c.pendingSwing = null;
    }
  }
}

function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function updateFacing(combatant, opponent, moveVec, dt) {
  // Movement direction drives facing at range, but melee aiming needs a
  // combatant to square up to its target once close — otherwise sidestepping
  // around an obstacle (AI) or simply stopping (player) leaves them facing
  // some stale movement heading while standing right next to the opponent,
  // and every attack's arc check whiffs even at point-blank range.
  const engageRange = combatant.reach * 2.6;
  const distToOpp = combatant.mesh.position.distanceTo(opponent.mesh.position);
  let desiredYaw = null;
  if (opponent.isAlive() && distToOpp < engageRange) {
    const toOpp = opponent.mesh.position.clone().sub(combatant.mesh.position);
    desiredYaw = Math.atan2(toOpp.x, toOpp.z);
  } else if (moveVec.lengthSq() > 0.0001) {
    desiredYaw = Math.atan2(moveVec.x, moveVec.z);
  }
  if (desiredYaw !== null) {
    const turnSpeed = 9 * (combatant.anchor.active ? combatant.anchor.turnMultiplier : 1);
    combatant.facingYaw = lerpAngle(combatant.facingYaw, desiredYaw, Math.min(1, turnSpeed * dt));
  }
}

function stepMovement(combatant, moveVec, wantsJump, dt) {
  const inHitstun = performance.now() < combatant.hitstunUntil;
  const speed = combatant.moveSpeedBase * (combatant.anchor.active ? combatant.anchor.moveMultiplier : 1) * combatant.moveMultiplier;
  const wasGrounded = combatant.grounded;

  if (!inHitstun) {
    combatant.velocity.x = moveVec.x * speed;
    combatant.velocity.z = moveVec.z * speed;
    if (wantsJump && combatant.grounded) combatant.velocity.y = combatant.jumpPower;
  } else {
    combatant.velocity.x *= 0.88;
    combatant.velocity.z *= 0.88;
  }

  combatant.velocity.y = Math.max(-28, combatant.velocity.y - GRAVITY * dt);
  const fallSpeedThisFrame = -combatant.velocity.y;

  const next = combatant.mesh.position.clone().addScaledVector(combatant.velocity, dt);
  const ground = city.resolveGroundHeight(next.x, next.z, combatant.mesh.position.y);
  if (ground.blocked) {
    next.x = combatant.mesh.position.x;
    next.z = combatant.mesh.position.z;
    combatant.velocity.x = 0;
    combatant.velocity.z = 0;
  }
  if (next.y <= ground.height) {
    if (!wasGrounded && matchState === 'battle') {
      const excess = fallSpeedThisFrame - FALL_SAFE_SPEED;
      if (excess > 0) {
        const amount = excess * FALL_DAMAGE_PER_SPEED;
        const result = pipeline.applyHit(combatant, combatant, {
          amount, knockback: null, origin: null, kind: 'fall', selfInflicted: true,
        });
        handleEvents(combatant, combatant, result.events);
        vfx.spawnBurst(next.clone().add(new THREE.Vector3(0, 0.2, 0)), 0xd8d8d0, 10, 3);
      }
    }
    next.y = ground.height;
    combatant.velocity.y = 0;
    combatant.grounded = true;
  } else {
    combatant.grounded = false;
  }

  const half = city.citySize / 2 - 1;
  next.x = Math.max(-half, Math.min(half, next.x));
  next.z = Math.max(-half, Math.min(half, next.z));
  combatant.mesh.position.copy(next);
  combatant.mesh.rotation.y = combatant.facingYaw;
}

function updateSwingAnimation(combatant, dt) {
  combatant.attackWindup = Math.max(0, combatant.attackWindup - dt * 2.4);
  // the modeled body swings via its own 'Punch' skeletal clip (triggered in
  // primitives.meleeAttack) — this manual socket-rotation hack is only for
  // the primitive-box fallback body, which has no skeleton to animate it.
  if (!combatant.mixer && combatant.weaponSocket) {
    combatant.weaponSocket.rotation.x = -combatant.attackWindup * 1.25;
  }
}

function updateCharacterAnimation(combatant, horizontalSpeed) {
  if (!combatant.mixer) return;
  if (!combatant.isAlive()) {
    if (!combatant.deathPlayed) {
      combatant.deathPlayed = true;
      combatant.playAnimation('death', { fadeTime: 0.3, once: true });
    }
    return;
  }
  const punching = combatant.currentActionName === 'punch' && combatant.actions.punch?.isRunning();
  if (punching) return;
  combatant.playAnimation(horizontalSpeed > 0.4 ? 'run' : 'idle');
}

function updatePassiveVisuals(combatant) {
  if (combatant.damageDefer) {
    const t = combatant.fractureStage / combatant.damageDefer.stages;
    combatant.torsoMaterial.emissive = new THREE.Color(0xffffff);
    combatant.torsoMaterial.emissiveIntensity = t * 0.55;
  }
  if (combatant.chargeStore) {
    const t = combatant.chargeStore.value / combatant.chargeStore.max;
    if (combatant.weaponMesh) {
      combatant.weaponMesh.material.emissiveIntensity = 0.2 + t * 0.75;
    }
  }
}

// ------------------------------------------------------------- projectiles
function updateProjectiles(dt) {
  const now = performance.now();
  for (let i = engine.projectiles.length - 1; i >= 0; i--) {
    const p = engine.projectiles[i];
    const priorY = p.mesh.position.y;
    p.mesh.position.addScaledVector(p.velocity, dt);
    const targets = p.attacker === player ? opponent : player;
    const dist = p.mesh.position.distanceTo(targets.mesh.position);
    let impactPos = null;

    if (dist < 0.9 && targets.isAlive()) {
      const result = pipeline.applyHit(p.attacker, targets, {
        amount: p.effect.power ?? 10,
        knockback: p.velocity.clone().setY(0.2).normalize().multiplyScalar(3),
        origin: p.mesh.position.clone(),
        kind: 'projectile',
      });
      handleEvents(p.attacker, targets, result.events);
      impactPos = p.mesh.position.clone();
    } else {
      // wall/ground/rooftop impact — a missile that misses the opponent
      // still splatters wherever it lands (OLIVE WEDGE's COAT MISSILE:
      // "着弾時に周囲へ塗膜を散布する" — the payload isn't opponent-only)
      const ground = city.resolveGroundHeight(p.mesh.position.x, p.mesh.position.z, priorY);
      if (ground.blocked || p.mesh.position.y <= ground.height) {
        impactPos = p.mesh.position.clone();
        impactPos.y = Math.max(ground.height, 0);
      }
    }

    if (impactPos && p.effect.paintRadius) {
      const tag = p.effect.useCurrentMode ? p.attacker.coatMode : p.effect.tag;
      city.surfaceGrid.paint(impactPos.x, impactPos.z, p.effect.paintRadius, tag);
      handleEvents(p.attacker, p.attacker, [{ type: 'surface_write', tag, x: impactPos.x, z: impactPos.z }]);
    }

    if (impactPos || now - p.bornAt > p.life) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      engine.projectiles.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------------ result
function checkRoundEnd() {
  if (matchState !== 'battle') return;
  if (!player.isAlive() || !opponent.isAlive()) {
    endRound(!player.isAlive() && !opponent.isAlive() ? null : player.isAlive() ? player : opponent, 'KO');
    return;
  }
  if (roundTimeRemaining <= 0) {
    if (player.hp === opponent.hp) endRound(null, 'TIME UP');
    else endRound(player.hp > opponent.hp ? player : opponent, 'TIME UP');
  }
}

function endRound(winner, reason) {
  matchState = 'result';
  const text = winner ? `${winner.name} WINS — ${reason}` : `DRAW — ${reason}`;
  hud.showResult(text);
}

// ------------------------------------------------------------------ camera relative movement
function computeMoveVector() {
  // tpCamera.yaw is the offset FROM the target TO the camera (see
  // ThirdPersonCamera.update); the direction the player should walk toward
  // on "forward" is the opposite of that offset, i.e. where the camera is
  // actually looking.
  const yaw = tpCamera.forwardYaw() + Math.PI;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const v = new THREE.Vector3();
  if (keys.isDown('KeyW')) v.add(forward);
  if (keys.isDown('KeyS')) v.sub(forward);
  if (keys.isDown('KeyD')) v.add(right);
  if (keys.isDown('KeyA')) v.sub(right);
  if (v.lengthSq() > 0) v.normalize();
  return v;
}

// ----------------------------------------------------------------- main loop
const fpsEl = document.getElementById('fps-counter');
let fpsFrames = 0;
let fpsWindowStart = performance.now();

let lastTime = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000) * TIME_SCALE;
  lastTime = now;

  if (matchState === 'countdown') {
    countdownRemaining -= dt;
    if (countdownRemaining > 0) {
      overlayCountdownText.textContent = Math.ceil(countdownRemaining).toString();
    } else {
      overlayCountdownText.textContent = 'FIGHT';
      if (countdownRemaining < -0.7) {
        overlayCountdown.classList.remove('visible');
        matchState = 'battle';
      }
    }
  }

  if (matchState === 'battle' || matchState === 'countdown') {
    // movement/camera are live during countdown too (approach phase readable
    // from the very first frame), abilities are gated to 'battle' only
    const playerInput = pollAvatarInput(player, keys);
    const aiInput = tickAI(aiState, opponent, player, city, dt);

    // facing is updated before swings resolve (not after) so a melee arc
    // check always reads this frame's bearing to the target rather than the
    // previous frame's — at close range even one frame of lag is enough for
    // a shuffle-step to flip which way the target actually is, which was
    // whiffing point-blank hits during testing.
    const playerMove = computeMoveVector();
    updateFacing(player, opponent, playerMove, dt);
    updateFacing(opponent, player, aiInput.move, dt);

    if (matchState === 'battle') {
      processInput(player, opponent, playerInput, prevHeld.player);
      processInput(opponent, player, aiInput, prevHeld.opponent);
      resolvePendingSwings();
      pipeline.tick([player, opponent]);
      stateManager.tick(dt, [player, opponent]);
      roundTimeRemaining -= dt;
    }

    stepMovement(player, playerMove, keys.wasPressed('Space'), dt);
    stepMovement(opponent, aiInput.move, false, dt);

    updateSwingAnimation(player, dt);
    updateSwingAnimation(opponent, dt);
    updateCharacterAnimation(player, Math.hypot(player.velocity.x, player.velocity.z));
    updateCharacterAnimation(opponent, Math.hypot(opponent.velocity.x, opponent.velocity.z));
    if (player.mixer) player.mixer.update(dt);
    if (opponent.mixer) opponent.mixer.update(dt);
    updatePassiveVisuals(player);
    updatePassiveVisuals(opponent);
    updateProjectiles(dt);
    vfx.update(dt);
    tpCamera.update(player.mesh.position, dt);
    hud.update(player, opponent, roundTimeRemaining);
    checkRoundEnd();
  }

  keys.endFrame();
  renderer.render(scene, camera);

  fpsFrames++;
  if (now - fpsWindowStart >= 500) {
    const fps = (fpsFrames * 1000) / (now - fpsWindowStart);
    fpsEl.textContent = `${fps.toFixed(0)} fps`;
    fpsFrames = 0;
    fpsWindowStart = now;
  }
}

preloadAvatars().then(() => {
  setupSelectScreen();
  lastTime = performance.now();
  requestAnimationFrame(frame);
});

// debug/test hook only — read-only introspection for the verification script
window.__game = {
  getState: () => ({
    matchState,
    playerPos: player ? player.mesh.position.toArray() : null,
    opponentPos: opponent ? opponent.mesh.position.toArray() : null,
    playerHp: player ? player.hp : null,
    opponentHp: opponent ? opponent.hp : null,
    roundTimeRemaining,
    keysDown: Array.from(keys.down),
    fps: fpsEl.textContent,
    playerCharge: player && player.chargeStore ? player.chargeStore.value : null,
    playerGauge: player ? player.specialGauge : null,
  }),
  getStairs: () => city.stairs.map((s) => ({ minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ, axis: s.axis, sign: s.sign, base: s.base, run: s.run, height: s.height })),
  getBuildings: () => city.buildings.map((b) => ({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, h: b.h })),
  getPlayerBBox: () => {
    const box = new THREE.Box3().setFromObject(player.mesh);
    return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
  },
  teleportPlayer: (x, y, z) => { player.mesh.position.set(x, y, z); player.velocity.set(0, 0, 0); },
  setPlayerGauge: (v) => { player.specialGauge = v; },
  getEventLog: () => debugEventLog.slice(),
};
