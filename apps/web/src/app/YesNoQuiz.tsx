"use client";

/**
 * «Да или нет»: человек пишет вопрос и тянет карту — она переворачивается, крупно ответ и объяснение.
 * Без Telegram — карта видна, а ответ и текст закрыты. На деликатный вопрос (здоровье, жизнь) — без «да» и «нет».
 */
import { useEffect, useState } from "react";
import { ARCANA, arcanaBackSvg, arcanaFaceSvg } from "@/lib/arcana";
import type { YesNoView } from "@/lib/quiz-yesno";
import { ANSWER_LABEL, QUESTION_MAX, QUESTION_MIN } from "@/lib/quiz-yesno-data";
import { NextAttempt, QuizLocked, QuizSecret, askWith, useRefreshOnFocus } from "./QuizParts";
import { yesNoAction } from "./razbor/[id]/quiz-actions";

export function YesNoQuiz({
  leadId,
  initial,
  initialNext,
  telegramHref,
  askHref,
  expertName,
}: {
  leadId: string;
  initial: YesNoView | null;
  /** Когда можно снова; null — можно сейчас. */
  initialNext: string | null;
  telegramHref: string | null;
  askHref: string;
  expertName: string | null;
}) {
  const [view, setView] = useState(initial);
  const [next, setNext] = useState(initialNext);
  const [asking, setAsking] = useState(initial === null);
  const [question, setQuestion] = useState("");
  const [open, setOpen] = useState(initial !== null);
  const [fresh, setFresh] = useState(false);
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
    const res = await yesNoAction(leadId, question);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setFresh(true);
    setOpen(false);
    setView(res.view);
    setNext(res.next);
    setAsking(false);
    setQuestion("");
    window.setTimeout(() => setOpen(true), 150);
  }

  if (asking) {
    return (
      <form className="yn yn__form" onSubmit={submit}>
        <p className="yn__hint">Сформулируйте вопрос так, чтобы на него можно было ответить «да» или «нет». Сосредоточьтесь на нём и вытяните карту.</p>
        <label className="field">
          <span>Ваш вопрос</span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, QUESTION_MAX))}
            rows={3}
            maxLength={QUESTION_MAX}
            placeholder="Например: стоит ли мне менять работу этой весной?"
            required
            minLength={QUESTION_MIN}
          />
          <small>
            {question.length} / {QUESTION_MAX}
          </small>
        </label>
        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Карта открывается…" : "Вытянуть карту"}
        </button>
        {view && (
          <button className="button button--ghost" type="button" onClick={() => setAsking(false)}>
            Назад к ответу
          </button>
        )}
        <p className="quiz__left">Карты отвечают на один вопрос в день.</p>
      </form>
    );
  }

  if (!view) return null;
  const c = ARCANA[view.card] ?? ARCANA[0]!;
  const r = view.result;
  const label = r?.answer ? ANSWER_LABEL[r.answer] : null;
  return (
    <div className={`yn ${fresh ? "is-fresh" : ""}`} aria-live="polite">
      <p className="yn__question">«{view.question}»</p>
      <div className={`yn__card ${open ? "is-open" : ""}`}>
        <span className="daily__in">
          <span className="daily__side" dangerouslySetInnerHTML={{ __html: arcanaBackSvg("ynb") }} />
          <span className="daily__side daily__face" dangerouslySetInnerHTML={{ __html: arcanaFaceSvg(view.card, "ynf") }} />
        </span>
      </div>
      {open && (
        <div className="yn__reading">
          <span className="eyebrow">
            Аркан {c.n} · {c.name}
          </span>
          {r ? (
            <>
              {label && <p className={`yn__answer yn__answer--${r.answer}`}>{label}</p>}
              <section className="daily__block daily__block--main" style={{ ["--d" as string]: 0 }}>
                <h3>{label ? "Что отвечает карта" : "Карта о вашем вопросе"}</h3>
                <p>{r.text}</p>
              </section>
              <section className="daily__block daily__tip" style={{ ["--d" as string]: 1 }}>
                <h3>Совет</h3>
                <p>{r.advice}</p>
              </section>
              <QuizSecret
                eyebrow="Что за этим стоит"
                teaser={r.teaser}
                href={askWith(
                  askHref,
                  `Здравствуйте! Мой вопрос картам: «${view.question}». Выпала карта «${c.name}»${label ? `, ответ — «${label}»` : ""}. Расскажите подробнее, что она значит для меня?`,
                )}
                button="Разобрать вопрос с экспертом"
                note={`${expertName ?? "Эксперт"} посмотрит ваш вопрос подробно — по дате рождения и раскладу.`}
              />
            </>
          ) : (
            <>
              <p className="yn__answer yn__answer--locked" aria-hidden="true">
                ???
              </p>
              <QuizLocked
                title="Ответ карты готов"
                text="Вступите в Клуб Таромбы через Telegram — откроем ответ и объяснение здесь и пришлём их туда."
                telegramHref={telegramHref}
                leadId={leadId}
              />
            </>
          )}
          {next ? (
            <NextAttempt
              next={next}
              what="Следующий вопрос картам"
              button={!r}
              askHref={askHref}
              ask={`Здравствуйте! Мой вопрос картам: «${view.question}». Выпала карта «${c.name}»${label ? `, ответ — «${label}»` : ""}. Расскажите подробнее, что она значит для меня?`}
            />
          ) : (
            <button className="button button--ghost" type="button" onClick={() => setAsking(true)}>
              Задать другой вопрос
            </button>
          )}
        </div>
      )}
    </div>
  );
}
