import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentExpert } from "@/lib/expert-auth";
import { ActionForm } from "../../admin/ActionForm";
import { expertLogin } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Вход для экспертов" };

export default async function ExpertLoginPage() {
  if (await currentExpert()) redirect("/expert");
  return (
    <main className="admin admin--login">
      <h1>Вход для экспертов</h1>
      <ActionForm action={expertLogin}>
        <label className="field">
          <span>Логин</span>
          <input name="login" required autoComplete="username" autoCapitalize="none" autoFocus />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button className="button">Войти</button>
      </ActionForm>
    </main>
  );
}
