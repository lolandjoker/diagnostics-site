import { getDb } from "@/db";
import { formatRub } from "@/lib/offers";
import { listOrders, orderNumber } from "@/lib/orders";
import { cancelOrderAction, markPaidAction, resendEmailAction } from "../../actions";

const STATUS = { pending: "ждёт оплаты", paid: "оплачен", cancelled: "отменён" } as const;

const fmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function OrdersPage() {
  const rows = await listOrders(await getDb());
  return (
    <>
      <h1>Заказы</h1>
      <p className="muted">
        Пока платёжный сервис не подключён, оплату подтверждаете вы: «Оплачен» — и человеку уходит письмо с продуктом.
        Время — московское. Показаны последние 200 заказов.
      </p>
      {rows.length === 0 ? (
        <p className="muted">Заказов пока нет.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>Создан</th>
                <th>Продукт</th>
                <th>Сумма</th>
                <th>Почта</th>
                <th>Статус</th>
                <th>Письмо</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ order, productTitle, variantLabel }) => (
                <tr key={order.id}>
                  <td>{orderNumber(order.id)}</td>
                  <td>{fmt.format(order.createdAt)}</td>
                  <td>
                    {productTitle}
                    {variantLabel && <small> ({variantLabel})</small>}
                  </td>
                  <td>{formatRub(order.amountKopecks)}</td>
                  <td>{order.email}</td>
                  <td>{STATUS[order.status]}</td>
                  <td>
                    {order.emailSentAt
                      ? `отправлено ${fmt.format(order.emailSentAt)}`
                      : order.emailError
                        ? <span className="error-text">{order.emailError}</span>
                        : "—"}
                  </td>
                  <td className="actions">
                    {order.status === "pending" && (
                      <>
                        <form action={markPaidAction}>
                          <input type="hidden" name="id" value={order.id} />
                          <button className="link-button">Оплачен</button>
                        </form>
                        <form action={cancelOrderAction}>
                          <input type="hidden" name="id" value={order.id} />
                          <button className="link-button link-button--danger">Отменить</button>
                        </form>
                      </>
                    )}
                    {order.status === "paid" && (
                      <form action={resendEmailAction}>
                        <input type="hidden" name="id" value={order.id} />
                        <button className="link-button">Отправить письмо ещё раз</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
