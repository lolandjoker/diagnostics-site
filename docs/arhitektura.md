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
| Чаты | `chat.ts` | подробный разбор приходит через 40 минут после начала чата (`FULL_TEXT_DELAY_MS`, приветствие обещает «в течение 40 минут», всё это время «печатает…»); `startConversation`, `postMessage`, `messageViews` (client/staff), `inbox`, `chatsOfLeads`, `chatSync` (удалённые и исправленные для опроса) |
| Правка/удаление | `chat-edit.ts` | правка — только эксперт/админ; удаление — любое; повтор в Telegram |
| Панель сотрудников | `staff-inbox.ts` | кеш списка 2 с (`staffInbox`), фильтр по эксперту, `searchMessages` (ILIKE + trigram) |
| Блокировка | `blocks.ts` | `leads.blocked_at` + `telegram_blocks`; проверка в `botCall` (ничего не шлём), в вебхуке (не слушаем), cookie `hb` для браузера |
| Геолокация | `geo.ts`, `geo-label.ts`, `geo-stats.ts` | DB-IP City Lite (mmdb в `node_modules`, в сборку через `outputFileTracingIncludes`), IP не храним |
| Telegram-бот | `telegram.ts` (Bot API, `botReply`), `bot-delivery.ts` (уведомления клиенту, плашки, очереди), `bot-inbox.ts` (ответы из бота в чат), `bot-experts.ts`, `bot-reviews.ts`, `bot-forecast.ts` (карта дня), `bot-quizzes.ts`, `bot-chores.ts` (плановое), `bot-emoji.ts`, `bot-card.tsx` | бот удаляет свои сообщения только 48 ч — правка старше: «Исправлено» ответом |
| Сотрудники в Telegram | `staff-telegram.ts` | одноразовый код привязки, уведомления и ответы сотрудников |
| Рассылки системные (бот и почта) | `broadcasts.ts`, `broadcast-pages.ts`, `broadcast-mail.ts`, `app/admin/(panel)/rassylki` (вкладка «Системные», `?tab=bot`), `app/admin/api/broadcast-count` | куда (`CHANNELS`, `broadcasts.channels`): Telegram (от бота, с /stop), почта или оба; «кому»: all / silent / never / no_archetype / no_compat / no_yesno / no_card / no_quiz — одно правило для обоих каналов (`audienceSql`): в Telegram — по человеку Telegram, на почту — по адресу (все заявки с ним; отписался по любой, заблокирован или Telegram в блоке — не берём; индекс `leads_email_idx`); при обоих — галочка «на почту только тем, кто не подключил Telegram» (`email_skip_telegram`); почта: тема письма обязательна, вся серия одним письмом (`broadcastMail`: **жирный**, 🎁, фото — картинкой из `chat_media`, видео — ссылкой, кнопки, «Отписаться» по последней заявке адреса), не быстрее `EMAIL_PER_SECOND`, итоги в `email_total/email_sent/email_failed`, Telegram и почта идут параллельно, «готово» — когда оба; проба — на Telegram ID и/или на почту; «Отписаться» снимает адрес во всех заявках; условия к «кому» (`BroadcastFilters`): первая заявка старше N ч, клиент не писал нам N ч (или вовсе); одно сообщение (движок умеет серию — её использует рассылка от экспертов); личная кнопка — у каждого своя страница (последняя заявка); готовые рассылки под квизы (`BROADCAST_TEMPLATES`) |
| Рассылки от экспертов | `expert-broadcasts.ts`, вкладка «От экспертов» (по умолчанию) | массовое сообщение каждому в его самый свежий чат (или чат с выбранным экспертом) от эксперта этого чата: видно в переписке, клиенту с Telegram — обычной доставкой чата (плашка, «Ответить на сайте», ответ из бота — в тот же чат); те же «кому» и условия; серия до 5 сообщений с фото или видео, `{имя}`; сообщения `automatic` + `broadcast_id` — сотрудники видят «рассылка», не считается ответом («Без ответа» остаётся), напоминание о непрочитанном не шлём; отправка по очереди с ожиданием доставки в Telegram |
| Общие файлы чата | `chat_media`, `app/api/chat/media/[id]` | фото и видео рассылки хранятся один раз на всех (`messages.media_id`); в Telegram — по `tg_file_id` после первой загрузки; маршрут отдаёт по uuid, видео частями (Range), последние 4 файла в памяти |
| Клуб Таромбы | `club.ts` (карта дня), `club-access.ts`, `quizzes.ts`, `quiz-compat.ts`, `quiz-archetype.ts`, `quiz-yesno.ts`, `quiz-images.tsx`, `arcana*.ts*`, `numerology.ts`, `ai-reading.ts` | результат (квизы, расшифровка карты дня) открыт с Telegram или с почтой — одно из двух (`club-access.ts`, `clubUnlocked`); в замке — кнопка Telegram и поле почты (`UnlockByEmail` в `app/QuizParts.tsx`); ИИ — Opus 5.5 по JSON-схеме (`aiJson`), без ключа — заготовки; квизы: совместимость раз в 5 дней, архетип раз в 30, «Да или нет» раз в день |
| Почта клиента | `mail.ts` (Web API UniSender Go по HTTPS — SMTP-порты в Timeweb закрыты), `lead-email.ts`, `app/EmailConnect.tsx`, `app/api/chat/[leadId]/email`, `app/pochta/otpiska` | почта обязательна: «Написать эксперту»/«Выбрать эксперта» (`app/ExpertChooseForm.tsx`) без почты в заявке открывает окно «Куда прислать ваш разбор?» без закрытия, `chooseExpert` без почты чат не начинает; у старых заявок без почты поле есть и в окне «Подключите Telegram» (если в .env заданы UNISENDER_GO_API_KEY и MAIL_FROM; домен taromba.com подтверждён в UniSender Go (SPF, DKIM, DMARC, поддомен ссылок email — CNAME в Timeweb)); `leads.email/email_at/email_opt_out_at/email_full_text_sent_at`; письма: «Подробный разбор готов» (уходит вместе с разбором из `deliverDueFullTexts`, или сразу, если разбор уже был), один раз на заявку; «Вам написал эксперт» — на каждое сообщение эксперта/админа/оператора (не automatic: без приветствий и рассылок, без разбора), если через 2 минуты (`MESSAGE_EMAIL_DELAY_MS`) клиент не ответил в этот чат и не открывал его на сайте (`client_read_at`), сообщения старше 30 минут не догоняем; `deliverDueMessageEmails` раз в 15 с из `instrumentation.ts` (если почта настроена, даже без бота), отметка `messages.email_notified_at` одним UPDATE до отправки, частичный индекс `messages_email_due_idx`; отписка по подписанной ссылке (SESSION_SECRET), вторую ссылку дописывает UniSender; менять почту — не чаще раза в минуту; админ и операторы видят почту в шапке чата, эксперт — значок «почта»; в списке чатов конверт на аватарке (`InboxItem.email`, без отписавшихся); «Сводка»: шаг воронки «Указали почту» и блок «Почта» (`emailStats`: заявки за период, указали, письма ушли, отписались) |
| Источники и воронка | `sources.ts`, `funnel.ts`, `variations.ts`, `period.ts` | короткие адреса (`/karta`, `/arhetip`, `/r1…`) → cookie источника; «Сводка» за период: готовые (`?period=today|yesterday|week|month|all`) или свой `?from=YYYY-MM-DD&to=YYYY-MM-DD` (включительно, дни по Москве; период `[since, until)`, `within()` в каждом подсчёте) |
| Эксперты, отзывы, звонки | `experts.ts`, `reviews.ts`, `calls.ts`, `certificates.ts`, `gallery.ts` | |
| Доступ | `admin-auth.ts`, `expert-auth.ts`, `operator-auth.ts`, `staff-auth.ts`, `owner.ts` | `chatWorker()` — админ или оператор; владелец (OWNER_TELEGRAM_IDS в .env) — `/admin` в боте → ссылка `/admin/telegram?t=…` на 10 минут ставит cookie админки |

