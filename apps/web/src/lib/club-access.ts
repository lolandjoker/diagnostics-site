/**
 * Открыт ли человеку результат Клуба Таромбы (квизы, расшифровка карты дня): подключил Telegram или указал почту —
 * обязательно одно из двух. Бот выключен — клуб открыт всем (подключать нечего).
 */
import type { TelegramLinkView } from "./telegram";

export const clubUnlocked = (lead: { email: string | null }, telegram: TelegramLinkView | null): boolean =>
  !telegram || telegram.connected || lead.email !== null;
