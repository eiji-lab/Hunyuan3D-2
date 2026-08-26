// engine/modelLoader.js — loads the shared humanoid rig once. Every
// combatant clones this template (via SkeletonUtils, which correctly
// re-binds skinned meshes to a cloned skeleton — a plain Object3D.clone()
// does not) rather than re-fetching/re-parsing the glTF per avatar.
//
// See js/vendor/CREDITS.md: this is three.js's own official example asset
// (MIT), used as a stand-in body — per-avatar sculpting is a later phase.

import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import * as SkeletonUtils from '../vendor/utils/SkeletonUtils.js';

const MODEL_URL = new URL('../vendor/models/RobotExpressive.glb', import.meta.url).href;

let templatePromise = null;

export function loadBodyTemplate() {
  if (!templatePromise) {
    const loader = new GLTFLoader();
    templatePromise = loader.loadAsync(MODEL_URL).then((gltf) => ({
      scene: gltf.scene,
      animations: gltf.animations,
    })).catch((err) => {
      console.warn('body model failed to load, falling back to primitive shapes:', err);
      return null;
    });
  }
  return templatePromise;
}

export function cloneBody(template) {
  const clone = SkeletonUtils.clone(template.scene);
  return clone;
}
