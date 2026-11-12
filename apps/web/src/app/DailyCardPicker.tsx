"use client";

/**
 * Карта дня: веер из пяти рубашек — человек выбирает одну, она поднимается и переворачивается, блоки
 * расшифровки появляются по очереди: «Главное сегодня», «В любви», «В делах и деньгах», «Совет дня» и
 * «Что карта скрывает» с кнопкой «Спросить эксперта об этой карте» (в чат с готовым вопросом).
 * Без Telegram видны только заголовки блоков, текст размыт: вместо него — «Получить в Telegram».
 * Вернулся на вкладку после подключения — страница обновляется сама и показывает расшифровку.
 */
import { UnlockByEmail } from "./QuizParts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ARCANA, arcanaBackSvg, arcanaFaceSvg } from "@/lib/arcana";
import type { DailyCardView } from "@/lib/club";
import { drawCardAction } from "./razbor/[id]/den/actions";

const POSITIONS = [1, 2, 3, 4, 5];
/** Заглушка под размытием — настоящий текст до подключения Telegram не приходит. */
const BLUR = "Карта дня говорит о том, что важно для вас именно сейчас и как этим воспользоваться сегодня.";

const ICONS = {
  main: '<path d="M11.2 3a9 9 0 1 0 9.6 11.8 7.5 7.5 0 0 1-9.6-11.8Z"/>',
  love: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
  work: '<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5h6v2M4 12h16"/>',
  tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
};

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
);

export function DailyCardPicker({
  leadId,
  initial,
  telegramHref,
  askHref,
  expertName,
}: {
  leadId: string;
  initial: DailyCardView | null;
  /** Ссылка на бота, если Telegram ещё не подключён; null — подключён (или бот выключен). */
  telegramHref: string | null;
  /** Чат с экспертом (или список экспертов, если чата ещё нет). */
  askHref: string;
  expertName: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<DailyCardView | null>(initial);
  const [picking, setPicking] = useState<number | null>(null);
  const [open, setOpen] = useState(initial !== null);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backs = useMemo(() => POSITIONS.map((p) => arcanaBackSvg(`bk${p}`)), []);

  // Сервер прислал новое (например, после подключения Telegram расшифровка открылась)
  useEffect(() => {
    if (!initial) return;
    setView(initial);
    setOpen(true);
  }, [initial]);

  // Закрыто — ждём, что человек подключит Telegram и вернётся на вкладку
  useEffect(() => {
    if (!telegramHref || !view) return;
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [telegramHref, view, router]);

  async function pick(position: number) {
    if (picking !== null || view) return;
    setPicking(position);
    setError(null);
    const res = await drawCardAction(leadId, position);
    if ("error" in res) {
      setError(res.error);
      setPicking(null);
      return;
    }
    setFresh(true);
    setView(res);
    // Карта уже поднялась — переворачиваем; серию на странице обновим, когда карта откроется
    window.setTimeout(() => setOpen(true), 120);
    window.setTimeout(() => router.refresh(), 2500);
  }

  const chosen = view?.position ?? picking;
  const arcana = view ? ARCANA[view.card] : null;
  const s = view?.sections ?? null;
  const ask = arcana
    ? askHref.includes("/chat")
      ? `${askHref}&q=${encodeURIComponent(`Здравствуйте! Мне выпала карта дня «${arcana.name}». Расскажите, пожалуйста, что она значит для меня?`)}`
      : askHref
    : askHref;
  const blocks = s
    ? [
        { key: "love", title: "В любви", text: s.love, icon: ICONS.love },
        { key: "work", title: "В делах и деньгах", text: s.work, icon: ICONS.work },
      ]
    : [
        { key: "love", title: "В любви", text: BLUR, icon: ICONS.love },
        { key: "work", title: "В делах и деньгах", text: BLUR, icon: ICONS.work },
      ];

  return (
    <div className={`daily ${view ? "is-done" : ""} ${fresh ? "is-fresh" : ""}`}>
      {!view && (
        <p className="daily__hint">{picking ? "Карта открывается…" : "Сосредоточьтесь на сегодняшнем дне и выберите карту"}</p>
      )}
      <div className="daily__fan" aria-label="Пять карт рубашкой вверх">
        {POSITIONS.map((p, i) => {
          const isChosen = chosen === p;
          return (
            <button
              key={p}
              type="button"
              className={`daily__card ${isChosen ? "is-chosen" : ""} ${isChosen && open ? "is-open" : ""} ${isChosen && picking && !view ? "is-waiting" : ""}`}
              style={{ ["--i" as string]: i - 2 }}
              onClick={() => void pick(p)}
              disabled={view !== null || (picking !== null && !isChosen)}
              aria-label={view && isChosen && arcana ? `${arcana.n} · ${arcana.name}` : `Карта ${p}`}
            >
              <span className="daily__in">
                <span className="daily__side" dangerouslySetInnerHTML={{ __html: backs[i]! }} />
                <span
                  className="daily__side daily__face"
                  dangerouslySetInnerHTML={{ __html: view && isChosen ? arcanaFaceSvg(view.card, `face${p}`) : "" }}
                />
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      {view && arcana && open && (
        <div className="daily__reading" aria-live="polite">
          <span className="eyebrow">Карта дня · аркан {arcana.n}</span>
          <h2 className="daily__name">{arcana.name}</h2>
          <ul className="daily__keys" aria-label="Ключевые смыслы">
            {arcana.keywords.split(",").map((k) => (
              <li key={k}>{k.trim()}</li>
            ))}
          </ul>
          <p className="daily__num" title="Личный день по нумерологии — по вашей дате рождения">
            Ваше число дня — <b>{view.day}</b>
          </p>

          <section className="daily__block daily__block--main" style={{ ["--d" as string]: 0 }}>
            <h3>
              <Icon d={ICONS.main} /> Главное сегодня
            </h3>
            <p className={s ? undefined : "daily__blur"}>{s ? s.main : BLUR}</p>
          </section>

          <div className="daily__pair">
            {blocks.map((b, i) => (
              <section key={b.key} className="daily__block" style={{ ["--d" as string]: i + 1 }}>
                <h3>
                  <Icon d={b.icon} /> {b.title}
                </h3>
                <p className={s ? undefined : "daily__blur"}>{b.text}</p>
              </section>
            ))}
          </div>

          <section className="daily__block daily__tip" style={{ ["--d" as string]: 3 }}>
            <h3>
              <Icon d={ICONS.tip} /> Совет дня
            </h3>
            <p className={s ? undefined : "daily__blur"}>{s ? s.tip : BLUR}</p>
          </section>

          {s ? (
            <section className="daily__secret" style={{ ["--d" as string]: 4 }}>
              <span className="eyebrow">Что карта скрывает</span>
              <p>{s.teaser}</p>
              <Link className="button" href={ask}>
                Спросить эксперта об этой карте
              </Link>
              <small>{expertName ?? "Эксперт"} разберёт карту по вашей дате рождения — подробно и лично.</small>
            </section>
          ) : (
            <section className="daily__secret daily__secret--locked">
              <span className="eyebrow">Что карта скрывает</span>
              <b>Расшифровка готова</b>
              <span>Вступите в Клуб Таромбы — пришлём её в Telegram целиком, а каждое утро там будет новая карта.</span>
              {telegramHref && (
                <a className="button" href={telegramHref} target="_blank" rel="noopener noreferrer">
                  Получить в Telegram
                </a>
              )}
              <UnlockByEmail leadId={leadId} />
            </section>
          )}
          <p className="daily__next">Следующая карта — завтра.</p>
        </div>
      )}
    </div>
  );
}
