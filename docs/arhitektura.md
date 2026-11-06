# Как устроен сайт — карта для разработки

Справочник, чтобы быстро войти в контекст: что где лежит, как связано и какие правила держим.
Сайт — taromba.com (бренд «Таромба»). Код — `apps/web` (Next.js 16, App Router, React 19, TypeScript strict),
база — Postgres на сервере, PGlite локально и в тестах, ORM — Drizzle. Выкат — `docs/vykat.md`.

## Правила

- **Миграции только добавляют** (новые таблицы и столбцы, индексы). Ничего не удаляем и не переименовываем:
  неиспользуемое остаётся в схеме с комментарием. Генерация — `pnpm exec drizzle-kit generate --name <имя>`
  в `apps/web`; своя SQL — `--custom`. Миграции применяются сайтом при первом обращении к базе.
- **Миграция должна проходить и в PGlite** (тесты). Что доступно только в Postgres (расширения), заворачиваем
  в `DO $$ … EXCEPTION WHEN others … $$` — пример `0031_messages_search.sql`.
- **Общее состояние процесса — в `globalThis`** (`__diagBotEmoji`, `__diagBotCards`, `__diagBotQueues`,
  `__diagCardFiles`, `__diagGeo`, `__diagTgBlocks`, `__diagInbox`): instrumentation, route handlers
  и серверные действия — разные экземпляры модулей.
- **Клиентские компоненты не импортируют серверные модули** (база, SDK, `node:*`). Данные для браузера —
  в отдельных файлах без зависимостей: `quiz-archetype-data.ts`, `quiz-yesno-data.ts`, `broadcast-pages.ts`,
  `geo-label.ts`, `arcana.ts`. Типы из серверных модулей — только `import type`.
- **Тексты для людей — по-русски, на «вы», без обещаний результата** (особенно в ИИ-текстах и шаблонах).
- **Коммиты и PR — без подписей Claude** (Co-Authored-By, «Generated with»).
- Проверки перед PR: `tsc --noEmit`, `pnpm lint`, `pnpm --filter @diag/web test`, `build`. Новые маршруты —
  `next typegen` перед `tsc`.

## Модули (`apps/web/src/lib`)

| Область | Файлы | Что важно |
|---|---|---|
| Заявки | `leads.ts` | заявка = имя + дата рождения; cookie заявки в браузере (`rememberLead`); `geoCountry/geoCity`, `blockedAt` |
| Чаты | `chat.ts` | `startConversation`, `postMessage`, `messageViews` (client/staff), `inbox`, `chatsOfLeads`, `chatSync` (удалённые и исправленные для опроса) |
| Правка/удаление | `chat-edit.ts` | правка — только эксперт/админ; удаление — любое; повтор в Telegram |
| Панель сотрудников | `staff-inbox.ts` | кеш списка 2 с (`staffInbox`), фильтр по эксперту, `searchMessages` (ILIKE + trigram) |
| Блокировка | `blocks.ts` | `leads.blocked_at` + `telegram_blocks`; проверка в `botCall` (ничего не шлём), в вебхуке (не слушаем), cookie `hb` для браузера |
| Геолокация | `geo.ts`, `geo-label.ts`, `geo-stats.ts` | DB-IP City Lite (mmdb в `node_modules`, в сборку через `outputFileTracingIncludes`), IP не храним |
| Telegram-бот | `telegram.ts` (Bot API, `botReply`), `bot-delivery.ts` (уведомления клиенту, плашки, очереди), `bot-inbox.ts` (ответы из бота в чат), `bot-experts.ts`, `bot-reviews.ts`, `bot-forecast.ts` (карта дня), `bot-quizzes.ts`, `bot-chores.ts` (плановое), `bot-emoji.ts`, `bot-card.tsx` | бот удаляет свои сообщения только 48 ч — правка старше: «Исправлено» ответом |
| Сотрудники в Telegram | `staff-telegram.ts` | одноразовый код привязки, уведомления и ответы сотрудников |
| Рассылки | `broadcasts.ts`, `broadcast-pages.ts` | «кому»: all / silent / never; личная кнопка — у каждого своя страница (последняя заявка) |
| Клуб Таромбы | `club.ts` (карта дня), `quizzes.ts`, `quiz-compat.ts`, `quiz-archetype.ts`, `quiz-yesno.ts`, `quiz-images.tsx`, `arcana*.ts*`, `numerology.ts`, `ai-reading.ts` | без Telegram результат закрыт; ИИ — Opus 5.5 по JSON-схеме (`aiJson`), без ключа — заготовки; квизы: совместимость раз в 5 дней, архетип раз в 30, «Да или нет» раз в день |
| Источники и воронка | `sources.ts`, `funnel.ts`, `variations.ts` | короткие адреса (`/karta`, `/arhetip`, `/r1…`) → cookie источника |
| Эксперты, отзывы, звонки | `experts.ts`, `reviews.ts`, `calls.ts`, `certificates.ts`, `gallery.ts` | |
| Доступ | `admin-auth.ts`, `expert-auth.ts`, `operator-auth.ts`, `staff-auth.ts` | `chatWorker()` — админ или оператор |

