#!/usr/bin/env python3
"""
local_agent_server.py — локальный "приёмник" для ChatGPT Local Coding Agent.

Расширение в браузере только парсит JSON-блоки с изменениями кода из ответов
ChatGPT и отправляет их сюда по HTTP. Этот скрипт сам пишет файлы на диск —
без File System Access API и без диалогов разрешений браузера.

ЗАПУСК:
    cd /путь/к/моему/проекту
    python3 local_agent_server.py

    # либо явно указать корень проекта (тогда можно запускать откуда угодно):
    python3 local_agent_server.py --root /путь/к/проекту

    # свой порт (по умолчанию 8765):
    python3 local_agent_server.py --port 8899

При старте сервер выведет в консоль ТОКЕН — его нужно один раз скопировать
в popup расширения. Токен нужен, чтобы файлы мог писать только сам плагин,
а не любой сайт, случайно постучавшийся на этот порт.

Сервер слушает только 127.0.0.1 (не 0.0.0.0) — недоступен из сети,
только с этого же компьютера.
"""

import argparse
import json
import secrets
import sys
import datetime
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description='Локальный сервер для ChatGPT Local Coding Agent')
    parser.add_argument(
        '--root', default='.',
        help='Корневая папка проекта (по умолчанию — текущая директория, откуда запущен скрипт)'
    )
    parser.add_argument('--port', type=int, default=8765, help='Порт сервера (по умолчанию 8765)')
    parser.add_argument('--token', default=None, help='Свой токен (по умолчанию генерируется случайный)')
    return parser.parse_args()


ARGS = parse_args()
PROJECT_ROOT = Path(ARGS.root).resolve()
TOKEN = ARGS.token or secrets.token_urlsafe(24)

if not PROJECT_ROOT.exists() or not PROJECT_ROOT.is_dir():
    print(f'Ошибка: папка проекта не найдена: {PROJECT_ROOT}', file=sys.stderr)
    sys.exit(1)


def safe_join(relative_path: str) -> Path:
    """
    Безопасно превращает относительный путь из JSON в абсолютный путь ВНУТРИ
    PROJECT_ROOT. Бросает ValueError, если путь пытается выбраться за пределы
    проекта (абсолютный путь, диск Windows, '..', домашний каталог и т.п.).
    Это защита от вредоносного/сбойного JSON, который бы иначе мог
    перезаписать произвольный файл на диске.
    """
    if not relative_path or not isinstance(relative_path, str):
        raise ValueError('Пустой или некорректный путь')

    normalized = relative_path.replace('\\', '/').strip()

    if normalized.startswith('/') or normalized.startswith('~'):
        raise ValueError(f'Путь должен быть относительным: {relative_path}')

    first_segment = normalized.split('/', 1)[0]
    if ':' in first_segment:  # диск Windows вроде "C:"
        raise ValueError(f'Путь должен быть относительным: {relative_path}')

    candidate = (PROJECT_ROOT / normalized).resolve()

    if not candidate.is_relative_to(PROJECT_ROOT):  # Python 3.9+
        raise ValueError(f'Путь выходит за пределы проекта: {relative_path}')

    return candidate


def write_file(relative_path: str, content: str) -> dict:
    target = safe_join(relative_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content if content is not None else '', encoding='utf-8')
    return {'path': relative_path, 'ok': True}


LOG_FILE = PROJECT_ROOT / '.local_agent.log'