## Чаты сотрудников (админ, операторы, эксперты)

- Каркас — `app/StaffMessenger.tsx` (список слева, чат справа; на телефоне что-то одно, открытый чат — на весь
  экран), список — `app/InboxList.tsx`, шапка — `StaffChatHead`, переписка — `app/ChatThread.tsx`.
- Список: `/admin/api/inbox?expert=<id>` (оператор и админ), `/expert/api/inbox` (эксперт) — `{ items, experts }`;
  опрос 5 с, в фоне 30 с. Поиск: `/admin/api/search?q=…` и `/expert/api/search` — от 2 символов, до 50 результатов;
  переход к сообщению — `?m=<id>` в адресе чата.
- Эксперты как аккаунты: колонка с фото слева от списка (`xrail` в `InboxList`; на телефоне — строка), точка «в сети»,
  непрочитанные (`inboxExperts`, общий кеш 2 с). Выбран эксперт — только его чаты (`?expert=`), «Все» — все.
- Темы панели: `lib/staff-theme.ts` (светлая, тёмная, песочная, морская), cookie `staff_theme` читается в layout
  (`data-theme` у `.admin`, без мигания), выбор — `app/ThemePicker.tsx`. Цвета — переменные `.admin` (`--page`, `--panel`,
  `--surface`, `--text`, `--muted`, `--line`, `--gold` — акцент темы, `--own`); новые стили панели — только через них.
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
