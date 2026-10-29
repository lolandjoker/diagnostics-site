import { reviewsCountLabel } from "@/lib/reviews";
import type { ReviewsCount } from "@/lib/reviews";

/**
 * Подпись под отзывами, если часть из них — с других площадок: на карточке сумма, а в списке —
 * только последние отзывы с сайта; без подписи числа бы не сходились.
 */
export function ReviewsNote({ count }: { count: ReviewsCount }) {
  if (count.elsewhere === 0) return null;
  return (
    <p className="muted reviews__note">
      Всего {reviewsCountLabel(count.total)}, из них {count.elsewhere} — с других площадок, где эксперт работал раньше.
    </p>
  );
}