def server_log(level: str, event: str, data=None):
    record = {
        'time': datetime.datetime.now().astimezone().isoformat(timespec='milliseconds'),
        'level': level,
        'event': event,
        'data': data if data is not None else {}
    }

    line = json.dumps(record, ensure_ascii=False, default=str)

    print(f'[agent-server][{level.upper()}][{event}] {line}', flush=True)

    try:
        with LOG_FILE.open('a', encoding='utf-8') as log_file:
            log_file.write(line + '\n')
    except Exception as error:
        print(f'[agent-server][ERROR][log_write_failed] {error}', flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f'[agent-server] {fmt % args}')

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        # CORS открыт для простоты локальной отладки (например, curl/браузер).
        # Само расширение эти заголовки не использует — оно обращается к
        # серверу из background service worker, у которого есть host_permissions
        # на 127.0.0.1/localhost в manifest.json, поэтому CORS для него не применяется.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Agent-Token')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()
        self.wfile.write(body)

    def _check_token(self) -> bool:
        return self.headers.get('X-Agent-Token') == TOKEN

    def do_OPTIONS(self):
        self._send_json(200, {'ok': True})

    def do_GET(self):
        server_log('debug', 'http_get', {
            'path': self.path,
            'headers': dict(self.headers)
        })

        if self.path.startswith('/health'):
            if not self._check_token():
                self._send_json(401, {'ok': False, 'error': 'Неверный токен'})
                return
            self._send_json(200, {
                'ok': True,
                'status': 'running',
                'project_root_name': PROJECT_ROOT.name,
            })
            return
        self._send_json(404, {'ok': False, 'error': 'Not found'})

    def do_POST(self):
        server_log('debug', 'http_post_received', {
            'path': self.path,
            'headers': dict(self.headers)
        })

        if not self.path.startswith('/apply') and not self.path.startswith('/log'):
            self._send_json(404, {'ok': False, 'error': 'Not found'})
            return

        if not self._check_token():
            server_log('warn', 'auth_failed', {
                'path': self.path,
                'remote': self.client_address[0]
            })
            self._send_json(401, {'ok': False, 'error': 'Неверный токен'})
            return

        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length) if length else b''

        if self.path.startswith('/log'):
            try:
                payload = json.loads(raw.decode('utf-8')) if raw else {}
                server_log(
                    str(payload.get('level', 'info')),
                    str(payload.get('event', 'client_log')),
                    payload.get('data', payload)
                )
                self._send_json(200, {'ok': True})
            except Exception as err:
                server_log('error', 'log_payload_invalid', {
                    'error': str(err),
                    'raw': raw.decode('utf-8', errors='replace')
                })
                self._send_json(400, {
                    'ok': False,
                    'error': f'Некорректный лог: {err}'
                })
            return

        try:
            payload = json.loads(raw.decode('utf-8'))
            files = payload.get('files', [])
            if not isinstance(files, list) or not files:
                raise ValueError('Пустой или некорректный список файлов')
        except Exception as err:
            server_log('error', 'apply_payload_invalid', {
                'error': str(err),
                'raw': raw.decode('utf-8', errors='replace')
            })
            self._send_json(400, {'ok': False, 'error': f'Некорректное тело запроса: {err}'})
            return

        server_log('info', 'apply_payload_received', {
            'payload': payload,
            'files_count': len(files)
        })

        results = []
        for f in files:
            action = f.get('action') if isinstance(f, dict) else None
            path = f.get('path') if isinstance(f, dict) else None
            content = f.get('content', '') if isinstance(f, dict) else None

            if action not in ('create', 'modify'):
                results.append({'path': path, 'ok': False, 'error': f'Неизвестное action: {action}'})
                continue

            try:
                result = write_file(path, content)
                results.append(result)
                print(f'[agent-server] {action}: {path} ({len(content or "")} байт)')
            except Exception as err:
                server_log('error', 'file_write_failed', {
                    'action': action,
                    'path': path,
                    'error': str(err),
                    'traceback': traceback.format_exc()
                })
                results.append({'path': path, 'ok': False, 'error': str(err)})

        server_log('info', 'apply_completed', {
            'results': results
        })

        self._send_json(200, {'ok': True, 'results': results})


def main():
    server = ThreadingHTTPServer(('127.0.0.1', ARGS.port), Handler)
    print('=' * 64)
    print('ChatGPT Local Coding Agent — локальный сервер запущен')
    print(f'Папка проекта:  {PROJECT_ROOT}')
    print(f'Адрес сервера:  http://127.0.0.1:{ARGS.port}')
    print(f'Токен доступа:  {TOKEN}')
    print()
    print('Вставьте адрес и токен в popup расширения (один раз) и нажмите')
    print('«Проверить соединение».')
    print(f'Лог:             {LOG_FILE}')
    print('Остановить сервер: Ctrl+C')
    print('=' * 64)
    server_log('info', 'server_started', {
        'project_root': str(PROJECT_ROOT),
        'port': ARGS.port
    })
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nОстановка сервера…')
        server.shutdown()


if __name__ == '__main__':
    main()
