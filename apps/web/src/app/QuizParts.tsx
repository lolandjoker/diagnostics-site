"use client";

/** Общее для квизов клуба: замок без Telegram, вопрос эксперту, обновление после подключения. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Результат закрыт — ждём, что человек подключит Telegram и вернётся на вкладку: тогда страница обновится сама. */
export function useRefreshOnFocus(enabled: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, router]);
}

/** Ссылка в чат с готовым вопросом в поле ввода (если чата нет — к выбору эксперта). */
export function askWith(askHref: string, text: string): string {
  return askHref.includes("/chat") ? `${askHref}&q=${encodeURIComponent(text.slice(0, 300))}` : askHref;
}

export function QuizLocked({ title, text, telegramHref }: { title: string; text: string; telegramHref: string | null }) {
  return (
    <section className="daily__secret daily__secret--locked">
      <span className="eyebrow">Только для Клуба Таромбы</span>
      <b>{title}</b>
      <span>{text}</span>
      {telegramHref && (
        <a className="button" href={telegramHref} target="_blank" rel="noopener noreferrer">
          Получить в Telegram
        </a>
      )}
    </section>
  );
}

export function QuizSecret({ eyebrow, teaser, href, button, note }: { eyebrow: string; teaser: string; href: string; button: string; note: string }) {
  return (
    <section className="daily__secret" style={{ ["--d" as string]: 4 }}>
      <span className="eyebrow">{eyebrow}</span>
      <p>{teaser}</p>
      <Link className="button" href={href}>
        {button}
      </Link>
      <small>{note}</small>
    </section>
  );
}

/** «1 раз», «2 раза», «5 раз». */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Сколько попыток осталось на сегодня. forms — «раз / раза / раз». */
export function Attempts({ left, forms }: { left: number; forms: [string, string, string] }) {
  return <p className="quiz__left">{left > 0 ? `Сегодня можно ещё ${left} ${plural(left, forms)}` : "На сегодня попытки закончились — приходите завтра"}</p>;
}
