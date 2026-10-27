/**
 * «Печатает…» как в мессенджерах. Состояние живёт в памяти процесса сайта (в docker-compose он один):
 * оно мгновенное и неважное — после перезапуска просто пропадает, база для него не нужна.
 * Сторона, которая набирает текст, отмечается не чаще раза в пару секунд; «печатает» держится TYPING_TTL_MS.
 */
export type TypingSide = "client" | "staff";

export const TYPING_TTL_MS = 5000;

const holder = globalThis as unknown as { __diagTyping?: Map<string, Partial<Record<TypingSide, number>>> };
const state = (holder.__diagTyping ??= new Map());

export function setTyping(conversationId: string, side: TypingSide, now: Date): void {
  const entry = state.get(conversationId) ?? {};
  entry[side] = now.getTime();
  state.set(conversationId, entry);
  // Старые записи не копим: чистим всё, что давно протухло
  if (state.size > 1000) {
    for (const [id, e] of state) {
      if (Math.max(e.client ?? 0, e.staff ?? 0) < now.getTime() - TYPING_TTL_MS) state.delete(id);
    }
  }
}

/** Сторона side печатает в этом чате прямо сейчас. */
export function isTyping(conversationId: string, side: TypingSide, now: Date): boolean {
  const at = state.get(conversationId)?.[side];
  return at !== undefined && now.getTime() - at < TYPING_TTL_MS;
}

/** Отправили сообщение — «печатает» сразу гаснет, а не через TYPING_TTL_MS. */
export function clearTyping(conversationId: string, side: TypingSide): void {
  const entry = state.get(conversationId);
  if (entry) delete entry[side];
}
