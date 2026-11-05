import { archetypeView } from "@/lib/quiz-archetype";
import { attemptsLeft, latestQuiz } from "@/lib/quizzes";
import { ArchetypeQuiz } from "../../../ArchetypeQuiz";
import { QuizPage } from "../../../QuizPage";
import { quizContext } from "../quiz-context";

export const dynamic = "force-dynamic";

/** Тест «Ваш архетип» — квиз «Клуба Таромбы». */
export default async function ArchetypePage(props: PageProps<"/razbor/[id]/arhetip">) {
  const { id } = await props.params;
  const ctx = await quizContext(id);
  const now = new Date();
  const [row, left] = await Promise.all([latestQuiz(ctx.db, ctx.lead.id, "archetype"), attemptsLeft(ctx.db, ctx.lead.id, "archetype", now)]);
  return (
    <QuizPage ctx={ctx} title="Ваш архетип" lead="Пять вопросов о вас — и карта, которая описывает ваш характер. С картинкой для сторис.">
      <ArchetypeQuiz
        leadId={ctx.lead.id}
        initial={row ? archetypeView(row, ctx.unlocked) : null}
        initialLeft={left}
        telegramHref={ctx.telegramHref}
        askHref={ctx.askHref}
        expertName={ctx.expertName}
      />
    </QuizPage>
  );
}
