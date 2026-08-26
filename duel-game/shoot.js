// shoot.js — Playwright verification script.
// Launches headless Chromium against the locally-served game, records every
// console message and page error, drives a play session (select an avatar,
// sit through countdown, approach, fight, observe ability-specific visuals),
// and saves screenshots at the milestones the brief requires. Screenshots
// are the primary verification artifact — console-error-count alone proved
// insufficient during development (see console_report.json for the raw log,
// but it is not treated as sufficient evidence on its own).
//
// ?turbo=N speeds up simulated time relative to wall-clock (see main.js) —
// it does not change any visual or numeric game state, only how many
// real seconds a screenshot at a given match-time costs to reach. This
// matters here because the sandbox this was authored in has no GPU
// (/dev/dri does not exist) and falls back to software rendering, capping
// real frame rate around 6-10fps regardless of scene complexity.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.SHOOT_BASE_URL || 'http://localhost:8934/index.html?turbo=4';
const OUT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function shot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('screenshot:', name, '| state:', JSON.stringify(await page.evaluate(() => window.__game.getState())));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto(BASE_URL);
  await page.waitForTimeout(500);
  await shot(page, '01_select_screen');

  const cards = await page.$$('.select-card');
  if (cards.length < 2) throw new Error(`expected 2 select cards, found ${cards.length}`);
  await cards[0].click(); // player = CELADON ANVIL, AI = JADE GLASS
  await page.waitForTimeout(200);
  await shot(page, '02_countdown');

  // ride out the countdown into battle (poll instead of a fixed guess)
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => window.__game.getState());
    if (s.matchState === 'battle') break;
  }
  await shot(page, '03_battle_start_street_level');

  // engage pointer lock with a plain click (no drag) so mouse deltas are
  // honored, then look downward for an overhead/silhouette angle
  await page.mouse.click(640, 400);
  await page.waitForTimeout(150);
  await page.mouse.move(640, 700, { steps: 10 });
  await page.waitForTimeout(150);
  await shot(page, '04_overhead_silhouette');
  await page.mouse.move(640, 400, { steps: 10 }); // restore normal pitch
  await page.waitForTimeout(150);

  // approach: walk forward, closing the distance the two avatars spawned at
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await shot(page, '05_approaching_opponent');
  await page.waitForTimeout(1200);
  await shot(page, '06_closing_to_melee_range');

  // exchange PILE HAMMER swings once in range
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(500);
  }
  await shot(page, '07_after_several_attacks_exchanged');

  // ANCHOR FEET: hold to brace (kb resistance + move penalty), screenshot
  // while held, then release to trigger COUNTER STEP
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyK');
  await page.waitForTimeout(400);
  await shot(page, '08_anchor_feet_held');
  await page.keyboard.up('KeyK');
  await page.waitForTimeout(250);
  await shot(page, '09_counter_step_release');

  // continue the fight so IMPACT RESERVE / FRACTURE / SHIELD gauges move
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(450);
  }
  await page.keyboard.up('KeyW');
  await shot(page, '10_gauges_progressed');

  // wait for the match to resolve (KO or clock) — poll instead of guessing
  const deadline = Date.now() + 150000;
  let ended = false;
  while (Date.now() < deadline) {
    const visible = await page.$eval('#hud-result', (el) => el.classList.contains('visible')).catch(() => false);
    if (visible) { ended = true; break; }
    await page.waitForTimeout(800);
  }
  await shot(page, '11_match_result');

  const report = { consoleErrors, pageErrors, matchEndedWithinTimeout: ended };
  fs.writeFileSync(path.join(OUT_DIR, 'console_report.json'), JSON.stringify(report, null, 2));
  console.log('---- console errors ----');
  console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');
  console.log('---- page errors ----');
  console.log(pageErrors.length ? pageErrors.join('\n') : '(none)');
  console.log('match ended within timeout:', ended);

  await browser.close();
})();
