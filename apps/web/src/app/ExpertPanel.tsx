import Link from "next/link";
import { expertStatus, expertTags, formatRating } from "@/lib/experts";
import type { PublicExpert } from "@/lib/experts";
import { reviewsCountLabel } from "@/lib/reviews";
import type { ReviewsCount } from "@/lib/reviews";
import { PhotoGallery } from "./PhotoGallery";

/** Мини-профиль эксперта справа от чата: фото (листаются), рейтинг, специализации, начало описания, ссылка на профиль. */
export function ExpertPanel({
  expert,
  photos,
  busyLabel,
  profileHref,
  reviews,
}: {
  expert: PublicExpert;
  /** Главное фото и дополнительные — по порядку. */
  photos: string[];
  busyLabel: string;
  profileHref: string;
  reviews: ReviewsCount;
}) {
  const status = expertStatus(expert, new Date());
  const tags = expertTags(expert.tags);
  const text = expert.about || expert.description;
  return (
    <aside className="expert-panel" aria-label={`Эксперт ${expert.name}`}>
      <PhotoGallery photos={photos} name={expert.name} className="expert-panel__photo" />
      <div className="expert-panel__body">
        <b className="expert-panel__name">{expert.name}</b>
        <span className={`status status--${status}`}>
          {status === "online" ? "в сети" : status === "busy" ? busyLabel : "не в сети"}
        </span>
        <div className="expert__rating">
          <span className="rating">★ {formatRating(expert.rating)}</span>
          {reviews.total > 0 && <span className="muted">{reviewsCountLabel(reviews.total)}</span>}
        </div>
        {tags.length > 0 && (
          <ul className="tags">
            {tags.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
        {text && <p className="text expert-panel__text">{text}</p>}
        <Link className="expert-panel__more" href={profileHref}>
          Открыть полный профиль <span aria-hidden="true">→</span>
        </Link>
      </div>
    </aside>
  );
}
