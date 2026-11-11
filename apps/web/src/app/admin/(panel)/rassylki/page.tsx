import { and, asc, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { experts } from "@/db/schema";
import { isAdmin } from "@/lib/admin-auth";
import {
  AUDIENCES,
  type Audience,
  BROADCAST_GAP_MS,
  type Broadcast,
  MAX_BROADCAST_LENGTH,
  PERSONAL_PAGES,
  type PersonalPage,
  audienceCounts,
  listBroadcasts,
} from "@/lib/broadcasts";
import { telegramConfig } from "@/lib/telegram";
import { ActionForm } from "../../ActionForm";
import { BroadcastComposer } from "./BroadcastComposer";
import { broadcastAction, expertBroadcastAction } from "../../actions";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/** «3 сообщения: фото, видео» — для истории. */
function seriesNote(parts: Broadcast["parts"]): string {
  const n = parts.length;
  const word = n % 10 === 1 && n % 100 !== 11 ? "сообщение" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "сообщения" : "сообщений";
  const media = parts.flatMap((p) => (p.media ? [p.media.kind === "photo" ? "фото" : "видео"] : []));
  return `${n} ${word}${media.length ? `: ${media.join(", ")}` : ""}`;
}

/** Незаконченная рассылка старше часа — значит, её прервал перезапуск сайта. */
const STALLED_MS = 60 * 60 * 1000;

/**
 * Рассылки — только админ. Две вкладки:
 * - «От экспертов» (по умолчанию): массовое сообщение каждому в его чат с экспертом и оттуда в Telegram
 *   (lib/expert-broadcasts.ts) — видно в переписке, ответ приходит в тот же чат;
 * - «Системные от бота» (?tab=bot): только в Telegram, от имени бота, с /stop — подарки, квизы (lib/broadcasts.ts).
 */
export default async function BroadcastsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!(await isAdmin())) redirect("/admin");
  const tab = (await searchParams).tab === "bot" ? "bot" : "chat";
  const db = await getDb();
  const [counts, history, expertList] = await Promise.all([
    audienceCounts(db),
    listBroadcasts(db, tab),
    db
      .select({ id: experts.id, name: experts.name })
      .from(experts)
      .where(and(isNull(experts.archivedAt), isNull(experts.deletedAt)))
      .orderBy(asc(experts.sort), asc(experts.id)),
  ]);
  const expertName = new Map(expertList.map((e) => [e.id, e.name]));
  const now = Date.now();
  const last = history[0];
  const recent = last && now - last.createdAt.getTime() < BROADCAST_GAP_MS;

  return (
    <>
      <h1>Рассылки</h1>
      <nav className="bc-tabs" aria-label="Вид рассылки">
        <Link href="/admin/rassylki" className={tab === "chat" ? "bc-tab is-current" : "bc-tab"} aria-current={tab === "chat" ? "page" : undefined}>
          От экспертов
          <span>в чат и в Telegram</span>
        </Link>
        <Link href="/admin/rassylki?tab=bot" className={tab === "bot" ? "bc-tab is-current" : "bc-tab"} aria-current={tab === "bot" ? "page" : undefined}>
          Системные от бота
          <span>подарки, квизы, новости</span>
        </Link>
      </nav>

      {tab === "chat" ? (
        <p className="muted">
          Сообщение от эксперта каждому клиенту — в его чат с экспертом: в переписке оно стоит от имени эксперта, клиенту
          с Telegram приходит в бот, а его ответ возвращается в тот же чат. Сотрудники видят у таких сообщений пометку
          «рассылка». Можно несколько сообщений подряд, к каждому — фото или видео. Сначала пробу себе: впишите свой
          Telegram ID — серия придёт в ваш чат.
        </p>
      ) : (
        <p className="muted">
          Подключили бота: <b>{counts.all}</b>. Сообщение от бота — только в Telegram, в чатах на сайте его нет. Внизу бот
          добавляет «Отключить сообщения — /stop». Жирный текст — **так**. Сначала отправьте пробу себе: впишите свой
          Telegram ID (узнать его можно у @userinfobot).
        </p>
      )}
      <p className="muted">
        Пишите не чаще раза в день и только по делу: частые рассылки люди блокируют, а Telegram может ограничить бота.
      </p>
      {!telegramConfig() && <p className="notice notice--error">Telegram-бот не подключён — в Telegram ничего не уйдёт.</p>}
      {recent && <p className="notice notice--error">Последняя рассылка на этой вкладке была {when.format(last.createdAt)} — меньше суток назад.</p>}

      {/* key: при переключении вкладки форма собирается заново */}
      <ActionForm key={tab} action={tab === "chat" ? expertBroadcastAction : broadcastAction}>
        <BroadcastComposer counts={counts} maxLength={MAX_BROADCAST_LENGTH} mode={tab} experts={expertList} />
        <label className="field field--short">
          <span>Проба: только на этот Telegram ID</span>
          <input name="test_id" inputMode="numeric" pattern="\d*" placeholder="например, 123456789" />
        </label>
        <label className="check">
          <input name="confirm" type="checkbox" />
          <span>Отправить выбранным — если ID для пробы пустой</span>
        </label>
        <button className="button">Отправить</button>
      </ActionForm>

      {history.length > 0 && (
        <section className="admin-section">
          <h2>История</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Кому</th>
                  <th>Текст</th>
                  <th>{tab === "chat" ? "Чатов" : "Получателей"}</th>
                  <th>Дошло</th>
                  <th>Не дошло</th>
                  <th>Состояние</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id}>
                    <td>{when.format(b.createdAt)}</td>
                    <td>
                      {b.audience in AUDIENCES ? AUDIENCES[b.audience as Audience].split(" — ")[0] : "все"}
                      {b.expertId !== null && <span className="muted"> · клиентам: {expertName.get(b.expertId) ?? "эксперт"}</span>}
                      {b.registeredHours && <span className="muted"> · заявка старше {b.registeredHours} ч</span>}
                      {b.silentHours && <span className="muted"> · молчат {b.silentHours} ч</span>}
                      {b.personalPage && b.personalPage in PERSONAL_PAGES && (
                        <span className="muted"> · кнопка: {PERSONAL_PAGES[b.personalPage as PersonalPage].label}</span>
                      )}
                    </td>
                    <td>
                      {b.body.length > 120 ? `${b.body.slice(0, 120)}…` : b.body}
                      {b.parts.length > 0 && <span className="muted"> · {seriesNote(b.parts)}</span>}
                    </td>
                    <td>{b.total}</td>
                    <td>{b.sent}</td>
                    <td title={tab === "chat" ? "не записалось в чат" : "заблокировали бота или удалили аккаунт"}>{b.failed}</td>
                    <td>
                      {b.finishedAt ? "готово" : now - b.createdAt.getTime() > STALLED_MS ? "прервана перезапуском" : "идёт…"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
