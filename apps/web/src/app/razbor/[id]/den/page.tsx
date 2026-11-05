import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clientChats, conversationForLead } from "@/lib/chat";
import { cardStreak, cardView, daysLabel, recentDays, todayCard } from "@/lib/club";
import { splitExpertName } from "@/lib/expert-name";
import { expertStatus, getExpert } from "@/lib/experts";
import { getLead } from "@/lib/leads";
import { telegramLink } from "@/lib/telegram";
import { ClientTabs } from "../../../ClientTabs";
import { ClubCard } from "../../../ClubCard";
import { DailyCardPicker } from "../../../DailyCardPicker";
import { QuizTiles } from "../../../QuizTiles";

export const dynamic = "force-dynamic";

const dayTitle = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", weekday: "long", day: "numeric", month: "long" });

/**
 * «Мой день» — дом «Клуба Таромбы»: карта дня, серия, карточка клуба, квизы и путь к эксперту.
 * Сюда же попадает вернувшийся на taromba.com и открывший бота кнопкой «Открыть».
 */
export default async function MyDayPage(props: PageProps<"/razbor/[id]/den">) {
  const { id } = await props.params;
  const db = await getDb();
  const lead = await getLead(db, id);
  if (!lead) redirect("/");
  const now = new Date();
  const [row, streak, week, telegram, chats, chat] = await Promise.all([
    todayCard(db, lead.id, now),
    cardStreak(db, lead.id, now),
    recentDays(db, lead.id, now),
    telegramLink(lead),
    clientChats(db, lead.id),
    conversationForLead(db, lead.id),
  ]);
  // Бот выключен — клуб открыт всем, без замка
  const unlocked = !telegram || telegram.connected;
  const expert = chat ? await getExpert(db, chat.expertId) : null;
  const expertOnline = expert ? expertStatus(expert, now) === "online" : false;
  const unread = chats.reduce((s, c) => s + c.unread, 0);
  const date = dayTitle.format(now);

  return (
    <main className="page page--den has-tabs">
      <ClientTabs leadId={lead.id} current="den" hasChats={chats.length > 0} unread={unread} />
      <header className="den__head">
        <div>
          <span className="eyebrow">{date.charAt(0).toUpperCase() + date.slice(1)}</span>
          <h1>{lead.name}, ваш день</h1>
        </div>
        <div className="den__streak">
          <div className="den__dots" aria-label={`Серия: ${daysLabel(streak)}`}>
            {week.map((done, i) => (
              <i key={i} className={done ? "is-done" : i === week.length - 1 ? "is-today" : undefined} />
            ))}
          </div>
          <span>{streak > 0 ? `Серия — ${daysLabel(streak)}` : "Начните серию сегодня"}</span>
        </div>
      </header>

      <div className="den__grid">
        <section className="den__main" aria-label="Карта дня">
          <DailyCardPicker
            leadId={lead.id}
            initial={row ? cardView(row, unlocked, lead.birthDate) : null}
            telegramHref={unlocked ? null : (telegram?.href ?? null)}
            askHref={chat ? `/razbor/${lead.id}/chat?c=${chat.id}` : `/razbor/${lead.id}/eksperty`}
            expertName={expert ? splitExpertName(expert.name).name : null}
          />
        </section>
        <aside className="den__side">
          <ClubCard connected={!!telegram?.connected} telegramHref={telegram && !telegram.connected ? telegram.href : null} />
        </aside>
      </div>

      <QuizTiles db={db} leadId={lead.id} birthDate={lead.birthDate} unlocked={unlocked} />

      <section className="den__expert">
        {chat && expert ? (
          <>
            <span>
              Хотите разобрать карту подробнее?{" "}
              {expertOnline ? `${splitExpertName(expert.name).name} сейчас в сети.` : "Напишите эксперту — он ответит, как только появится."}
            </span>
            <Link className="button" href={`/razbor/${lead.id}/chat?c=${chat.id}`}>
              Спросить эксперта
            </Link>
          </>
        ) : (
          <>
            <span>Хотите разобрать карту подробнее? Выберите эксперта и задайте вопрос.</span>
            <Link className="button" href={`/razbor/${lead.id}/eksperty`}>
              Выбрать эксперта
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
