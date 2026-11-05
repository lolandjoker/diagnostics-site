/**
 * Свои эмодзи бота — набор в стиле логотипа (золотые тонкие линии), а не стандартные эмодзи Telegram.
 * Набор custom emoji принадлежит владельцу бота (у него Telegram Premium — иначе бот не может ими писать)
 * и называется taromba_icons_by_<имя бота>. При запуске сайт читает набор и сопоставляет значки по
 * эмодзи-заменителю (его видят там, где свои эмодзи не показываются). Набора нет — значков просто нет:
 * стандартные эмодзи вместо них не подставляем.
 */
export const BOT_EMOJI = {
  moon: "🌙",
  chat: "💬",
  reply: "↩️",
  phone: "📞",
  sparkle: "✨",
  gift: "🎁",
  bell: "🔔",
  bellOff: "🔕",
  check: "✅",
  globe: "🌐",
  star: "⭐",
  pen: "✍️",
} as const;

export type EmojiKey = keyof typeof BOT_EMOJI;

export const emojiSetName = (botUsername: string) => `taromba_icons_by_${botUsername}`;

/** Без вариационного селектора: Telegram может вернуть «↩» вместо «↩️». */
const bare = (s: string) => s.replace(/️/g, "");

const ids = new Map<EmojiKey, string>();

/** Значки из набора (getStickerSet): сопоставляем по эмодзи-заменителю. */
export function setBotEmoji(stickers: { emoji?: unknown; custom_emoji_id?: unknown }[]): number {
  ids.clear();
  const byEmoji = new Map((Object.entries(BOT_EMOJI) as [EmojiKey, string][]).map(([k, v]) => [bare(v), k]));
  for (const s of stickers) {
    const key = typeof s.emoji === "string" ? byEmoji.get(bare(s.emoji)) : undefined;
    if (key && typeof s.custom_emoji_id === "string" && /^\d+$/.test(s.custom_emoji_id)) ids.set(key, s.custom_emoji_id);
  }
  return ids.size;
}

export function emojiId(key: EmojiKey): string | undefined {
  return ids.get(key);
}

/** Значок в тексте сообщения (parse_mode HTML) с пробелом после; набора нет — пустая строка. */
export function em(key: EmojiKey): string {
  const id = ids.get(key);
  return id ? `<tg-emoji emoji-id="${id}">${BOT_EMOJI[key]}</tg-emoji> ` : "";
}
