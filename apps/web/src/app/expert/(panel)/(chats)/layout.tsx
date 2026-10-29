import type { ReactNode } from "react";
import { requireExpert } from "@/lib/expert-auth";
import { StaffMessenger } from "../../../StaffMessenger";

/** Все чаты слева («Мои» — сверху вкладкой), открытый — справа (StaffMessenger). */
export default async function ExpertChatsLayout({ children }: { children: ReactNode }) {
  const expert = await requireExpert();
  return (
    <StaffMessenger inboxUrl="/expert/api/inbox" linkBase="/expert/chat" listHref="/expert" meId={expert.id}>
      {children}
    </StaffMessenger>
  );
}
