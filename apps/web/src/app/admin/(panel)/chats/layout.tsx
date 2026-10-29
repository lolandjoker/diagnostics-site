import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { isAdmin } from "@/lib/admin-auth";
import { StaffMessenger } from "../../../StaffMessenger";

/** Все чаты слева, открытый — справа (StaffMessenger). Эксперт отвечает в своей панели. */
export default async function AdminChatsLayout({ children }: { children: ReactNode }) {
  if (!(await isAdmin())) redirect("/expert");
  return (
    <StaffMessenger inboxUrl="/admin/api/inbox" linkBase="/admin/chats" listHref="/admin/chats">
      {children}
    </StaffMessenger>
  );
}
