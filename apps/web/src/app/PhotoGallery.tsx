"use client";

/**
 * Фото эксперта, которые можно листать: свайпом, стрелками или точками.
 * Одно фото — просто картинка; ни одного — первая буква имени.
 */
import { useRef, useState } from "react";
import { initial } from "./Avatar";

export function PhotoGallery({ photos, name, className }: { photos: string[]; name: string; className: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <div className={className}>
        <span aria-hidden="true">{initial(name)}</span>
      </div>
    );
  }

  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const next = (i + photos.length) % photos.length;
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className={`${className} gallery`} role="group" aria-roledescription="фото" aria-label={`Фото: ${name}`}>
      <div
        className="gallery__track"
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {photos.map((src, i) => (
          <img key={src} src={src} alt={i === 0 ? name : `${name}, фото ${i + 1}`} loading={i === 0 ? "eager" : "lazy"} />
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <button type="button" className="gallery__arrow gallery__arrow--prev" onClick={() => go(index - 1)} aria-label="Предыдущее фото">
            ‹
          </button>
          <button type="button" className="gallery__arrow gallery__arrow--next" onClick={() => go(index + 1)} aria-label="Следующее фото">
            ›
          </button>
          <div className="gallery__dots">
            {photos.map((src, i) => (
              <button
                key={src}
                type="button"
                className={i === index ? "is-current" : undefined}
                onClick={() => go(i)}
                aria-label={`Фото ${i + 1} из ${photos.length}`}
                aria-current={i === index ? "true" : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
