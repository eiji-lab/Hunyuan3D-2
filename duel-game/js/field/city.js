// field/city.js — procedural stylized duel city.
// Grid of blocks, buildings with varied heights, rooftop access via exterior
// stairs, bridges connecting similar-height rooftops, destructible props,
// and a surface cell grid that can hold per-cell state tags (surface_write).
//
// This module has no knowledge of combat. It only exposes geometry +
// query functions the engine/AI/camera use for collision and gauge hooks.

import * as THREE from '../vendor/three.module.js';

// ---- deterministic PRNG (mulberry32) so screenshots are reproducible ----
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STEP_UP = 0.65; // max ledge height a combatant can walk up without stairs

function makeWindowTexture(rng, baseHex) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, c.width, c.height);
  const cols = 4, rows = 10;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const lit = rng() > 0.55;
      ctx.fillStyle = lit ? 'rgba(255,225,170,0.9)' : 'rgba(10,14,18,0.55)';
      const w = c.width / cols;
      const h = c.height / rows;
      ctx.fillRect(col * w + w * 0.18, r * h + h * 0.22, w * 0.64, h * 0.56);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRoadTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#33383d';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.moveTo(64, 0);
  ctx.lineTo(64, 128);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class SurfaceGrid {
  constructor(size, cell) {
    this.size = size;
    this.cell = cell;
    this.cols = Math.ceil(size / cell);
    this.tags = new Array(this.cols * this.cols).fill(null);
    const canvasSize = 512;
    this.canvas = document.createElement('canvas');
    this.canvas.width = canvasSize;
    this.canvas.height = canvasSize;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.pxPerCell = canvasSize / this.cols;
  }

  _idx(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= this.cols || gz >= this.cols) return -1;
    return gz * this.cols + gx;
  }

  worldToGrid(x, z) {
    const half = this.size / 2;
    const gx = Math.floor((x + half) / this.cell);
    const gz = Math.floor((z + half) / this.cell);
    return [gx, gz];
  }

  getTagAt(x, z) {
    const [gx, gz] = this.worldToGrid(x, z);
    const i = this._idx(gx, gz);
    return i < 0 ? null : this.tags[i];
  }

  _colorFor(tag) {
    if (tag === 'grip') return 'rgba(90,140,60,0.55)';
    if (tag === 'slip') return 'rgba(60,120,170,0.55)';
    return null;
  }

  paint(x, z, radius, tag) {
    const half = this.size / 2;
    const [cgx, cgz] = this.worldToGrid(x, z);
    const r = Math.ceil(radius / this.cell);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const gx = cgx + dx, gz = cgz + dz;
        const i = this._idx(gx, gz);
        if (i < 0) continue;
        const wx = gx * this.cell - half + this.cell / 2;
        const wz = gz * this.cell - half + this.cell / 2;
        if (Math.hypot(wx - x, wz - z) > radius) continue;
        this.tags[i] = tag;
      }
    }
    this._redraw();
  }

  // global_flip primitive: invert all cells matching fromTag -> toTag and vice versa
  flipAll(mapping) {
    for (let i = 0; i < this.tags.length; i++) {
      const t = this.tags[i];
      if (t && mapping[t]) this.tags[i] = mapping[t];
    }
    this._redraw();
  }

  _redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let gz = 0; gz < this.cols; gz++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const tag = this.tags[this._idx(gx, gz)];
        const color = this._colorFor(tag);
        if (!color) continue;
        this.ctx.fillStyle = color;
        this.ctx.fillRect(gx * this.pxPerCell, gz * this.pxPerCell, this.pxPerCell + 1, this.pxPerCell + 1);
      }
    }
    this.texture.needsUpdate = true;
  }
}

