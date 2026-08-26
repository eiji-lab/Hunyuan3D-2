// engine/inputManager.js — resolves an avatar's declared `controls` slots
// against raw keyboard state. Avatars with fewer buttons (JADE GLASS has
// exactly one) simply declare fewer control entries; avatars with none for a
// given ability (its input is null, e.g. COUNTER_STEP, GLASS_SHIELD) never
// consume a slot and are never polled here at all.

export function pollAvatarInput(combatant, keys) {
  const triggeredEntryIds = [];
  const heldSlots = new Set();

  for (const control of combatant.controls) {
    const isDown = keys.isDown(control.key);
    const justPressed = keys.wasPressed(control.key);
    if (control.mode === 'hold') {
      if (isDown) heldSlots.add(control.slot);
    } else if (justPressed) {
      heldSlots.add(control.slot);
      const entry = combatant.inputEntries.find((e) => e.input.slot === control.slot);
      if (entry) triggeredEntryIds.push(entry.id);
    }
  }

  return { triggeredEntryIds, heldSlots };
}
