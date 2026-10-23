import { ADMIN_ONLINE_UNITS, isOnline } from "@/lib/experts";
import type { PublicExpert } from "@/lib/experts";
import { setExpertOnlineAction } from "./actions";

const time = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
const dateTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const day = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" });

/** Сегодня — только время, позже — дата и время (по Москве). */
function until(d: Date, now: Date): string {
  return day.format(d) === day.format(now) ? time.format(d) : dateTime.format(d);
}

/** Статус эксперта и кнопка админа: «в сети» на выбранный срок / выключить. */
export function OnlineToggle({ expert }: { expert: PublicExpert }) {
  const now = new Date();
  if (!expert.active) return <span className="muted">выключен</span>;
  const online = isOnline(expert, now);
  const byAdmin = expert.onlineUntil !== null && expert.onlineUntil > now;
  return (
    <form action={setExpertOnlineAction} className="online-toggle">
      <input type="hidden" name="id" value={expert.id} />
      <input type="hidden" name="online" value={online ? "false" : "true"} />
      <span className={online ? "status status--online" : "status"}>
        {online ? (byAdmin ? `в сети до ${until(expert.onlineUntil as Date, now)} (включили вы)` : "в сети") : "не в сети"}
      </span>
      {online ? (
        <button className="link-button">Выключить</button>
      ) : (
        <span className="online-toggle__for">
          <button className="link-button">Включить на</button>
          <input name="amount" type="number" min={1} max={525600} defaultValue={1} required aria-label="Срок" />
          <select name="unit" defaultValue="hours" aria-label="Единица срока">
            {Object.entries(ADMIN_ONLINE_UNITS).map(([key, u]) => (
              <option key={key} value={key}>
                {u.label}
              </option>
            ))}
          </select>
        </span>
      )}
    </form>
  );
}
