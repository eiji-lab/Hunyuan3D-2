// engine/audio.js — voice/SE playback hook.
//
// Per the project brief (§7): actual voice lines are にじボイス-generated
// audio to be dropped in later. This only wires the *hook*: call playSfx(id)
// from anywhere gameplay-relevant (a special move activating, a hit
// landing), and it silently no-ops when no file is registered for that id
// or the file fails to load/play — it must never throw or block gameplay.
//
// To add a real line later: put the audio file under duel-game/assets/audio/
// and add one entry to MANIFEST below, e.g.
//   saturation_fire: './assets/audio/olive_wedge_saturation_fire.mp3'

const MANIFEST = {
  // (empty until voice/SE assets are supplied)
};

const cache = {};

export function playSfx(id) {
  const url = MANIFEST[id];
  if (!url) return; // no asset registered yet — silent, not an error
  try {
    let audio = cache[id];
    if (!audio) {
      audio = new Audio(url);
      cache[id] = audio;
    }
    audio.currentTime = 0;
    audio.play()?.catch(() => {}); // missing file / autoplay policy — ignore
  } catch {
    // never let a playback failure interrupt gameplay
  }
}
