/**
 * «Клуб» клиента для сотрудников (шапка чата): что из бесплатного клиент уже прошёл — карта дня (серия), совместимость,
 * архетип, «Да или нет» — и что можно предложить. Результаты сотрудники видят всегда (клиенту без Telegram они закрыты).
 */
import { count, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { dailyCards, leads, telegramUsers } from "@/db/schema";
import { ARCANA } from "./arcana";
import { cardStreak, todayCard } from "./club";
import { ARCHETYPES } from "./quiz-archetype-data";
import { ANSWER_LABEL } from "./quiz-yesno-data";
import { type QuizKind, latestQuiz, nextAttemptFrom, parseJson } from "./quizzes";

export interface ClubStatus {
  telegram: boolean;
  /** Подписан на карту дня по утрам в боте. */
  forecast: boolean;
  cards: { total: number; streak: number; today: string | null };
  compat: { at: string; total: number | null; partner: string; again: string | null } | null;
  archetype: { at: string; name: string; again: string | null } | null;
  yesno: { at: string; question: string; answer: string | null; card: string; again: string | null } | null;
  /** Готовые напоминания — подставляются в поле ввода кнопкой. */
  reminders: Record<"card" | QuizKind, string>;
}

export async function clubStatus(db: Db, leadId: string, now = new Date()): Promise<ClubStatus | null> {
  const [lead] = await db.select({ tg: leads.telegramUserId, birthDate: leads.birthDate }).from(leads).where(eq(leads.id, leadId));
  if (!lead) return null;
  const [[total], streak, today, compat, arch, yn, sub] = await Promise.all([
    db.select({ n: count() }).from(dailyCards).where(eq(dailyCards.leadId, leadId)),
    cardStreak(db, leadId, now),
    todayCard(db, leadId, now),
    latestQuiz(db, leadId, "compat"),
    latestQuiz(db, leadId, "archetype"),
    latestQuiz(db, leadId, "yesno"),
    lead.tg ? db.select({ on: telegramUsers.forecast }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, lead.tg)) : Promise.resolve([]),
  ]);
  const again = (row: { day: string } | null, kind: QuizKind) => nextAttemptFrom(row, kind, now);
  const c = compat ? { input: parseJson<{ partnerName: string }>(compat.input), result: parseJson<{ scores: { total: number } }>(compat.result) } : null;
  const a = arch ? parseJson<{ key: keyof typeof ARCHETYPES }>(arch.result) : null;
  const y = yn ? { input: parseJson<{ question: string }>(yn.input), result: parseJson<{ card: number; answer: keyof typeof ANSWER_LABEL | null }>(yn.result) } : null;
  return {
    telegram: lead.tg !== null,
    forecast: sub[0]?.on === true,
    cards: { total: Number(total?.n ?? 0), streak, today: today ? (ARCANA[today.card]?.name ?? null) : null },
    compat: compat ? { at: compat.createdAt.toISOString(), total: c?.result?.scores.total ?? null, partner: c?.input?.partnerName ?? "", again: again(compat, "compat") } : null,
    archetype: arch && a?.key && ARCHETYPES[a.key] ? { at: arch.createdAt.toISOString(), name: ARCHETYPES[a.key].name, again: again(arch, "archetype") } : null,
    yesno:
      yn && y?.result
        ? {
            at: yn.createdAt.toISOString(),
            question: y.input?.question ?? "",
            answer: y.result.answer ? ANSWER_LABEL[y.result.answer] : null,
            card: ARCANA[y.result.card]?.name ?? "",
            again: again(yn, "yesno"),
          }
        : null,
    reminders: {
      card: clubReminder("card", lead.tg !== null),
      compat: clubReminder("compat", lead.tg !== null),
      archetype: clubReminder("archetype", lead.tg !== null),
      yesno: clubReminder("yesno", lead.tg !== null),
    },
  };
}

/** Готовые напоминания клиенту (сотрудник может поправить перед отправкой). */
export function clubReminder(kind: "card" | QuizKind, telegram: boolean): string {
  const tail = telegram ? "" : " Результат откроется после подключения Telegram, это тоже бесплатно.";
  switch (kind) {
    case "compat":
      return `Кстати, у вас в разделе «Мой день» есть бесплатная совместимость пары, достаточно ввести дату рождения партнёра. Попробуйте, а потом я могу разобрать результат подробнее 🤍${tail}`;
    case "archetype":
      return `Кстати, для вас есть бесплатный тест «Ваш архетип». Всего 5 вопросов и вы узнаете какая карта описывает ваш характер, он в разделе «Мой день» 🤍${tail}`;
    case "yesno":
      return `Если есть вопрос на который хочется получить ответ да или нет, в разделе «Мой день» можно бесплатно вытянуть карту 🤍${tail}`;
    default:
      return `Каждый день в разделе «Мой день» вас ждёт бесплатная карта дня, загляните сегодня 🤍${tail}`;
  }
}
