#!/usr/bin/env bash
# Выкат сайта на сервере. Запускать от root:
#   deploy.sh deploy <полный SHA коммита>   — выкатить версию
#   deploy.sh rollback                      — вернуть предыдущую удачную версию
#   deploy.sh status                        — что сейчас работает
#
# Перед выкатом: проверка места на диске и резервная копия базы.
# Если новая версия не поднялась — автоматически возвращается предыдущая.
# Одновременно может идти только один выкат (блокировка на сервере).
# Журналы контейнеров при сбое пишутся в файл на сервере, а не в публичный журнал GitHub.

set -euo pipefail

BASE=/opt/diagnostics
APP="$BASE/app"
STATE="$BASE/state"
BACKUPS="$BASE/backups"
LOGS="$BASE/logs"
HISTORY="$STATE/history"     # удачно выкаченные версии, по одной на строку, последняя — текущая
KEEP_BACKUPS=14
KEEP_IMAGES=5
IMAGE=diagnostics-web        # имя образа, который собирает docker compose для сервиса web

log() { echo "[выкат $(date -u +%H:%M:%S)] $*"; }
compose() { docker compose --project-name diagnostics --project-directory "$APP" "$@"; }
domain() { grep -E '^SITE_DOMAIN=' "$APP/.env" | cut -d= -f2-; }
current() { tail -n 1 "$HISTORY" 2>/dev/null || true; }

lock() {
  exec 9>"$STATE/deploy.lock"
  if ! flock -n 9; then log "Уже идёт другой выкат — этот остановлен"; exit 1; fi
}

check_disk() {
  local free_gb
  free_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
  log "Свободно на диске: ${free_gb} ГБ"
  if [ "$free_gb" -lt 3 ]; then log "Меньше 3 ГБ — выкат остановлен"; exit 1; fi
}

backup_db() {
  if compose ps --status running --services 2>/dev/null | grep -qx postgres; then
    local cur f tmp
    cur=$(current | cut -c1-7)
    f="$BACKUPS/db-$(date -u +%Y%m%d-%H%M%S)-${cur:-none}.sql.gz"
    tmp="$f.partial"
    # Сначала во временный файл: оборванная копия не выдаст себя за целую
    if ! compose exec -T postgres pg_dump -U diag diag | gzip > "$tmp"; then
      rm -f "$tmp"; log "Резервная копия не удалась — выкат остановлен"; exit 1
    fi
    if ! gzip -t "$tmp" || [ "$(gzip -dc "$tmp" | head -c 64 | wc -c)" -eq 0 ]; then
      rm -f "$tmp"; log "Резервная копия повреждена или пуста — выкат остановлен"; exit 1
    fi
    mv "$tmp" "$f"
    log "Резервная копия базы: $f ($(du -h "$f" | cut -f1))"
    { ls -1t "$BACKUPS"/db-*.sql.gz 2>/dev/null || true; } | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
  else
    log "База ещё не запущена — резервную копию делать не из чего"
  fi
}

# Журналы контейнеров — только в файл на сервере (в них могут быть личные данные)
save_failure_logs() {
  local f
  f="$LOGS/failure-$(date -u +%Y%m%d-%H%M%S).log"
  { compose ps; compose logs --tail=200 web caddy postgres redis turn; } > "$f" 2>&1 || true
  chmod 600 "$f"
  log "Журналы контейнеров сохранены на сервере: $f"
  compose ps --format '{{.Service}}: {{.State}} {{.Health}}' 2>/dev/null || true
}

wait_healthy() {
  local d web status
  d=$(domain)
  for i in $(seq 1 60); do
    web=$(compose ps -q web 2>/dev/null || true)
    status=$(docker inspect -f '{{.State.Health.Status}}' "$web" 2>/dev/null || echo нет)
    if [ "$status" = "healthy" ] &&
       curl -fsS --max-time 10 --resolve "${d}:443:127.0.0.1" "https://${d}/api/health" >/dev/null 2>&1; then
      log "Сайт отвечает по https://${d}"
      return 0
    fi
    [ $((i % 6)) -eq 0 ] && log "жду запуска… сайт: ${status}"
    sleep 5
  done
  log "Сайт не ответил за 5 минут"
  save_failure_logs
  return 1
}

