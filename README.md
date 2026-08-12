# Local Web Agent

Local Web Agent (LWA) — локальный мост между AI coding assistant, Chrome Extension и проектом пользователя.

```text
ChatGPT
   ↕
Chrome Extension
   ↕ WebSocket
LWA Server
   ↕
Project
```

## Основная идея

Server — единственный компонент, который непосредственно работает с локальной файловой системой.

Extension соединяет ChatGPT с локальным сервером. Tool results не отправляются в ChatGPT автоматически в базовом режиме. Вместо этого Extension вставляет результат в composer текущего conversation, где пользователь может его проверить и изменить.

```text
Tool request
   ↓
Extension
   ↓ WebSocket
LWA Server
   ↓
Local tool
   ↓
LWA Server
   ↓ WebSocket
Extension
   ↓
ChatGPT composer
   ↓
User
   ↓
Дальше / Enter
   ↓
ChatGPT
```

## Структура

```text
LocalWebAgent/
├── server/
│   ├── server.py
│   ├── config.py
│   ├── auth.py
│   ├── security.py
│   ├── protocol.py
│   ├── connection.py
│   └── tools/
├── cli/
│   └── lwa.py
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html
│   ├── popup.js
│   └── styles.css
├── tests/
├── SP.md
├── README.md
└── requirements.txt
```

## Установка

Создай виртуальное окружение и установи зависимости:

```text
python -m venv .venv
python -m pip install -r requirements.txt
```

Запусти сервер:

```text
python -m server.server
```

Сервер по умолчанию слушает только `127.0.0.1:8765`.

## Выбор проекта

```text
python -m cli.lwa project C:/Projects/Test
python -m cli.lwa project
```

Активный `PROJECT_ROOT` сохраняется вне проекта и восстанавливается после перезапуска.

## CLI

```text
lwa project <path>
lwa project
lwa logs on
lwa logs off
lwa status
lwa help
```

В текущей реализации CLI можно запускать через `python -m cli.lwa`. Для глобальной команды `lwa` можно добавить launcher в окружение пользователя.

## Безопасность

Все filesystem operations проходят через единый sandbox.

Разрешаются только относительные пути внутри `PROJECT_ROOT`. После нормализации пути проверяется его resolved location. Абсолютные пути, drive letters, UNC paths и выход через `..` запрещены.

Server по умолчанию доступен только через localhost и требует token для WebSocket connection.

`exec` не является shell. Он использует структурированные аргументы и allowlist разрешённых executable/subcommands.

## Tools

Доступны:

```text
read_file
list_files
search
create
modify
exec
```

`modify` использует exact-match patch и отказывается менять файл, если `old` не найден или найден больше одного раза.

## Extension

В Chrome открой страницу расширений, включи Developer mode и загрузи каталог `extension/` через Load unpacked.

Открой popup расширения и укажи token из конфигурации LWA.

После подключения открой ChatGPT.

Extension поддерживает reconnect при разрыве WebSocket и связывает request/result с исходной вкладкой.

## Manual continuation

Результат операции имеет вид:

```text
[LOCAL WEB AGENT RESULT]
request_id: ...
tool: read_file
status: success

...
[/LOCAL WEB AGENT RESULT]

Дальше
```

Результат вставляется в composer, а не отправляется автоматически. Пользователь может удалить результат, изменить его или добавить собственную инструкцию.

Это основной режим LWA.

## Тесты

Запусти:

```text
pytest
```

Тесты покрывают project sandbox, filesystem, search, create, patch semantics, allowlisted exec и protocol.

## SP.md

`SP.md` — system prompt непосредственно для AI, использующего LWA. Это не developer documentation: он описывает доступные инструменты, ограничения и рекомендуемый coding workflow.
