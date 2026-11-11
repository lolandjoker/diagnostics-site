"use client";

/**
 * Почта для уведомлений — в окне «Подключите Telegram» в чате, для тех, кто не хочет Telegram: на неё придёт
 * подробный разбор (lib/lead-email.ts). POST url { email }; почта уже указана — показываем её и даём сменить.
 */
import { type FormEvent, useState } from "react";

export function EmailConnect({ url, current }: { url: string; current: string | null }) {
  const [email, setEmail] = useState(current ?? "");
  const [state, setState] = useState<{ kind: "idle" | "sending" } | { kind: "done"; email: string; sentNow: boolean } | { kind: "error"; text: string }>(
    current ? { kind: "done", email: current, sentNow: false } : { kind: "idle" },
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState({ kind: "sending" });
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = (await res.json().catch(() => ({}))) as { sentNow?: boolean; error?: string };
      if (!res.ok) return setState({ kind: "error", text: data.error ?? "Не получилось сохранить — попробуйте ещё раз" });
      setState({ kind: "done", email: email.trim().toLowerCase(), sentNow: data.sentNow === true });
    } catch {
      setState({ kind: "error", text: "Нет связи — попробуйте ещё раз" });
    }
  }

  if (state.kind === "done") {
    return (
      <div className="email-connect email-connect--done" role="status">
        <p>
          {state.sentNow ? "Отправили разбор на " : "Разбор придёт на "}
          <b>{state.email}</b>
        </p>
        <button type="button" className="email-connect__change" onClick={() => setState({ kind: "idle" })}>
          Изменить
        </button>
      </div>
    );
  }

  return (
    <form className="email-connect" onSubmit={submit}>
      <p className="email-connect__title">Или получите разбор на почту</p>
      <div className="email-connect__row">
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
        <button type="submit" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "…" : "Подключить"}
        </button>
      </div>
      {state.kind === "error" && <p className="email-connect__error">{state.text}</p>}
      <p className="email-connect__note">Только письмо с разбором. Отписаться можно в письме.</p>
    </form>
  );
}
