// engine/vfx.js — lightweight, dependency-free feedback effects. No
// particle library: small fading/expanding meshes, pooled implicitly by
// just being short-lived and removed from the scene.

import * as THREE from '../vendor/three.module.js';

export class VfxSystem {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
  }

  spawnBurst(position, color, count = 8, speed = 4) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
      );
      mesh.position.copy(position);
      const dir = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8 + 0.2, (Math.random() - 0.5)).normalize();
      this.scene.add(mesh);
      this.active.push({ mesh, velocity: dir.multiplyScalar(speed * (0.5 + Math.random())), life: 0.45, age: 0 });
    }
  }

  spawnDebris(position, color) {
    for (let i = 0; i < 10; i++) {
      const size = 0.12 + Math.random() * 0.18;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ color }));
      mesh.position.copy(position);
      const dir = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 3 + 1.5, (Math.random() - 0.5) * 2);
      this.scene.add(mesh);
      this.active.push({ mesh, velocity: dir, life: 1.1, age: 0, gravity: true });
    }
  }

  spawnFloatingText(position, text, color) {
    // avoid canvas-sprite overhead for something this transient: a tiny
    // scaling billboard is enough signal for a screenshot / gauge check
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.3),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    mesh.position.copy(position).add(new THREE.Vector3(0, 1.6, 0));
    mesh.lookAt(mesh.position.clone().add(new THREE.Vector3(0, 0, 1)));
    this.scene.add(mesh);
    this.active.push({ mesh, velocity: new THREE.Vector3(0, 1.4, 0), life: 0.6, age: 0, billboard: true });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.age += dt;
      if (p.gravity) p.velocity.y -= 9.8 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      const t = p.age / p.life;
      if (p.mesh.material.opacity !== undefined) p.mesh.material.opacity = Math.max(0, 1 - t);
      if (t >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.active.splice(i, 1);
      }
    }
  }
}