# Внимание: функция вызывается внутри `if`, где `set -e` не действует, —
# поэтому каждая команда проверяется явно.
switch_to() {
  local sha="$1"
  # Ручные правки в файлах на сервере не трогаем: останавливаемся
  if [ -n "$(git -C "$APP" status --porcelain --untracked-files=no)" ]; then
    log "На сервере есть ручные правки в коде — выкат остановлен, ничего не изменено:"
    git -C "$APP" status --short --untracked-files=no
    return 1
  fi
  git -C "$APP" fetch --quiet origin "$sha" || { log "Не удалось скачать ${sha:0:7}"; return 1; }
  git -C "$APP" checkout --quiet --detach "$sha" || { log "Не удалось переключиться на ${sha:0:7}"; return 1; }
  [ "$(git -C "$APP" rev-parse HEAD)" = "$sha" ] || { log "На сервере не та версия кода"; return 1; }

  if docker image inspect "$IMAGE:$sha" >/dev/null 2>&1; then
    log "Образ ${sha:0:7} уже собран — беру готовый"
    docker tag "$IMAGE:$sha" "$IMAGE:latest" || return 1
    compose up -d --no-build --remove-orphans || { log "Запуск не удался"; return 1; }
  else
    compose build --pull web || { log "Сборка не удалась"; return 1; }
    docker tag "$IMAGE:latest" "$IMAGE:$sha" || return 1
    compose up -d --remove-orphans || { log "Запуск не удался"; return 1; }
  fi
}

prune_images() {
  docker image prune -f >/dev/null 2>&1 || true
  # Оставляем образы последних $KEEP_IMAGES версий — для быстрого отката
  local keep
  keep=$(tail -n "$KEEP_IMAGES" "$HISTORY" 2>/dev/null || true)
  # «|| true» в каждом звене: при pipefail пустой результат grep иначе остановил бы скрипт
  { docker image ls "$IMAGE" --format '{{.Tag}}' 2>/dev/null || true; } |
    { grep -E '^[0-9a-f]{40}$' || true; } |
    while read -r tag; do
      grep -qx "$tag" <<<"$keep" || docker image rm "$IMAGE:$tag" >/dev/null 2>&1 || true
    done
}

# Выкат версии. mode=deploy — новая версия; mode=rollback — возврат (история не растёт)
do_deploy() {
  local sha="$1" mode="$2" prev
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Нужен полный SHA коммита (40 символов)"; exit 1; }
  [ -f "$APP/.env" ] || { echo "Нет $APP/.env — сначала запустите setup-server.sh"; exit 1; }
  prev=$(current)

  if [ "$prev" = "$sha" ]; then
    log "Эта версия уже выкачена — проверяю, что всё запущено"
    compose up -d --no-build --remove-orphans || compose up -d --remove-orphans
    wait_healthy
    return 0
  fi

  log "Выкатываю ${sha:0:7} (сейчас работает: ${prev:0:7})"
  check_disk
  backup_db

  if switch_to "$sha" && wait_healthy; then
    if [ "$mode" = "deploy" ]; then echo "$sha" >> "$HISTORY"; fi
    prune_images
    log "Готово: работает ${sha:0:7}"
    return 0
  fi

  if [ -n "$prev" ]; then
    log "Версия ${sha:0:7} не поднялась — возвращаю ${prev:0:7}"
    if switch_to "$prev" && wait_healthy; then log "Возврат выполнен: работает ${prev:0:7}"; fi
  fi
  exit 1
}

deploy() { lock; do_deploy "${1:-}" deploy; }

rollback() {
  lock
  local cur target
  cur=$(current)
  target=$(tail -n 2 "$HISTORY" 2>/dev/null | head -n 1 || true)
  if [ -z "$cur" ] || [ -z "$target" ] || [ "$target" = "$cur" ]; then
    echo "Предыдущей удачной версии нет — откатывать некуда"; exit 1
  fi
  log "Откат: ${cur:0:7} → ${target:0:7}"
  do_deploy "$target" rollback
  # Плохую версию убираем из истории, чтобы повторный откат шёл дальше назад, а не обратно на неё
  echo "$cur" >> "$STATE/rolled-back"
  sed -i '$ d' "$HISTORY"
  log "Откат выполнен: работает ${target:0:7}"
}

status() {
  echo "Работает версия: $(current | cut -c1-7)"
  echo "Последние удачные выкаты (новые снизу):"
  tail -n 5 "$HISTORY" 2>/dev/null | cut -c1-7 | sed 's/^/  /' || true
  compose ps
}

mkdir -p "$STATE" "$BACKUPS" "$LOGS"
case "${1:-}" in
  deploy) deploy "${2:-}" ;;
  rollback) rollback ;;
  status) status ;;
  *) echo "Использование: deploy.sh deploy <sha> | rollback | status"; exit 1 ;;
esac