## Чаты сотрудников (админ, операторы, эксперты)

- Каркас — `app/StaffMessenger.tsx` (список слева, чат справа; на телефоне что-то одно, открытый чат — на весь
  экран), список — `app/InboxList.tsx`, шапка — `StaffChatHead`, переписка — `app/ChatThread.tsx`.
- Список: `/admin/api/inbox?expert=<id>` (оператор и админ), `/expert/api/inbox` (эксперт) — `{ items, experts }`;
  опрос 5 с, в фоне 30 с. Поиск: `/admin/api/search?q=…` и `/expert/api/search` — от 2 символов, до 50 результатов;
  переход к сообщению — `?m=<id>` в адресе чата.
- Папки: «Мои» (эксперт), «Все», «Без ответа» (`waitingSince`: клиент написал, живого ответа нет; автоприветствие
  и разбор — не ответ), «Непрочитанные».
- Один клиент — одна заявка — несколько чатов (по чату на эксперта). В списке: «↪ ранее: …» (`movedFrom`),
  «ещё N чатов», «разбор здесь»; в шапке — все чаты клиента ссылками и где он получил разбор (`fullTextSentAt`).
- «Разбор здесь» — в чате есть сообщение подробного разбора (`author = system`). Не по `fullTextSentAt`: эту отметку
  получают все созревшие чаты человека, а текст — только один.
- «Клуб» в шапке (`lib/club-status.ts`): карта дня (серия, сегодня), совместимость, архетип, «Да или нет»; не пройдено —
  кнопка «напомнить» подставляет готовый текст в поле ввода (событие `chat:insert`, слушает `ChatThread`).
- Птички: у всех наших сообщений; прочитано, если клиент открывал чат после (`clientReadAt`) или ответил после.
- Правка/удаление: `/admin/api/chat/<id>/messages/<messageId>` (PATCH/DELETE), блокировка —
  `/admin/api/chat/<id>/block` (POST/DELETE). Только админ и операторы.

## Сервер и нагрузка

- Сервер 195.133.81.137: 4 ядра, 8 ГБ памяти (≈6 ГБ свободно), без глобального IPv6. Контейнеры: web, postgres,
  redis, caddy, turn (+ бот content-factory — не трогаем).
- Что держит нагрузку низкой: кеш списка чатов на 2 с для всех сотрудников; редкий опрос в фоновой вкладке; поиск —
  с паузой после ввода, отменой прошлого запроса и лимитом; trigram-индекс на `messages.body`; геобаза IPv6 грузится,
  только если встретится IPv6 (IPv4 ≈60 МБ в памяти).
- Опросы: чат — 3 с (клиент и сотрудники), список чатов — 5 с. При росте нагрузки первым делом — увеличить кеш
  или перейти на события (SSE).

## Выкат (как делает Claude)

1. Проверить, что PR в `main`: `git merge-base --is-ancestor <ветка> origin/main`.
2. `ssh root@195.133.81.137`, в tmux-сессии **`deploy-auto`** (не трогать сессию `deploy`):
   `bash /opt/diagnostics/state/deploy.sh deploy <полный SHA>` с логом в `/opt/diagnostics/logs/deploy-<sha7>-<ts>.log`
   и кодом выхода в `.exit`. Успех — «Готово: работает <sha>». Время в журнале — UTC.
3. После: ошибки в `docker compose logs web`, при миграции — проверить столбцы в базе.

## Локальная проверка

- Сервер: из `apps/web` — `DATABASE_URL="pglite:<папка>" ADMIN_PASSWORD=… SESSION_SECRET=… node node_modules/next/dist/bin/next start -p 3100`.
- Данные: `seed.mjs` (эксперты, заявки); браузер — Edge без окна по CDP (сценарии в рабочей папке Claude).
  В браузере без окна `document.hasFocus()` ложно — чат считает вкладку фоновой; включать
  `Emulation.setFocusEmulationEnabled`. IP клиента — заголовок `X-Forwarded-For` через `Network.setExtraHTTPHeaders`.
- Telegram на копии — заглушка `tgmock.mjs` (`NODE_OPTIONS=--import`), привязка — POST в вебхук с `/start <код>`.
