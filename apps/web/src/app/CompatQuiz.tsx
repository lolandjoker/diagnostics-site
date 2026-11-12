"use client";

/**
 * Совместимость пары: своя дата — из заявки, человек вводит дату партнёра (и имя, по желанию).
 * Результат — кольцо с процентом и три шкалы, ниже текст. Без Telegram — знаки видны, а проценты и текст закрыты.
 */
import { useEffect, useState } from "react";
import { maskBirthDate } from "@/lib/date-input";
import type { CompatView } from "@/lib/quiz-compat";
import { NextAttempt, QuizLocked, QuizSecret, askWith, useRefreshOnFocus } from "./QuizParts";
import { compatAction } from "./razbor/[id]/quiz-actions";

const R = 52;
const C = 2 * Math.PI * R;
const ru = (iso: string) => iso.split("-").reverse().join(".");

function Ring({ value, fresh }: { value: number | null; fresh: boolean }) {
  const [shown, setShown] = useState(fresh || value === null ? 0 : value);
  useEffect(() => {
    if (value === null) return;
    if (!fresh || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 1400);
      setShown(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, fresh]);
  return (
    <div className="compat__ring" role="img" aria-label={value === null ? "Совместимость закрыта" : `Совместимость ${value}%`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="8" />
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--gold)" strokeWidth="8" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - shown / 100)} />
      </svg>
      <div className="compat__num">
        <b>{value === null ? "?" : `${shown}%`}</b>
        <span>совместимость</span>
      </div>
    </div>
  );
}

export function CompatQuiz({
  leadId,
  selfBirth,
  selfSign,
  initial,
  initialNext,
  telegramHref,
  askHref,
  expertName,
}: {
  leadId: string;
  selfBirth: string;
  selfSign: string;
  initial: CompatView | null;
  /** Когда можно посчитать снова; null — можно сейчас. */
  initialNext: string | null;
  telegramHref: string | null;
  askHref: string;
  expertName: string | null;
}) {
  const [view, setView] = useState(initial);
  const [next, setNext] = useState(initialNext);
  const [editing, setEditing] = useState(initial === null);
  const [fresh, setFresh] = useState(false);
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useRefreshOnFocus(view !== null && view.result === null);

  useEffect(() => {
    setView(initial);
    setNext(initialNext);
  }, [initial, initialNext]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await compatAction(leadId, name, birth);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setFresh(true);
    setView(res.view);
    setNext(res.next);
    setEditing(false);
  }

  const r = view?.result ?? null;
  const askText = view
    ? `Здравствуйте! Хочу разобрать совместимость: моя дата рождения ${ru(selfBirth)}, ${view.partnerName ? `${view.partnerName} — ` : "партнёра — "}${ru(view.partnerBirth)}.${r ? ` Сайт показал ${r.scores.total}%.` : ""} Что вы скажете о нашей паре?`
    : "Здравствуйте! Хочу разобрать нашу совместимость с партнёром.";
  const ask = askWith(askHref, askText);

  return (
    <div className={`compat ${fresh ? "is-fresh" : ""}`}>
      {editing ? (
        <form className="compat__form" onSubmit={submit}>
          <p className="compat__self">
            Ваша дата — <b>{ru(selfBirth)}</b>, {selfSign}
          </p>
          <label className="field">
            <span>Имя партнёра (по желанию)</span>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>Дата рождения партнёра</span>
            <input
             
              value={birth}
              inputMode="numeric"
              placeholder="ДД.ММ.ГГГГ"
              required
              onChange={(e) => setBirth(maskBirthDate(e.target.value))}
              autoComplete="off"
            />
          </label>
          {error && (
            <p className="form__error" role="alert">
              {error}
            </p>
          )}
          <button className="button" type="submit" disabled={pending}>
            {pending ? "Считаем…" : "Рассчитать совместимость"}
          </button>
          {view && (
            <button className="button button--ghost" type="button" onClick={() => setEditing(false)}>
              Назад к результату
            </button>
          )}
          <p className="quiz__left">Новую совместимость можно посчитать раз в 5 дней.</p>
        </form>
      ) : (
        view && (
          <div className="compat__result" aria-live="polite">
            <div className="compat__pair">
              <div className="compat__sign">
                <b>{view.self.sign}</b>
                <small>вы · число {view.self.num}</small>
              </div>
              <svg width="44" height="24" viewBox="0 0 44 24" aria-hidden="true">
                <path d="M4 12h36M30 4l10 8-10 8M14 4 4 12l10 8" fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="compat__sign">
                <b>{view.partner.sign}</b>
                <small>
                  {view.partnerName || "партнёр"} · число {view.partner.num}
                </small>
              </div>
            </div>
            <Ring value={r ? r.scores.total : null} fresh={fresh} />
            <div className="compat__bars">
              {(
                [
                  ["Чувства", r?.scores.feelings],
                  ["Быт", r?.scores.life],
                  ["Страсть", r?.scores.passion],
                ] as const
              ).map(([label, v]) => (
                <div className="compat__bar" key={label}>
                  <span>{label}</span>
                  <i>
                    <span style={{ width: v === undefined ? "40%" : `${v}%` }} className={v === undefined ? "is-locked" : undefined} />
                  </i>
                  <em>{v === undefined ? "?" : `${v}%`}</em>
                </div>
              ))}
            </div>

            {r ? (
              <>
                <section className="daily__block daily__block--main" style={{ ["--d" as string]: 0 }}>
                  <h3>Ваша пара</h3>
                  <p>{r.text.summary}</p>
                </section>
                <div className="daily__pair">
                  <section className="daily__block" style={{ ["--d" as string]: 1 }}>
                    <h3>Чувства · {r.scores.feelings}%</h3>
                    <p>{r.text.feelings}</p>
                  </section>
                  <section className="daily__block" style={{ ["--d" as string]: 2 }}>
                    <h3>Быт · {r.scores.life}%</h3>
                    <p>{r.text.life}</p>
                  </section>
                </div>
                <section className="daily__block" style={{ ["--d" as string]: 3 }}>
                  <h3>Страсть · {r.scores.passion}%</h3>
                  <p>{r.text.passion}</p>
                </section>
                <QuizSecret
                  eyebrow="Что стоит разобрать"
                  teaser={r.text.teaser}
                  href={ask}
                  button="Разобрать пару с экспертом"
                  note={`${expertName ?? "Эксперт"} разберёт вашу пару по двум датам рождения — подробно и лично.`}
                />
              </>
            ) : (
              <QuizLocked
                title="Совместимость посчитана"
                text="Вступите в Клуб Таромбы через Telegram — откроем проценты и разбор пары здесь и пришлём их туда."
                telegramHref={telegramHref}
                leadId={leadId}
              />
            )}
            {next ? (
              <NextAttempt next={next} what="Следующий расчёт совместимости" askHref={askHref} ask={askText} button={!r} />
            ) : (
              <button className="button button--ghost compat__again" type="button" onClick={() => setEditing(true)}>
                Посчитать с другой датой
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
