// engine/combatant.js — runtime state + primitive-shaped body for one avatar.
// Body geometry is intentionally primitive (boxes/capsules): modeling is out
// of scope for this phase, only silhouette/color communicate the avatar.

import * as THREE from '../vendor/three.module.js';

export class Combatant {
  constructor(avatarData, THREE_scene) {
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

    this.anchor = { active: false, kbResistance: 0, moveMultiplier: 1, turnMultiplier: 1 };
    this.buffs = [];
    this.stateSlots = [null, null];

    this.cooldowns = {}; // abilityId -> readyAt (ms)
    this.attackWindup = 0; // 0..1, decays back to 0 for the swing-recovery animation
    this.pendingSwing = null; // { ctx, entry, effect, triggerAt, resolved }
    this.hitstunUntil = 0;
    this.moveMultiplier = 1;

    this.mesh = this._buildBody(avatarData);
    THREE_scene.add(this.mesh);
  }

  _buildBody(data) {
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
