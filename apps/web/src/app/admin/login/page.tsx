import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentStaff } from "@/lib/staff-auth";
import { ActionForm } from "../ActionForm";
import { login } from "../auth-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Вход в админку" };

export default async function LoginPage() {
  if (await currentStaff()) redirect("/admin");
  return (
    <main className="admin admin--login">
      <h1>Вход в админку</h1>
      <ActionForm action={login}>
        <label className="field">
          <span>Пароль</span>
          <input name="password" type="password" required autoComplete="current-password" autoFocus />
        </label>
        <button className="button">Войти</button>
      </ActionForm>
      <p className="muted">
        Эксперты входят со своим логином на странице <Link href="/expert/login">/expert/login</Link> — после входа
        админка доступна и им.
      </p>
    </main>
  );
}
