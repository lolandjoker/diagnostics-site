import { archetypeView } from "@/lib/quiz-archetype";
import { latestQuiz, nextAttemptFrom } from "@/lib/quizzes";
import { ArchetypeQuiz } from "../../../ArchetypeQuiz";
import { QuizPage } from "../../../QuizPage";
import { quizContext } from "../quiz-context";

export const dynamic = "force-dynamic";

/** Тест «Ваш архетип» — квиз «Клуба Таромбы». */
export default async function ArchetypePage(props: PageProps<"/razbor/[id]/arhetip">) {
  const { id } = await props.params;
  const ctx = await quizContext(id);
  const now = new Date();
  const row = await latestQuiz(ctx.db, ctx.lead.id, "archetype");
  return (
    <QuizPage ctx={ctx} title="Ваш архетип" lead="Ответьте на пять вопросов — и узнаете, какая карта описывает ваш характер. В конце получите красивую картинку с результатом, чтобы выложить её в сторис.">
      <ArchetypeQuiz
        leadId={ctx.lead.id}
        initial={row ? archetypeView(row, ctx.unlocked) : null}
        initialNext={nextAttemptFrom(row, "archetype", now)}
        telegramHref={ctx.telegramHref}
        askHref={ctx.askHref}
        expertName={ctx.expertName}
      />
    </QuizPage>
  );
}
