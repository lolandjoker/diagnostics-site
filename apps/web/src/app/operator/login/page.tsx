import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentOperator } from "@/lib/operator-auth";
import { ActionForm } from "../../admin/ActionForm";
import { operatorLogin } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Вход для операторов" };

export default async function OperatorLoginPage() {
  if (await currentOperator()) redirect("/operator");
  return (
    <main className="admin admin--login">
      <h1>Вход для операторов чатов</h1>
      <ActionForm action={operatorLogin}>
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
