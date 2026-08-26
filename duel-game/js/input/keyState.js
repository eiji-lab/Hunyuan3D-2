// input/keyState.js — raw keyboard state. Movement (WASD/Space) is universal
// locomotion and read directly from here. Avatar-specific ability slots are
// resolved on top of this by engine/inputManager.js using each avatar's own
// `controls` declaration — nothing here hardcodes 1-8 style ability keys.

export class KeyState {
  constructor(target = window) {
    this.down = new Set();
    this.justPressed = new Set();
    this.justReleased = new Set();
    target.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.justPressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.justReleased.add(e.code);
    });
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.justPressed.has(code); }
  wasReleased(code) { return this.justReleased.has(code); }

  // call once per frame, after all systems have read this frame's edges
  endFrame() {
    this.justPressed.clear();
    this.justReleased.clear();
  }
}
