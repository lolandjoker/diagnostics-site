"use client";

/** Общее для квизов клуба: замок (Telegram или почта), вопрос эксперту, обновление после подключения. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

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

/**
 * Результат закрыт: открыть — подключить Telegram или указать почту (обязательно одно из двух).
 * Почта — сразу здесь: после неё страница обновляется и результат открывается.
 */
export function QuizLocked({ title, text, telegramHref, leadId }: { title: string; text: string; telegramHref: string | null; leadId: string }) {
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
      <UnlockByEmail leadId={leadId} />
    </section>
  );
}

/** «Или укажите почту — откроем результат сразу»: почта в заявку (как в чате), затем страница обновляется. */
export function UnlockByEmail({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`/api/chat/${leadId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setState("idle");
        setError(data.error ?? "Не получилось — попробуйте ещё раз");
        return;
      }
      setState("done");
      router.refresh();
    } catch {
      setState("idle");
      setError("Нет связи — попробуйте ещё раз");
    }
  }

  return (
    <form className="unlock-email" onSubmit={submit}>
      <span className="unlock-email__or">или укажите почту — откроем результат сразу</span>
      <div className="unlock-email__row">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="ваша@почта.ru"
          aria-label="Ваша почта"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" disabled={state !== "idle"}>
          {state === "idle" ? "Открыть" : "…"}
        </button>
      </div>
      {error && <small className="unlock-email__error">{error}</small>}
      <small className="unlock-email__note">Без спама — только ваши результаты и разбор.</small>
    </form>
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

const dateLabel = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long" });

/** «через 4 дня 7 ч — 10 ноября», «через 5 ч 20 мин». */
export function untilText(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "уже можно";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.max(1, Math.ceil((ms % 3_600_000) / 60_000));
  if (days >= 1) return `через ${days} ${plural(days, ["день", "дня", "дней"])}${hours ? ` ${hours} ч` : ""} — ${dateLabel.format(new Date(Date.parse(iso)))}`;
  return hours ? `через ${hours} ч ${mins} мин` : `через ${mins} мин`;
}

/**
 * Попытка использована: сколько осталось до следующей (отсчёт идёт сам) и путь к эксперту —
 * хочется узнать больше раньше, только с ним. Время вышло — страница обновится.
 */
/** button — своя кнопка к эксперту (false — она уже есть выше, в блоке с вопросом). */
export function NextAttempt({ next, what, askHref, ask, button = true }: { next: string; what: string; askHref: string; ask: string; button?: boolean }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= Date.parse(next)) {
        window.clearInterval(t);
        router.refresh();
      }
    }, 30_000);
    return () => window.clearInterval(t);
  }, [next, router]);
  return (
    <div className="quiz__next">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
      <p>
        {what} — <b suppressHydrationWarning>{untilText(next, now)}</b>
      </p>
      <span>{button ? "Не хотите ждать — спросите эксперта, он разберёт подробно." : "Не хотите ждать — разберите это с экспертом прямо сейчас."}</span>
      {button && (
        <Link className="button button--ghost" href={askWith(askHref, ask)}>
          Спросить эксперта
        </Link>
      )}
    </div>
  );
}
