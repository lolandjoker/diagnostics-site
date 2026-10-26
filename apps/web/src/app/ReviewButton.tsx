"use client";

/**
 * Отзыв об эксперте из чата клиента: кнопка со звездой в шапке и окно со звёздами и текстом.
 * Один отзыв на чат — повторно открывается уже написанный, его можно поправить.
 */
import { useEffect, useState } from "react";

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path
        d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ReviewButton({ url, expertName, clientName }: { url: string; expertName: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const { review } = (await res.json()) as { review: { stars: number; body: string } | null };
        if (review) {
          setStars(review.stars);
          setBody(review.body);
          setSaved(true);
        }
      } catch {
        // Не загрузилось — откроется пустая форма
      }
    })();
  }, [url]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit() {
    if (stars === 0) {
      setError("Поставьте оценку — от 1 до 5 звёзд");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars, body }),
      });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Не удалось сохранить отзыв");
        return;
      }
      setSaved(true);
      setOpen(false);
      setThanks(true);
      setTimeout(() => setThanks(false), 3000);
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  const shown = hover || stars;
  return (
    <>
      <button
        type="button"
        className={saved ? "chat__icon-button chat__icon-button--done" : "chat__icon-button"}
        onClick={() => setOpen(true)}
        aria-label={saved ? "Изменить отзыв" : "Оставить отзыв"}
        title={saved ? "Изменить отзыв" : "Оставить отзыв об эксперте"}
      >
        <span className="review-icon">
          <Star filled={saved} />
        </span>
      </button>

      {open && (
        <div className="review-screen" role="dialog" aria-label="Отзыв об эксперте">
          <div className="review-card">
            <b className="review-card__title">Отзыв об эксперте {expertName}</b>
            <div className="review-stars" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={n <= shown ? "review-star review-star--on" : "review-star"}
                  onClick={() => setStars(n)}
                  onMouseEnter={() => setHover(n)}
                  aria-label={`${n} из 5`}
                  aria-pressed={n === stars}
                >
                  <Star filled={n <= shown} />
                </button>
              ))}
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Что понравилось, что было полезно?"
              maxLength={2000}
              rows={4}
            />
            <p className="review-card__note">
              Отзыв появится на карточке эксперта с вашим именем «{clientName}».
            </p>
            {error && <p className="form__error">{error}</p>}
            <div className="review-card__actions">
              <button type="button" className="button button--ghost" onClick={() => setOpen(false)}>
                Отмена
              </button>
              <button type="button" className="button" onClick={() => void submit()} disabled={busy}>
                {saved ? "Сохранить" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {thanks && (
        <div className="call-toast" role="status">
          Спасибо за отзыв!
        </div>
      )}
    </>
  );
}
