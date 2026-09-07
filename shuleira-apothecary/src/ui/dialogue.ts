import dialogueData from '../data/dialogue.json';
import customersData from '../data/customers.json';

const CUSTOMERS_BY_ID = Object.fromEntries(customersData.customers.map((c) => [c.id, c]));

interface DialogueLine {
  text: string;
  core?: boolean;
}

function customerDialogueEntry(customerId: string) {
  const def = CUSTOMERS_BY_ID[customerId as keyof typeof CUSTOMERS_BY_ID];
  if (!def) return null;
  return (dialogueData.customers as Record<string, unknown>)[def.dialogueId] ?? null;
}

/**
 * 客の「待機中」台詞を1行返す。固定客はinitial行を、切り替え客はwaitingLinesを
 * lineIndexに応じて返す（緩急のため、たまに同じ行を連続させる／飛ばす揺らぎを加える）。
 */
export function currentDialogueLine(customerId: string, lineIndex: number): { text: string; core: boolean } {
  const entry = customerDialogueEntry(customerId) as
    | { waitingFixedLine?: string; waitingLines?: DialogueLine[]; initialFixedLines?: string[] }
    | null;
  if (!entry) return { text: '……', core: false };

  if (entry.waitingFixedLine) {
    return { text: entry.waitingFixedLine, core: false };
  }
  if (entry.waitingLines && entry.waitingLines.length > 0) {
    const idx = lineIndex % entry.waitingLines.length;
    const line = entry.waitingLines[idx];
    return { text: line.text, core: !!line.core };
  }
  if (entry.initialFixedLines) {
    return { text: entry.initialFixedLines.join('\n'), core: false };
  }
  return { text: '……', core: false };
}

/**
 * 症状進行段階に応じた切り替え間隔（ms）。企画仕様§06。
 */
export function switchIntervalMs(playerStageId: string): number {
  if (playerStageId === 'severe' || playerStageId === 'critical') {
    return dialogueData.switchIntervalsMs['プレイヤー重度'];
  }
  if (playerStageId === 'moderate') {
    return dialogueData.switchIntervalsMs['プレイヤー中度'];
  }
  return dialogueData.switchIntervalsMs['通常'];
}

/**
 * プレイヤーが中度以上のとき、台詞を書き換える（企画仕様§13幻聴による書き換え）。
 * 語の対応表はdialogue.json.playerHallucinationRewrite.examplesの原文と一致した場合のみ適用する。
 */
export function applyHallucinationRewrite(text: string, playerStageId: string): string {
  if (playerStageId !== 'moderate' && playerStageId !== 'severe' && playerStageId !== 'critical') {
    return text;
  }
  const rewrite = dialogueData.playerHallucinationRewrite;
  for (const example of rewrite.examples) {
    if (text.includes(example.original)) {
      return text.replace(example.original, example.rewritten);
    }
  }
  if (playerStageId === 'severe' || playerStageId === 'critical') {
    // 重度時のみ、実際には言われていない一行が混ざることがある
    if (Math.random() < 0.15) {
      const extra =
        rewrite.severeAdditionalLines[
          Math.floor(Math.random() * rewrite.severeAdditionalLines.length)
        ];
      return `${text}\n${extra}`;
    }
  }
  return text;
}

export function advisorDialogue(advisorId: string) {
  return (dialogueData.advisors as Record<string, unknown>)[advisorId] ?? null;
}
