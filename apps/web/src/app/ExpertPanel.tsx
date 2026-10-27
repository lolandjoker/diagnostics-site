import Link from "next/link";
import { expertStatus, expertTags, formatRating } from "@/lib/experts";
import type { PublicExpert } from "@/lib/experts";
import { reviewsCountLabel } from "@/lib/reviews";
import { initial } from "./Avatar";

/** Мини-профиль эксперта справа от чата: фото, рейтинг, специализации, начало описания, ссылка на профиль. */
export function ExpertPanel({
  expert,
  photo,
  busyLabel,
  profileHref,
}: {
  expert: PublicExpert;
  photo: string | null;
  busyLabel: string;
  profileHref: string;
}) {
  const status = expertStatus(expert, new Date());
  const tags = expertTags(expert.tags);
  const text = expert.about || expert.description;
  return (
    <aside className="expert-panel" aria-label={`Эксперт ${expert.name}`}>
      <div className="expert-panel__photo">
        {photo ? <img src={photo} alt="" /> : <span aria-hidden="true">{initial(expert.name)}</span>}
      </div>
      <div className="expert-panel__body">
        <b className="expert-panel__name">{expert.name}</b>
        <span className={`status status--${status}`}>
          {status === "online" ? "в сети" : status === "busy" ? busyLabel : "не в сети"}
        </span>
        <div className="expert__rating">
          <span className="rating">★ {formatRating(expert.rating)}</span>
          {expert.reviewsShown > 0 && <span className="muted">{reviewsCountLabel(expert.reviewsShown)}</span>}
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
