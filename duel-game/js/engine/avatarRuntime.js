// engine/avatarRuntime.js — turns an avatar JSON document into a live
// Combatant: applies every passive hook (guard/damage_defer/charge_store/
// anchor) unlocked at the chosen level, builds the input-slot map the data
// itself declares, and attaches simple weapon geometry for gear entries.
//
// Nothing here is avatar-specific code — it only reads declarations.

import * as THREE from '../vendor/three.module.js';
import { Combatant } from './combatant.js';

export async function loadAvatarData(path) {
  // Bundled single-file builds (see build-artifact.mjs) have no server to
  // fetch from — they set window.__EMBEDDED_ASSETS__.avatars ahead of time
  // and this transparently prefers that over a network fetch. The normal
  // multi-file/http-server deployment never sets this global, so nothing
  // changes for it.
  const id = path.match(/([a-z_]+)\.json$/)?.[1];
  const embedded = window.__EMBEDDED_ASSETS__?.avatars?.[id];
  if (embedded) return embedded;

  const res = await fetch(path);
  if (!res.ok) throw new Error(`avatar data fetch failed: ${path} (${res.status})`);
  return res.json();
}

function applyPassiveEffect(combatant, entry, effect) {
  switch (effect.type) {
    case 'guard':
      combatant.guard = {
        reduction: effect.reduction,
        durability: effect.maxDurability,
        maxDurability: effect.maxDurability,
        wearRate: effect.wearRate,
        broken: false,
      };
      break;
    case 'damage_defer':
      combatant.damageDefer = {
        threshold: effect.threshold,
        deferRate: effect.deferRate,
        stages: effect.stages,
        intervalMs: effect.intervalMs,
      };
      break;
    case 'charge_store':
      combatant.chargeStore = { value: 0, max: effect.max, rate: effect.rate, sources: effect.sources, id: entry.id };
      break;
    case 'resource':
      combatant.resources[effect.id] = { current: effect.max, max: effect.max };
      break;
    case 'anchor':
      combatant.anchorConfig = {
        kbResistance: effect.kbResistance,
        moveMultiplier: effect.moveMultiplier,
        turnMultiplier: effect.turnMultiplier ?? 1,
      };
      break;
    default:
      break; // active effects resolve on trigger, not at load time
  }
}

// Accel World duels are not sword fights — canon avatars fight barehanded,
// by flight, by piston-driven rams, etc., and none of these three carry a
// blade. The shape AND the swing motion (see attackMotion / main.js
// updateSwingAnimation) both need to say "hammer" / "lance" / "roller",
// not just differ by a texture — a lance that swings like a sword still
// reads as a sword.
function attachWeaponVisual(combatant, entry, effect) {
  const mat = new THREE.MeshStandardMaterial({ color: combatant.color.clone().multiplyScalar(1.3), roughness: 0.4, metalness: 0.5 });
  let mesh;
  if (effect.weaponShape === 'lance') {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, effect.reach * 0.95, 8), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.z = effect.reach * 0.45;
  } else if (effect.weaponShape === 'roller') {
    // OLIVE WEDGE's TWIN ROLLER is a forearm-mounted drum, not a held
    // stick — short, thick, and close to the hand rather than out at
    // lance/hammer reach.
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.55, 14), mat);
    mesh.rotation.z = Math.PI / 2;
    mesh.position.z = effect.reach * 0.2;
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, effect.reach * 0.8), mat);
    mesh.position.z = effect.reach * 0.35;
  }
  mesh.castShadow = true;
  combatant.weaponSocket.add(mesh);
  combatant.weaponMesh = mesh;
  combatant.weaponBaseZ = mesh.position.z;
  combatant.weaponBaseRotation = mesh.rotation.clone();
  combatant.attackMotion = effect.attackMotion ?? 'swing';
}

export function buildCombatant(avatarData, level, scene, bodyTemplate) {
  const data = JSON.parse(JSON.stringify(avatarData));
  data.level = level;
  const combatant = new Combatant(data, scene, bodyTemplate);
  combatant.controls = data.controls || [];
  combatant.hudSpec = data.hud || {};

  const entries = (data.loadout || []).filter((e) => e.level <= level).sort((a, b) => a.level - b.level);
  combatant.activeLoadout = entries;

  for (const entry of entries) {
    for (const effect of entry.effects) {
      applyPassiveEffect(combatant, entry, effect);
      if (effect.type === 'melee' && entry.layer === 'gear') {
        attachWeaponVisual(combatant, entry, effect);
      }
    }
  }

  combatant.inputEntries = entries.filter((e) => e.input);
  return combatant;
}
