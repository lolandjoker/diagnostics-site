"use client";

/**
 * Сертификаты в профиле эксперта. По нажатию сертификат открывается в окне поверх страницы:
 * закрыть — крестиком, Esc или нажатием мимо картинки; несколько — листаются стрелками и свайпом.
 * Без JavaScript ссылка просто открывает картинку.
 */
import { useEffect, useRef, useState } from "react";
import type { CertificateView } from "@/lib/certificates";

export function Certificates({ items }: { items: CertificateView[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const current = index === null ? null : items[index];

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (index !== null && !d.open) d.showModal();
    if (index === null && d.open) d.close();
  }, [index]);

  const touchX = useRef<number | null>(null);
  const step = (delta: number) => setIndex((i) => (i === null ? i : (i + delta + items.length) % items.length));

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

      <dialog
        ref={dialog}
        className="lightbox"
        aria-label={current?.title || "Сертификат"}
        onClose={() => setIndex(null)}
        // Нажатие на затемнение вокруг картинки — закрыть
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("lightbox__stage")) setIndex(null);
        }}
        // На телефоне — листать свайпом
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          const end = e.changedTouches[0]?.clientX;
          touchX.current = null;
          if (items.length < 2 || start === null || end === undefined || Math.abs(end - start) < 50) return;
          step(end < start ? 1 : -1);
        }}
        onKeyDown={(e) => {
          if (items.length < 2) return;
          if (e.key === "ArrowLeft") step(-1);
          if (e.key === "ArrowRight") step(1);
        }}
      >
        {current && (
          <>
            <div className="lightbox__stage">
              <img src={current.url} alt={current.title || "Сертификат"} />
            </div>
            {(current.title || items.length > 1) && (
              <p className="lightbox__caption">
                {current.title}
                {items.length > 1 && <span>{` ${index! + 1} из ${items.length}`}</span>}
              </p>
            )}
            <button type="button" className="lightbox__close" onClick={() => setIndex(null)} aria-label="Закрыть">
              ×
            </button>
            {items.length > 1 && (
              <>
                <button type="button" className="lightbox__arrow lightbox__arrow--prev" onClick={() => step(-1)} aria-label="Предыдущий сертификат">
                  ‹
                </button>
                <button type="button" className="lightbox__arrow lightbox__arrow--next" onClick={() => step(1)} aria-label="Следующий сертификат">
                  ›
                </button>
              </>
            )}
          </>
        )}
      </dialog>
    </>
  );
}
