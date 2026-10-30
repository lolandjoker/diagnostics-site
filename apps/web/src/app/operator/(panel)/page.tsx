import { StaffChatEmpty } from "../../StaffMessenger";

export default function OperatorInboxPage() {
  return (
    <StaffChatEmpty>
      <p>Выберите чат слева.</p>
      <p>
        Здесь все переписки клиентов с экспертами. Отвечать можно в любой — клиент увидит сообщение от эксперта чата,
        с его именем и фото. Админ и эксперты видят подпись «Оператор» и ваше имя.
      </p>
    </StaffChatEmpty>
  );
}
