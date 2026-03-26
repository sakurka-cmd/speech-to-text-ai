# Speech to Text - AI Распознавание Речи

Веб-приложение для распознавания речи из аудиофайлов с использованием OpenAI Whisper.

## 🎯 Возможности

- **Распознавание речи** - преобразование аудиофайлов в текст с высокой точностью
- **OpenAI Whisper** - локальная модель без внешних API и токенов
- **Поддержка форматов** - WAV, MP3, M4A, FLAC, OGG, WebM
- **Большие файлы** - обработка файлов до 100MB через WebSocket
- **Прогресс в реальном времени** - отображение прогресса обработки
- **Мультиязычность** - автоопределение языка (включая русский)
- **Автономность** - работает без интернета после установки

## 🛠 Технологии

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Node.js WebSocket Proxy, Python FastAPI
- **AI**: OpenAI Whisper (tiny/base/small/medium/large)

## 📁 Структура проекта

```
├── src/
│   ├── app/
│   │   ├── api/transcribe/    # REST API
│   │   ├── page.tsx           # Главная страница
│   │   └── layout.tsx         # Layout приложения
│   ├── components/ui/         # UI компоненты
│   └── hooks/                 # React хуки
├── mini-services/
│   ├── asr-service/           # Node.js WebSocket прокси
│   └── whisper-service/       # Python Whisper сервис
├── docker-deploy/             # Docker файлы для деплоя
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── Dockerfile.asr-proxy
│   └── install.sh
└── public/                    # Статические файлы
```

## 🏗️ Архитектура

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Next.js Web   │────▶│   ASR Proxy     │────▶│   Whisper       │
│   (порт 3000)   │     │   (порт 3003)   │     │   (порт 5000)   │
│   UI + Upload   │     │   WebSocket     │     │   Python/FastAPI│
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 🚀 Docker Deployment

### Быстрая установка

```bash
cd /tmp
wget https://raw.githubusercontent.com/sakurka-cmd/speech-to-text-ai/main/docker-deploy/install.sh
chmod +x install.sh
sudo ./install.sh
```

### Выбор модели Whisper

| Модель | Размер | Качество | Скорость | RAM |
|--------|--------|----------|----------|-----|
| tiny | ~39MB | Низкое | Очень быстро | 1GB |
| base | ~74MB | Базовое | Быстро | 1GB |
| **small** | ~244MB | Хорошее | Средне | 2GB |
| medium | ~769MB | Высокое | Медленно | 4GB |
| large | ~1.5GB | Отличное | Очень медленно | 8GB+ |

**Рекомендуется: small** - оптимальный баланс качества и скорости.

### Порты

| Сервис | Порт | Описание |
|--------|------|----------|
| Web UI | 3010 | Веб-интерфейс |
| WebSocket | 3013 | ASR прокси |
| Whisper API | 5010 | Python сервис |

## 💻 Разработка

### Установка зависимостей

```bash
# Next.js
bun install

# ASR Proxy
cd mini-services/asr-service && bun install

# Whisper Service
cd mini-services/whisper-service && pip install -r requirements.txt
```

### Запуск в development

```bash
# Terminal 1: Whisper Service
cd mini-services/whisper-service
WHISPER_MODEL=small python main.py

# Terminal 2: ASR Proxy
cd mini-services/asr-service
bun run index.ts

# Terminal 3: Next.js
bun run dev
```

## 📖 API

### REST API (Whisper)

**POST** `/transcribe`

```bash
curl -X POST -F "file=@audio.mp3" http://localhost:5000/transcribe
```

Ответ:
```json
{
  "text": "Распознанный текст",
  "language": "ru",
  "duration": 15.4,
  "word_count": 25,
  "processing_time": 3.2
}
```

### WebSocket (ASR Proxy)

Подключение к `ws://localhost:3003`

**События:**
- `start-transcription` - начать транскрипцию
- `progress` - прогресс обработки
- `completed` - завершено
- `error` - ошибка

## 📝 Использование

1. Откройте приложение в браузере
2. Загрузите аудиофайл (перетаскиванием или через диалог)
3. Нажмите "Распознать речь"
4. Дождитесь завершения обработки
5. Скопируйте или скачайте результат

## ⚙️ Управление (Docker)

```bash
cd /srv/docker/compose/speech-to-text-ai

docker compose up -d        # Запуск
docker compose down         # Остановка
docker compose logs -f      # Логи
docker compose restart      # Перезапуск
```

## 🔄 Смена модели

Отредактируйте `docker-compose.yml`:

```yaml
whisper:
  environment:
    - WHISPER_MODEL=medium
```

Пересоберите:

```bash
docker compose build --no-cache whisper
docker compose up -d
```

## 📄 Лицензия

MIT
