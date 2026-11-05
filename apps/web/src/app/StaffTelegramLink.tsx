"use client";

/**
 * «Telegram: уведомления» в шапке панели сотрудника. Подключить — сайт выдаёт одноразовую ссылку на бота
 * (15 минут), её нужно открыть самому — в том Telegram, куда должны приходить уведомления. Вернулись на
 * страницу — статус обновляется.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { StaffKind } from "@/lib/staff-telegram";
import { connectStaffTelegramAction, disconnectStaffTelegramAction } from "./staff-telegram-actions";

export function StaffTelegramLink({ kind, connected, name }: { kind: StaffKind; connected: boolean; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [href, setHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Пока ссылка открыта в Telegram — при возврате на вкладку проверяем, подключилось ли
  useEffect(() => {
    if (!href) return;
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [href, router]);

  useEffect(() => {
    if (connected) setHref(null);
  }, [connected]);

  if (connected) {
    return (
      <span className="staff-tg">
        <span className="staff-tg__ok" title="Новые сообщения клиентов приходят в Telegram">
          Telegram: {name || "подключён"}
        </span>
        <button
          type="button"
          className="link-button"
          disabled={pending}
          onClick={() => start(() => disconnectStaffTelegramAction(kind))}
        >
          Отключить
        </button>
      </span>
    );
  }
  if (href) {
    return (
      <span className="staff-tg">
        <a className="staff-tg__go" href={href} target="_blank" rel="noopener noreferrer">
          Открыть Telegram и нажать «Запустить»
        </a>
        <span className="muted">ссылка на 15 минут, только для вас</span>
      </span>
    );
  }
  return (
    <span className="staff-tg">
      <button
        type="button"
        className="link-button"
        disabled={pending}
        title="Новые сообщения клиентов будут приходить в Telegram, отвечать можно прямо оттуда"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await connectStaffTelegramAction(kind);
            if ("href" in res) setHref(res.href);
            else setError(res.error);
          })
        }
      >
        Уведомления в Telegram
      </button>
      {error && <span className="form__error">{error}</span>}
    </span>
  );
}
