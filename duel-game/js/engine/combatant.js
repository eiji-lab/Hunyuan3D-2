// engine/combatant.js — runtime state + body for one avatar.
//
// Body: if a shared glTF body template loaded (see modelLoader.js), each
// combatant gets its own skeleton-correct clone of it (tinted per avatar
// color, animated). If the model failed to load for any reason, this falls
// back to the original primitive box body so the game never hard-fails on
// a missing/broken asset. Per-avatar sculpting is a later phase either way
// (see project brief §7) — this only replaces "boxes" with "a humanoid".

import * as THREE from '../vendor/three.module.js';
import { cloneBody } from './modelLoader.js';

// RobotExpressive's raw rig is ~4.9 units tall; the city (props ~1 unit,
// stair rise ~1.1 units, melee reach 2.1-3.3) was built assuming a
// human-scale ~2.6-unit-tall combatant, so the model needs scaling down.
const MODEL_SCALE = 0.39;
const ANIM_NAMES = { idle: 'Idle', walk: 'Walking', run: 'Running', punch: 'Punch', death: 'Death' };

export class Combatant {
  constructor(avatarData, THREE_scene, bodyTemplate) {
    this.data = avatarData;
    this.name = avatarData.name.en;
    this.color = new THREE.Color(avatarData.color.hex);

    this.maxHp = avatarData.body.hp;
    this.hp = this.maxHp;
    this.specialGauge = 0;

    this.velocity = new THREE.Vector3();
    this.grounded = true;
    this.facingYaw = 0;
    this.moveSpeedBase = avatarData.body.moveSpeed;
    this.jumpPower = avatarData.body.jump * 9;
    this.reach = avatarData.body.reach;

    // pipeline hook slots — populated by avatarRuntime from the loadout
    this.guard = null; // { reduction, durability, maxDurability, wearRate, broken }
    this.damageDefer = null; // { threshold, deferRate, stages, intervalMs }
    this.deferQueue = [];
    this.fractureStage = 0;
    this.chargeStore = null; // { value, max, rate, sources: [] }
    this.resources = {}; // resourceId -> { current, max } — e.g. OLIVE WEDGE's COAT MISSILE ammo
    this.coatMode = 'grip'; // OLIVE WEDGE's SURFACE COAT tag toggle; unused by avatars without it

    this.anchor = { active: false, kbResistance: 0, moveMultiplier: 1, turnMultiplier: 1 };
    this.buffs = [];
    this.stateSlots = [null, null];

    this.cooldowns = {}; // abilityId -> readyAt (ms)
    this.attackWindup = 0; // 0..1, decays back to 0 for the swing-recovery animation
    this.pendingSwing = null; // { ctx, entry, effect, triggerAt, resolved }
    this.hitstunUntil = 0;
    this.moveMultiplier = 1;

    this.mixer = null;
    this.actions = {};
    this.currentActionName = null;
    this.deathPlayed = false;

    this.mesh = bodyTemplate ? this._buildModeledBody(avatarData, bodyTemplate) : this._buildPrimitiveBody(avatarData);
    THREE_scene.add(this.mesh);
  }

  _buildModeledBody(data, template) {
    const bulk = data.body.mass ?? 1;
    const group = new THREE.Group();
    const model = cloneBody(template);
    model.scale.setScalar(MODEL_SCALE * Math.sqrt(bulk));
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material && o.material.name === 'Main') {
          o.material = o.material.clone();
          o.material.color.copy(this.color);
          this.torsoMaterial = o.material;
        }
      }
    });
    group.add(model);
    this.modelRoot = model;

    if (!this.torsoMaterial) {
      // defensive fallback in case the rig's material naming ever changes
      model.traverse((o) => { if (o.isMesh && !this.torsoMaterial) this.torsoMaterial = o.material; });
    }

    this.mixer = new THREE.AnimationMixer(model);
    for (const [key, clipName] of Object.entries(ANIM_NAMES)) {
      const clip = THREE.AnimationClip.findByName(template.animations, clipName);
      if (clip) this.actions[key] = this.mixer.clipAction(clip);
    }
    this.playAnimation('idle');

    const handBone = model.getObjectByName('Hand.R');
    const weaponSocket = new THREE.Group();
    weaponSocket.rotation.set(0, Math.PI / 2, Math.PI / 2);
    (handBone ?? group).add(weaponSocket);
    this.weaponSocket = weaponSocket;

    return group;
  }

  playAnimation(key, { fadeTime = 0.25, once = false } = {}) {
    const action = this.actions[key];
    if (!action || this.currentActionName === key) return;
    const previous = this.currentActionName ? this.actions[this.currentActionName] : null;
    action.reset();
    if (once) {
      action.setLoop(THREE.LoopOnce);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat);
    }
    action.fadeIn(fadeTime).play();
    if (previous) previous.fadeOut(fadeTime);
    this.currentActionName = key;
  }

  _buildPrimitiveBody(data) {
    const bulk = data.body.mass ?? 1;
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.55, metalness: 0.25 });
    const darkMat = new THREE.MeshStandardMaterial({ color: this.color.clone().multiplyScalar(0.55), roughness: 0.7 });

    const torsoH = 1.1 * Math.sqrt(bulk);
    const torsoW = 0.75 * Math.sqrt(bulk);
    const legH = 0.9;

    const legs = new THREE.Mesh(new THREE.BoxGeometry(torsoW * 0.85, legH, torsoW * 0.6), darkMat);
    legs.position.y = legH / 2;
    legs.castShadow = true;
    group.add(legs);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW, torsoH, torsoW * 0.7), mat);
    torso.position.y = legH + torsoH / 2;
    torso.castShadow = true;
    group.add(torso);
    this.torsoMesh = torso;
    this.torsoMaterial = mat;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), darkMat);
    head.position.y = legH + torsoH + 0.28;
    head.castShadow = true;
    group.add(head);

    const armLen = 0.9 * Math.sqrt(bulk);
    const armGeo = new THREE.BoxGeometry(0.28 * Math.sqrt(bulk), armLen, 0.28 * Math.sqrt(bulk));
    const armL = new THREE.Mesh(armGeo, mat);
    armL.position.set(-(torsoW / 2 + 0.18), legH + torsoH - armLen / 2, 0);
    armL.castShadow = true;
    const armR = armL.clone();
    armR.position.x *= -1;
    group.add(armL, armR);
    this.rightArm = armR;

    // weapon socket on the right hand, populated by avatarRuntime per gear
    const weaponSocket = new THREE.Group();
    weaponSocket.position.set(-(torsoW / 2 + 0.18), legH + torsoH - armLen, 0);
    group.add(weaponSocket);
    this.weaponSocket = weaponSocket;

    group.position.set(0, 0, 0);
    return group;
  }

  position() {
    return this.mesh.position;
  }

  forwardVector() {
    return new THREE.Vector3(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
  }

  isAlive() {
    return this.hp > 0;
  }

  cooldownReady(id) {
    return !this.cooldowns[id] || performance.now() >= this.cooldowns[id];
  }

  setCooldown(id, ms) {
    this.cooldowns[id] = performance.now() + ms;
  }
}
