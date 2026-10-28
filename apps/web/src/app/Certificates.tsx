"use client";

/**
 * Сертификаты в профиле эксперта. По нажатию сертификат открывается в окне поверх страницы:
 * закрыть — крестиком, Esc или нажатием мимо картинки; несколько — листаются стрелками и свайпом.
 * Окно — обычный слой, а не <dialog>: встроенный браузер Telegram на старых телефонах <dialog>
 * не открывает. Слой выносится прямо в <body>: внутри карточки профиля (у неё размытие фона)
 * position: fixed считается от карточки, а не от экрана. Без JavaScript ссылка просто открывает картинку.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CertificateView } from "@/lib/certificates";

export function Certificates({ items }: { items: CertificateView[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const current = index === null ? null : items[index];
  const closeButton = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const many = items.length > 1;
  const step = (delta: number) => setIndex((i) => (i === null ? i : (i + delta + items.length) % items.length));

  // Открыто окно: Esc закрывает, ← → листают, страница под окном не прокручивается
  const open = index !== null;
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIndex(null);
      if (!many) return;
      if (e.key === "ArrowLeft") setIndex((i) => (i === null ? i : (i - 1 + items.length) % items.length));
      if (e.key === "ArrowRight") setIndex((i) => (i === null ? i : (i + 1) % items.length));
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [open, many, items.length]);

  return (
    <>
      <ul className="certs">
        {items.map((cert, i) => (
          <li key={cert.id}>
            <a
              href={cert.url}
              className="certs__item"
              onClick={(e) => {
                e.preventDefault();
                setIndex(i);
              }}
            >
              <img src={cert.url} alt={cert.title || "Сертификат"} loading="lazy" />
              {cert.title && <span>{cert.title}</span>}
            </a>
          </li>
        ))}
      </ul>

      {current &&
        createPortal(
          <div
            className="certview"
            role="dialog"
            aria-modal="true"
            aria-label={current.title || "Сертификат"}
            // Нажатие на затемнение вокруг картинки — закрыть
            onClick={(e) => {
              if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("certview__stage")) setIndex(null);
            }}
            // На телефоне — листать свайпом
            onTouchStart={(e) => {
              touchX.current = e.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(e) => {
              const start = touchX.current;
              const end = e.changedTouches[0]?.clientX;
              touchX.current = null;
              if (!many || start === null || end === undefined || Math.abs(end - start) < 50) return;
              step(end < start ? 1 : -1);
            }}
          >
            <div className="certview__stage">
              <img src={current.url} alt={current.title || "Сертификат"} />
            </div>
            {(current.title || many) && (
              <p className="certview__caption">
                {current.title}
                {many && <span>{` ${index! + 1} из ${items.length}`}</span>}
              </p>
            )}
            <button ref={closeButton} type="button" className="certview__close" onClick={() => setIndex(null)} aria-label="Закрыть">
              ×
            </button>
            {many && (
              <>
                <button type="button" className="certview__arrow certview__arrow--prev" onClick={() => step(-1)} aria-label="Предыдущий сертификат">
                  ‹
                </button>
                <button type="button" className="certview__arrow certview__arrow--next" onClick={() => step(1)} aria-label="Следующий сертификат">
                  ›
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
