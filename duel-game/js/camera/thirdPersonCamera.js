// camera/thirdPersonCamera.js — mouse-orbit third-person camera with a
// raycast pull-in so it never clips into a building, plus two combat-
// readability behaviors that were previously entirely missing:
//   1. a dynamic pull-back/zoom-out the closer the opponent is, so a
//      melee clash doesn't happen at a distance where one fighter is
//      cropped out of frame;
//   2. a soft yaw-recovery assist that only kicks in once the opponent has
//      drifted well outside view AND the player hasn't touched the mouse
//      recently — it nudges the camera back toward them rather than
//      leaving them permanently offscreen, without fighting active aim.

import * as THREE from '../vendor/three.module.js';

const BASE_DISTANCE = 7.5;
const COMBAT_DISTANCE_BONUS = 3.4; // added when the opponent is close
const COMBAT_RANGE = 18; // beyond this, no zoom-out bonus applies
const RECOVERY_ANGLE = 1.9; // radians off-center before recovery assist engages
const RECOVERY_SPEED = 2.4; // rad/s
const RECOVERY_IDLE_MS = 500; // no recent mouse input before assist engages

export class ThirdPersonCamera {
  constructor(camera, domElement, raycastMeshes) {
    this.camera = camera;
    this.dom = domElement;
    this.raycastMeshes = raycastMeshes;
    this.yaw = Math.PI;
    this.pitch = 0.35;
    this.distance = BASE_DISTANCE;
    this._currentDistance = BASE_DISTANCE;
    this.minDistance = 1.6;
    this.lookHeight = 1.5;
    this.raycaster = new THREE.Raycaster();
    this._currentPos = new THREE.Vector3();
    this._lastMouseMoveAt = 0;

    this.dom.addEventListener('click', () => {
      if (document.pointerLockElement !== this.dom) this.dom.requestPointerLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0026;
      this.pitch = Math.max(-0.15, Math.min(0.95, this.pitch - e.movementY * 0.0022));
      this._lastMouseMoveAt = performance.now();
    });
  }

  forwardYaw() {
    return this.yaw;
  }

  _applyRecoveryAssist(targetPos, opponentPos, dt) {
    const toOpp = opponentPos.clone().sub(targetPos);
    toOpp.y = 0;
    if (toOpp.lengthSq() < 0.01) return;
    // this.yaw is the offset FROM target TO camera, i.e. behind the look
    // direction — the look direction itself needs +PI to compare against
    // "direction to opponent" on the same footing.
    const lookYaw = this.yaw + Math.PI;
    const desiredYaw = Math.atan2(toOpp.x, toOpp.z);
    let diff = ((desiredYaw - lookYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;

    const idle = performance.now() - this._lastMouseMoveAt > RECOVERY_IDLE_MS;
    if (idle && Math.abs(diff) > RECOVERY_ANGLE) {
      const step = Math.sign(diff) * Math.min(Math.abs(diff), RECOVERY_SPEED * dt);
      this.yaw += step;
    }
  }

  update(targetPos, dt, opponentPos) {
    if (opponentPos) this._applyRecoveryAssist(targetPos, opponentPos, dt);

    let targetDistance = this.distance;
    if (opponentPos) {
      const distToOpp = targetPos.distanceTo(opponentPos);
      const closeness = 1 - Math.min(1, distToOpp / COMBAT_RANGE);
      targetDistance = this.distance + closeness * COMBAT_DISTANCE_BONUS;
    }
    this._currentDistance += (targetDistance - this._currentDistance) * Math.min(1, dt * 3);

    const horiz = Math.cos(this.pitch) * this._currentDistance;
    const vert = Math.sin(this.pitch) * this._currentDistance;
    const desired = new THREE.Vector3(
      targetPos.x + Math.sin(this.yaw) * horiz,
      targetPos.y + this.lookHeight + vert,
      targetPos.z + Math.cos(this.yaw) * horiz
    );

    const origin = targetPos.clone().add(new THREE.Vector3(0, this.lookHeight, 0));
    const dir = desired.clone().sub(origin);
    const dist = dir.length();
    dir.normalize();
    this.raycaster.set(origin, dir);
    this.raycaster.far = dist;
    const hits = this.raycaster.intersectObjects(this.raycastMeshes, false);
    let finalDist = dist;
    if (hits.length > 0) finalDist = Math.max(this.minDistance, hits[0].distance - 0.3);
    const finalPos = origin.clone().add(dir.multiplyScalar(finalDist));

    const smoothing = 1 - Math.pow(0.001, dt);
    this._currentPos.lerp(finalPos, smoothing);
    this.camera.position.copy(this._currentPos);
    this.camera.lookAt(origin);
  }
}
