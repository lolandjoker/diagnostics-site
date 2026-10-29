"use client";

/** Отзывы на карточке эксперта: по pageSize на страницу, страницы листаются кнопками под списком. */
import { useState } from "react";
import { pageNumbers } from "@/lib/pagination";
import type { PublicReview } from "@/lib/reviews";
import { Stars } from "./Stars";

const date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", year: "numeric" });

export function ReviewsPager({ reviews, pageSize }: { reviews: PublicReview[]; pageSize: number }) {
  const [page, setPage] = useState(1);
  const total = Math.max(1, Math.ceil(reviews.length / pageSize));
  const shown = reviews.slice((page - 1) * pageSize, page * pageSize);
  return (
    <>
      <ul>
        {shown.map((rev) => (
          <li key={rev.id} className="review">
            <div className="review__head">
              <b>{rev.authorName}</b>
              {rev.verified && (
                <span className="verified" title="Мы переписывались с этим человеком и убедились, что отзыв оставил живой клиент">
                  ✓ Проверенный пользователь
                </span>
              )}
              <Stars n={rev.stars} />
              <time className="muted" dateTime={rev.createdAt}>
                {date.format(new Date(rev.createdAt))}
              </time>
            </div>
            {rev.body && <p className="text">{rev.body}</p>}
          </li>
        ))}
      </ul>
      {total > 1 && (
        <nav className="pager" aria-label="Страницы отзывов">
          <button type="button" className="pager__btn" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Назад">
            ‹
          </button>
          {pageNumbers(page, total).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="pager__gap">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={p === page ? "pager__btn is-current" : "pager__btn"}
                onClick={() => setPage(p)}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </button>
            ),
          )}
          <button
            type="button"
            className="pager__btn"
            onClick={() => setPage(page + 1)}
            disabled={page === total}
            aria-label="Вперёд"
          >
            ›
          </button>
        </nav>
      )}
    </>
  );
}
