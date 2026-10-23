import { isOnline } from "@/lib/experts";
import type { PublicExpert } from "@/lib/experts";
import { setExpertOnlineAction } from "./actions";

const time = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });

/** Статус эксперта и кнопка админа: «в сети» на час / выключить. */
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
        {online ? (byAdmin ? `в сети до ${time.format(expert.onlineUntil as Date)} (включили вы)` : "в сети") : "не в сети"}
      </span>
      <button className="link-button">{online ? "Выключить" : "Включить на 1 час"}</button>
    </form>
  );
}
