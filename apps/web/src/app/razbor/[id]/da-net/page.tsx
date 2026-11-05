import { yesNoView } from "@/lib/quiz-yesno";
import { attemptsLeft, latestQuiz } from "@/lib/quizzes";
import { QuizPage } from "../../../QuizPage";
import { YesNoQuiz } from "../../../YesNoQuiz";
import { quizContext } from "../quiz-context";

export const dynamic = "force-dynamic";

/** «Да или нет» — квиз «Клуба Таромбы»: одна карта на вопрос. */
export default async function YesNoPage(props: PageProps<"/razbor/[id]/da-net">) {
  const { id } = await props.params;
  const ctx = await quizContext(id);
  const now = new Date();
  const [row, left] = await Promise.all([latestQuiz(ctx.db, ctx.lead.id, "yesno"), attemptsLeft(ctx.db, ctx.lead.id, "yesno", now)]);
  return (
    <QuizPage ctx={ctx} title="Да или нет" lead="Задайте вопрос, на который можно ответить «да» или «нет», и вытяните одну карту.">
      <YesNoQuiz
        leadId={ctx.lead.id}
        initial={row ? yesNoView(row, ctx.unlocked) : null}
        initialLeft={left}
        telegramHref={ctx.telegramHref}
        askHref={ctx.askHref}
        expertName={ctx.expertName}
      />
    </QuizPage>
  );
}
