"use client";

/**
 * Карта дня: веер из пяти рубашек — человек выбирает одну, она поднимается и переворачивается, расшифровка
 * печатается. Без Telegram расшифровка закрыта: вместо неё — «Получить в Telegram». Вернулся на вкладку
 * после подключения — страница обновляется сама и показывает текст.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ARCANA, arcanaBackSvg, arcanaFaceSvg } from "@/lib/arcana";
import type { DailyCardView } from "@/lib/club";
import { drawCardAction } from "./razbor/[id]/den/actions";

const POSITIONS = [1, 2, 3, 4, 5];
/** Текст «закрытой» расшифровки — только для размытия, настоящий текст до подключения не приходит. */
const LOCKED_TEXT =
  "Сегодня карта говорит о том, что важно для вас именно сейчас: на что опереться, чего не торопить и какой маленький шаг сделать уже сегодня. Расшифровка учитывает вашу дату рождения.";

export function DailyCardPicker({
  leadId,
  initial,
  telegramHref,
}: {
  leadId: string;
  initial: DailyCardView | null;
  /** Ссылка на бота, если Telegram ещё не подключён; null — подключён (или бот выключен). */
  telegramHref: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<DailyCardView | null>(initial);
  const [picking, setPicking] = useState<number | null>(null);
  const [open, setOpen] = useState(initial !== null);
  const [typed, setTyped] = useState(initial?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const animate = useRef(false);
  const backs = useMemo(() => POSITIONS.map((p) => arcanaBackSvg(`bk${p}`)), []);

  // Сервер прислал новое (например, после подключения Telegram расшифровка открылась)
  useEffect(() => {
    if (!initial) return;
    setView(initial);
    setOpen(true);
    if (!animate.current) setTyped(initial.text ?? "");
  }, [initial]);

  // Закрыто — ждём, что человек подключит Telegram и вернётся на вкладку
  useEffect(() => {
    if (!telegramHref || !view) return;
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [telegramHref, view, router]);

  // Печать расшифровки
  useEffect(() => {
    const text = view?.text;
    if (!text || !open || !animate.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(text);
      return;
    }
    let i = 0;
    setTyped("");
    const t = setInterval(() => {
      i += 2;
      setTyped(text.slice(0, i));
      if (i >= text.length) clearInterval(t);
    }, 22);
    return () => clearInterval(t);
  }, [view?.text, open]);

  async function pick(position: number) {
    if (picking !== null || view) return;
    setPicking(position);
    setError(null);
    animate.current = true;
    const res = await drawCardAction(leadId, position);
    if ("error" in res) {
      setError(res.error);
      setPicking(null);
      return;
    }
    setView(res);
    // Карта уже поднялась — переворачиваем; серию на странице обновим, когда карта откроется
    window.setTimeout(() => setOpen(true), 120);
    window.setTimeout(() => router.refresh(), 1500);
  }

  const chosen = view?.position ?? picking;
  const arcana = view ? ARCANA[view.card] : null;

  return (
    <div className={`daily ${view ? "is-done" : ""}`}>
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
          {view.text !== null ? (
            <p className="daily__text">{typed}</p>
          ) : (
            <div className="daily__locked">
              <p className="daily__blur" aria-hidden="true">
                {LOCKED_TEXT}
              </p>
              <div className="daily__unlock">
                <b>Расшифровка готова</b>
                <span>Вступите в Клуб Таромбы — пришлём её в Telegram, а каждое утро там будет новая карта.</span>
                {telegramHref && (
                  <a className="button" href={telegramHref} target="_blank" rel="noopener noreferrer">
                    Получить в Telegram
                  </a>
                )}
              </div>
            </div>
          )}
          <p className="daily__next">Следующая карта — завтра.</p>
        </div>
      )}
    </div>
  );
}
