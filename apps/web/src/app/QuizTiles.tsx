/**
 * Плитки квизов на странице «Мой день»: совместимость, архетип, «Да или нет». Пройден — что получилось
 * (с Telegram) или «результат ждёт» (без Telegram). Открыть квиз можно всегда — замок на самом результате.
 */
import Link from "next/link";
import { type Db } from "@/db";
import { archetypeView } from "@/lib/quiz-archetype";
import { compatView } from "@/lib/quiz-compat";
import { yesNoView } from "@/lib/quiz-yesno";
import { ANSWER_LABEL } from "@/lib/quiz-yesno-data";
import { latestQuiz } from "@/lib/quizzes";

const ICONS = {
  compat: '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
  archetype: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17"/><circle cx="12" cy="12" r="3"/>',
  yesno: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9.5 10.5 11.5 12.5 15 9"/><path d="M9.5 16h5"/>',
};

export async function QuizTiles({ db, leadId, birthDate, unlocked }: { db: Db; leadId: string; birthDate: string; unlocked: boolean }) {
  const [compat, arch, yn] = await Promise.all([latestQuiz(db, leadId, "compat"), latestQuiz(db, leadId, "archetype"), latestQuiz(db, leadId, "yesno")]);
  const c = compat ? compatView(compat, birthDate, unlocked) : null;
  const a = arch ? archetypeView(arch, unlocked) : null;
  const y = yn ? yesNoView(yn, unlocked) : null;
  const waiting = "Результат ждёт в клубе";
  const tiles = [
    {
      key: "compat",
      href: "sovmestimost",
      title: "Совместимость",
      text: "По двум датам рождения: процент и три шкалы",
      status: c ? (c.result ? `${c.partnerName ? `${c.partnerName} и вы` : "Ваша пара"} — ${c.result.scores.total}%` : waiting) : null,
    },
    {
      key: "archetype",
      href: "arhetip",
      title: "Ваш архетип",
      text: "Пять вопросов и картинка для сторис",
      status: a ? (a.result ? `Ваш архетип — ${a.result.archetype.name}` : waiting) : null,
    },
    {
      key: "yesno",
      href: "da-net",
      title: "Да или нет",
      text: "Одна карта на ваш вопрос",
      status: y ? (y.result ? (y.result.answer ? `Последний ответ — «${ANSWER_LABEL[y.result.answer]}»` : "Ответ готов") : waiting) : null,
    },
  ] as const;
  return (
    <section className="qtiles" aria-labelledby="qtiles-title">
      <h2 id="qtiles-title" className="qtiles__title">
        Расклады и тесты
      </h2>
      <div className="qtiles__grid">
        {tiles.map((t) => (
          <Link key={t.key} className="qtile" href={`/razbor/${leadId}/${t.href}`}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[t.key] }} />
            <b>{t.title}</b>
            <span>{t.text}</span>
            {t.status && <small>{t.status}</small>}
          </Link>
        ))}
      </div>
    </section>
  );
}