export function buildCity(scene, opts = {}) {
  const rng = mulberry32(opts.seed ?? 20260826);
  const gridCount = opts.gridCount ?? 4;
  const blockSize = opts.blockSize ?? 22;
  const roadWidth = opts.roadWidth ?? 8;
  const cellStride = blockSize + roadWidth;
  const citySize = gridCount * cellStride + roadWidth;

  const group = new THREE.Group();
  scene.add(group);

  scene.fog = new THREE.FogExp2(0x9fb0bd, 0.011);
  scene.background = new THREE.Color(0x9fb0bd);

  // ---- lighting: single strong directional light for readable shadows ----
  const hemi = new THREE.HemisphereLight(0xcfe0ea, 0x2b2f33, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2da, 1.85);
  sun.position.set(citySize * 0.28, citySize * 0.45, citySize * 0.18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  const shadowSpan = citySize * 0.62;
  sun.shadow.camera.left = -shadowSpan;
  sun.shadow.camera.right = shadowSpan;
  sun.shadow.camera.top = shadowSpan;
  sun.shadow.camera.bottom = -shadowSpan;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = citySize * 2;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  scene.add(sun.target);

  // ---- ground / roads ----
  const roadTex = makeRoadTexture();
  roadTex.repeat.set(citySize / 8, citySize / 8);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(citySize, citySize),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95, metalness: 0.02 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const surfaceGrid = new SurfaceGrid(citySize, 2);
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(citySize, citySize),
    new THREE.MeshBasicMaterial({ map: surfaceGrid.texture, transparent: true, depthWrite: false })
  );
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.y = 0.02;
  group.add(overlay);

  const buildings = [];
  const stairs = [];
  const bridges = [];
  const props = [];

  const palette = [0x8a9aa5, 0x748a92, 0x9aa08f, 0x8f8a7a, 0x7f8fa0, 0xa4998a];

  const half = citySize / 2;
  const originOffset = -half + roadWidth / 2 + blockSize / 2;

  // track roof height per block for bridge/stair placement
  const blockInfo = [];

  for (let bz = 0; bz < gridCount; bz++) {
    blockInfo[bz] = [];
    for (let bx = 0; bx < gridCount; bx++) {
      const cx = originOffset + bx * cellStride;
      const cz = originOffset + bz * cellStride;

      // corner blocks reserved as open plazas (spawn areas) — no tower, keeps
      // the "approach on foot" phase readable and gives a non-building start.
      const isSpawnPlaza =
        (bx === 0 && bz === 0) || (bx === gridCount - 1 && bz === gridCount - 1);

      if (isSpawnPlaza) {
        blockInfo[bz][bx] = { h: 0, cx, cz, footprint: null };
        continue;
      }

      const footprintScale = 0.62 + rng() * 0.24;
      const w = blockSize * footprintScale;
      const d = blockSize * footprintScale;
      const heightTier = rng();
      // deliberate variance so the skyline silhouette is not uniform
      const h = heightTier < 0.25 ? 6 + rng() * 4
        : heightTier < 0.55 ? 12 + rng() * 8
        : heightTier < 0.82 ? 22 + rng() * 10
        : 34 + rng() * 16;

      const color = palette[Math.floor(rng() * palette.length)];
      const winTex = makeWindowTexture(rng, '#' + color.toString(16).padStart(6, '0'));
      winTex.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));

      const mat = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.82, metalness: 0.08 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3f42, roughness: 0.9 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roofMat, roofMat, mat, mat]);
      mesh.position.set(cx, h / 2, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      const parapet = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.3, 0.5, d + 0.3),
        new THREE.MeshStandardMaterial({ color: 0x2c3033, roughness: 0.95 })
      );
      parapet.position.set(cx, h + 0.25, cz);
      parapet.castShadow = true;
      group.add(parapet);

      const info = { cx, cz, w, d, h, x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 };
      buildings.push(info);
      blockInfo[bz][bx] = { ...info, footprint: info };

      // rooftop props for melee/AI to fight on top of, and street-level props
      if (rng() > 0.4) {
        props.push(makeProp(group, cx + (rng() - 0.5) * w * 0.5, h + 0.6, cz + (rng() - 0.5) * d * 0.5, rng));
      }
    }
  }

  // street-level destructible props scattered in plazas/roads
  for (let i = 0; i < 22; i++) {
    const x = (rng() - 0.5) * citySize * 0.85;
    const z = (rng() - 0.5) * citySize * 0.85;
    if (isInsideAnyFootprint(buildings, x, z, 1.5)) continue;
    props.push(makeProp(group, x, 0.6, z, rng));
  }

  // ---- exterior stairs: one per building, climbing from ground to roof ----
  for (const info of buildings) {
    const side = Math.floor(rng() * 4);
    const stairWidth = 3.2;
    const run = Math.min(info.w, info.d) * 0.9;
    const steps = Math.max(6, Math.round(info.h / 1.1));
    const stepRise = info.h / steps;
    const stepRun = run / steps;

    let axis, sign, baseX, baseZ;
    if (side === 0) { axis = 'z'; sign = -1; baseX = info.cx; baseZ = info.z0; }
    else if (side === 1) { axis = 'z'; sign = 1; baseX = info.cx; baseZ = info.z1; }
    else if (side === 2) { axis = 'x'; sign = -1; baseX = info.x0; baseZ = info.cz; }
    else { axis = 'x'; sign = 1; baseX = info.x1; baseZ = info.cz; }

    // one InstancedMesh per staircase instead of one Mesh per step — a tall
    // building can otherwise need 30-45 individual draw calls just for its
    // stairs, which adds up fast across a whole city (see brief 4-3, 60fps)
    const stepGeo = new THREE.BoxGeometry(stairWidth, stepRise, stepRun + 0.05);
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x55595c, roughness: 0.85 });
    const stepInstanced = new THREE.InstancedMesh(stepGeo, stepMat, steps);
    stepInstanced.castShadow = true;
    stepInstanced.receiveShadow = true;
    // `base{X,Z}` sits at the building wall the stair leads onto; `sign`
    // points AWAY from the building. Ground level (s=0, lowest step) must
    // therefore be placed far from the wall (offset ~= run) and the top
    // step (s=steps-1, height~=h) placed right at the wall (offset ~= 0)
    // so stepping off the top step continues seamlessly onto the roof —
    // not the reverse, which strands the climb in open air over the street.
    const m4 = new THREE.Matrix4();
    for (let s = 0; s < steps; s++) {
      const y = stepRise * (s + 0.5);
      const offset = sign * stepRun * (steps - s - 0.5);
      const px = axis === 'z' ? baseX : baseX + offset;
      const pz = axis === 'z' ? baseZ + offset : baseZ;
      m4.makeTranslation(px, y, pz);
      stepInstanced.setMatrixAt(s, m4);
    }
    stepInstanced.instanceMatrix.needsUpdate = true;
    group.add(stepInstanced);

    const boxMinX = axis === 'z' ? baseX - stairWidth / 2 : Math.min(baseX, baseX + sign * run);
    const boxMaxX = axis === 'z' ? baseX + stairWidth / 2 : Math.max(baseX, baseX + sign * run);
    const boxMinZ = axis === 'x' ? baseZ - stairWidth / 2 : Math.min(baseZ, baseZ + sign * run);
    const boxMaxZ = axis === 'x' ? baseZ + stairWidth / 2 : Math.max(baseZ, baseZ + sign * run);

    stairs.push({
      minX: boxMinX, maxX: boxMaxX, minZ: boxMinZ, maxZ: boxMaxZ,
      axis, sign, base: axis === 'z' ? baseZ : baseX, anchorOther: axis === 'z' ? baseX : baseZ,
      run, height: info.h,
      heightAt(x, z) {
        // t=0 at the wall (base) end, t=run at the street end — height is
        // highest at the wall so the last step hands off onto the roof.
        const t = axis === 'z' ? (z - this.base) * this.sign : (x - this.base) * this.sign;
        const clamped = Math.max(0, Math.min(this.run, t));
        return (1 - clamped / this.run) * this.height;
      },
    });
  }

  // ---- bridges: connect adjacent same-row/col buildings of similar height ----
  for (let bz = 0; bz < gridCount; bz++) {
    for (let bx = 0; bx < gridCount - 1; bx++) {
      const a = blockInfo[bz][bx];
      const b = blockInfo[bz][bx + 1];
      if (!a.footprint || !b.footprint) continue;
      if (Math.abs(a.h - b.h) > 4) continue;
      if (rng() < 0.45) continue;
      const y = Math.min(a.h, b.h) - 0.15;
      const x0 = a.footprint.x1, x1 = b.footprint.x0;
      const bw = 2.6;
      const len = x1 - x0;
      const bridgeMesh = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.4, bw),
        new THREE.MeshStandardMaterial({ color: 0x676c6f, roughness: 0.8 })
      );
      bridgeMesh.position.set((x0 + x1) / 2, y, a.cz);
      bridgeMesh.castShadow = true;
      bridgeMesh.receiveShadow = true;
      group.add(bridgeMesh);
      bridges.push({ minX: x0, maxX: x1, minZ: a.cz - bw / 2, maxZ: a.cz + bw / 2, height: y + 0.2 });
    }
  }

  function isInsideAnyFootprint(list, x, z, pad = 0) {
    for (const b of list) {
      if (x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad) return b;
    }
    return null;
  }

  function makeProp(parent, x, y, z, rngFn) {
    const size = 0.9 + rngFn() * 0.6;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshStandardMaterial({ color: 0xb5744a, roughness: 0.7 })
    );
    mesh.position.set(x, y + size / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return { mesh, x, z, y: y + size / 2, size, hp: 60, maxHp: 60, alive: true };
  }

  // ---- collision / height query API used by combat movement code ----
  function surfaceCandidatesAt(x, z, currentY) {
    const candidates = [0];
    for (const b of buildings) {
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) {
        candidates.push(b.h);
        if (currentY < b.h - STEP_UP) candidates.push(-Infinity); // wall: cannot pass through below roof
      }
    }
    for (const s of stairs) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) {
        candidates.push(s.heightAt(x, z));
      }
    }
    for (const br of bridges) {
      if (x >= br.minX && x <= br.maxX && z >= br.minZ && z <= br.maxZ) {
        candidates.push(br.height);
      }
    }
    return candidates;
  }

  function resolveGroundHeight(x, z, currentY) {
    const candidates = surfaceCandidatesAt(x, z, currentY);
    let best = 0;
    let blocked = false;
    for (const c of candidates) {
      if (c === -Infinity) { blocked = true; continue; }
      if (c <= currentY + STEP_UP && c > best) best = c;
    }
    return { height: best, blocked };
  }

  const citySpan = citySize;
  const spawnPoints = [
    { x: -half + cellStride * 0.5, z: -half + cellStride * 0.5, y: 0 },
    { x: half - cellStride * 0.5, z: half - cellStride * 0.5, y: 0 },
  ];

  const raycastMeshes = [];
  group.traverse((o) => { if (o.isMesh) raycastMeshes.push(o); });

  return {
    group,
    citySize: citySpan,
    buildings,
    stairs,
    bridges,
    props,
    surfaceGrid,
    spawnPoints,
    raycastMeshes,
    resolveGroundHeight,
    isInsideAnyFootprint: (x, z, pad) => !!isInsideAnyFootprint(buildings, x, z, pad),
    damageProp(prop, amount) {
      if (!prop.alive) return false;
      prop.hp -= amount;
      const t = Math.max(0, prop.hp / prop.maxHp);
      prop.mesh.scale.setScalar(0.5 + 0.5 * t);
      if (prop.hp <= 0) {
        prop.alive = false;
        prop.mesh.visible = false;
        return true; // destroyed this call
      }
      return false;
    },
  };
}
