import { ADMIN_ONLINE_FOREVER, ADMIN_ONLINE_UNITS, expertStatus } from "@/lib/experts";
import type { PublicExpert } from "@/lib/experts";
import { setExpertBusyAction, setExpertOnlineAction } from "./actions";
import { OnlineUnitSelect } from "./OnlineUnitSelect";

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

/**
 * Статус эксперта и управление им за эксперта: включить на срок или навсегда, «занят» / «свободен»,
 * выключить.
 */
export function OnlineToggle({ expert }: { expert: PublicExpert }) {
  const now = new Date();
  if (!expert.active) return <span className="muted">выключен</span>;
  const status = expertStatus(expert, now);
  // Включено «навсегда» (самим экспертом или админом) — держится, пока не выключат
  const forever = expert.online;
  const timed = !forever && expert.onlineUntil !== null && expert.onlineUntil > now;
  const label =
    status === "offline"
      ? "не в сети"
      : `${status === "busy" ? "занят" : "в сети"}${
          forever ? ", пока не выключат" : timed ? ` до ${until(expert.onlineUntil as Date, now)}` : ""
        }`;
  return (
    <div className="online-toggle">
      <span className={`status status--${status}`}>{label}</span>
      {status === "offline" ? (
        <form action={setExpertOnlineAction} className="online-toggle__for">
          <input type="hidden" name="id" value={expert.id} />
          <input type="hidden" name="online" value="true" />
          <button className="link-button">Включить</button>
          <OnlineUnitSelect
            foreverKey={ADMIN_ONLINE_FOREVER}
            units={[
              ...Object.entries(ADMIN_ONLINE_UNITS).map(([key, u]) => ({ key, label: u.label })),
              { key: ADMIN_ONLINE_FOREVER, label: "навсегда" },
            ]}
          />
        </form>
      ) : (
        <>
          <form action={setExpertBusyAction}>
            <input type="hidden" name="id" value={expert.id} />
            <input type="hidden" name="busy" value={status === "busy" ? "false" : "true"} />
            <button className="link-button">{status === "busy" ? "Свободен" : "Занят"}</button>
          </form>
          <form action={setExpertOnlineAction}>
            <input type="hidden" name="id" value={expert.id} />
            <input type="hidden" name="online" value="false" />
            <button className="link-button link-button--danger">Выключить</button>
          </form>
        </>
      )}
    </div>
  );
}
