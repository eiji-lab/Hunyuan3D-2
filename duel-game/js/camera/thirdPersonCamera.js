// camera/thirdPersonCamera.js — mouse-orbit third-person camera with a
// raycast pull-in so it never clips into a building.

import * as THREE from '../vendor/three.module.js';

export class ThirdPersonCamera {
  constructor(camera, domElement, raycastMeshes) {
    this.camera = camera;
    this.dom = domElement;
    this.raycastMeshes = raycastMeshes;
    this.yaw = Math.PI;
    this.pitch = 0.35;
    this.distance = 7.5;
    this.minDistance = 1.6;
    this.lookHeight = 1.5;
    this.raycaster = new THREE.Raycaster();
    this._currentPos = new THREE.Vector3();

    this.dom.addEventListener('click', () => {
      if (document.pointerLockElement !== this.dom) this.dom.requestPointerLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0026;
      this.pitch = Math.max(-0.15, Math.min(0.95, this.pitch - e.movementY * 0.0022));
    });
  }

  forwardYaw() {
    return this.yaw;
  }

  update(targetPos, dt) {
    const horiz = Math.cos(this.pitch) * this.distance;
    const vert = Math.sin(this.pitch) * this.distance;
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
