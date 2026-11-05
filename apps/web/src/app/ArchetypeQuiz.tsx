"use client";

/**
 * Тест «Ваш архетип»: пять вопросов по одному, затем карта архетипа, описание и картинка для сторис
 * («Поделиться» — системное меню телефона с картинкой, на компьютере — «Скачать»).
 * Без Telegram — «Ваш архетип готов» без названия: открывается после вступления в клуб.
 */
import { useEffect, useState } from "react";
import { arcanaBackSvg, arcanaFaceSvg } from "@/lib/arcana";
import type { ArchetypeView } from "@/lib/quiz-archetype";
import { QUESTIONS } from "@/lib/quiz-archetype-data";
import { Attempts, QuizLocked, QuizSecret, askWith, useRefreshOnFocus } from "./QuizParts";
import { archetypeAction } from "./razbor/[id]/quiz-actions";

export function ArchetypeQuiz({
  leadId,
  initial,
  initialLeft,
  telegramHref,
  askHref,
  expertName,
}: {
  leadId: string;
  initial: ArchetypeView | null;
  initialLeft: number;
  telegramHref: string | null;
  askHref: string;
  expertName: string | null;
}) {
  const [view, setView] = useState(initial);
  const [left, setLeft] = useState(initialLeft);
  const [answers, setAnswers] = useState<number[]>([]);
  const [taking, setTaking] = useState(initial === null);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useRefreshOnFocus(view !== null && view.result === null);

  useEffect(() => {
    setView(initial);
    setLeft(initialLeft);
  }, [initial, initialLeft]);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function");
  }, []);

  async function answer(i: number) {
    if (pending) return;
    const next = [...answers, i];
    setAnswers(next);
    if (next.length < QUESTIONS.length) return;
    setPending(true);
    setError(null);
    const res = await archetypeAction(leadId, next);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      setAnswers([]);
      return;
    }
    setFresh(true);
    setView(res.view);
    setLeft(res.left);
    setTaking(false);
    setAnswers([]);
  }

  const storyUrl = view ? `/razbor/${leadId}/arhetip/story?v=${view.id}` : "";

  async function share() {
    try {
      const blob = await (await fetch(storyUrl)).blob();
      const file = new File([blob], "moy-arhetip.png", { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Мой архетип" });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
    window.open(storyUrl, "_blank", "noopener");
  }

  if (taking) {
    const step = Math.min(answers.length, QUESTIONS.length - 1);
    const q = QUESTIONS[step]!;
    return (
      <div className="arch">
        <div className="arch__progress" aria-hidden="true">
          <span style={{ width: `${(answers.length / QUESTIONS.length) * 100}%` }} />
        </div>
        {pending ? (
          <p className="arch__wait">Определяем ваш архетип…</p>
        ) : (
          <>
            <span className="eyebrow">
              Вопрос {step + 1} из {QUESTIONS.length}
            </span>
            <p className="arch__q" key={step}>
              {q.q}
            </p>
            <div className="arch__opts">
              {q.options.map((o, i) => (
                <button key={o.text} type="button" onClick={() => void answer(i)}>
                  {o.text}
                </button>
              ))}
            </div>
            {answers.length > 0 && (
              <button className="arch__back" type="button" onClick={() => setAnswers(answers.slice(0, -1))}>
                ← Предыдущий вопрос
              </button>
            )}
          </>
        )}
        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
        {view && !pending && (
          <button className="button button--ghost" type="button" onClick={() => setTaking(false)}>
            Назад к результату
          </button>
        )}
      </div>
    );
  }

  if (!view) return null;
  const r = view.result;
  return (
    <div className={`arch arch--done ${fresh ? "is-fresh" : ""}`} aria-live="polite">
      <div className={`arch__card ${fresh ? "is-flip" : ""}`} dangerouslySetInnerHTML={{ __html: r ? arcanaFaceSvg(r.archetype.card, "arch") : arcanaBackSvg("archb") }} />
      {r ? (
        <>
          <span className="eyebrow">Ваш архетип</span>
          <h2 className="daily__name">{r.archetype.name}</h2>
          <p className="arch__tagline">{r.archetype.tagline}</p>
          <ul className="daily__keys" aria-label="Ключевые слова">
            {r.archetype.keywords.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
          <section className="daily__block daily__block--main" style={{ ["--d" as string]: 0 }}>
            <h3>Лично для вас</h3>
            <p>{r.personal}</p>
          </section>
          <div className="daily__pair">
            <section className="daily__block" style={{ ["--d" as string]: 1 }}>
              <h3>Ваша сила</h3>
              <p>{r.archetype.strength}</p>
            </section>
            <section className="daily__block" style={{ ["--d" as string]: 2 }}>
              <h3>В любви</h3>
              <p>{r.archetype.love}</p>
            </section>
          </div>
          <section className="daily__block daily__tip" style={{ ["--d" as string]: 3 }}>
            <h3>Ваша тень</h3>
            <p>{r.archetype.shadow}</p>
          </section>

          <section className="arch__story">
            <img src={storyUrl} alt={`Картинка для сторис: мой архетип — ${r.archetype.name}`} width={180} height={320} loading="lazy" />
            <div>
              <b>Картинка для сторис</b>
              <span>Поделитесь в TikTok, Instagram или Telegram — пусть друзья тоже узнают свой архетип.</span>
              <div className="arch__share">
                {canShare && (
                  <button className="button" type="button" onClick={() => void share()}>
                    Поделиться
                  </button>
                )}
                <a className={canShare ? "button button--ghost" : "button"} href={storyUrl} download="moy-arhetip.png">
                  Скачать картинку
                </a>
              </div>
            </div>
          </section>

          <QuizSecret
            eyebrow="Что стоит разобрать"
            teaser={r.teaser}
            href={askWith(askHref, `Здравствуйте! Тест показал, что мой архетип — ${r.archetype.name}. Расскажите, как он связан с моей датой рождения?`)}
            button="Спросить эксперта"
            note={`${expertName ?? "Эксперт"} разберёт ваш архетип по дате рождения — подробно и лично.`}
          />
        </>
      ) : (
        <QuizLocked
          title="Ваш архетип готов"
          text="Вступите в Клуб Таромбы — откроем архетип и картинку для сторис здесь и пришлём их в Telegram."
          telegramHref={telegramHref}
        />
      )}
      {left > 0 ? (
        <button className="button button--ghost" type="button" onClick={() => setTaking(true)}>
          Пройти заново
        </button>
      ) : (
        <Attempts left={0} forms={["раз", "раза", "раз"]} />
      )}
    </div>
  );
}
