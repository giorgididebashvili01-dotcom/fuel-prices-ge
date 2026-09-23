#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  printf '\n  Node.js არ არის დაყენებული.\n  გადმოწერე: https://nodejs.org (LTS) და ხელახლა გაუშვი.\n\n'
  exit 1
fi

if [ ! -f .env ]; then
  printf '\n  პირველი გაშვება — საჭიროა Telegram ბოტის token.\n'
  printf '  @BotFather -> /newbot -> token (მაგ: 8123456789:AAH...)\n\n'
  printf '  ჩასვი token და დააჭირე Enter: '
  read -r TOKEN
  if [ -z "$TOKEN" ]; then printf '  token არ ჩაიწერა — ვწყვეტ.\n'; exit 1; fi
  {
    echo "TELEGRAM_TOKEN=$TOKEN"
    echo "PORT=8787"
    echo "HOST=0.0.0.0"
    echo "POLL_MS=5000"
    echo "ASSETS=SOL"
    echo "FIAT=GEL"
    echo "ACCESS_KEY="
    echo "COOLDOWN_MIN=15"
  } > .env
  chmod 600 .env
  printf '  .env შეიქმნა.\n\n'
fi

(command -v open >/dev/null 2>&1 && open http://localhost:8787) \
  || (command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:8787) &

exec node server.js
