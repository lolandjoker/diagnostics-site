import { compatView, zodiac } from "@/lib/quiz-compat";
import { attemptsLeft, latestQuiz } from "@/lib/quizzes";
import { CompatQuiz } from "../../../CompatQuiz";
import { QuizPage } from "../../../QuizPage";
import { quizContext } from "../quiz-context";

export const dynamic = "force-dynamic";

/** «Совместимость пары» — квиз «Клуба Таромбы». */
export default async function CompatPage(props: PageProps<"/razbor/[id]/sovmestimost">) {
  const { id } = await props.params;
  const ctx = await quizContext(id);
  const now = new Date();
  const [row, left] = await Promise.all([latestQuiz(ctx.db, ctx.lead.id, "compat"), attemptsLeft(ctx.db, ctx.lead.id, "compat", now)]);
  return (
    <QuizPage ctx={ctx} title="Совместимость пары" lead="Введите дату рождения партнёра — посчитаем совместимость по знакам зодиака и числам судьбы.">
      <CompatQuiz
        leadId={ctx.lead.id}
        selfBirth={ctx.lead.birthDate}
        selfSign={zodiac(ctx.lead.birthDate).name}
        initial={row ? compatView(row, ctx.lead.birthDate, ctx.unlocked) : null}
        initialLeft={left}
        telegramHref={ctx.telegramHref}
        askHref={ctx.askHref}
        expertName={ctx.expertName}
      />
    </QuizPage>
  );
}
