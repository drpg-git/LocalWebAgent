from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from aiohttp import web

from .auth import AuthenticationError, verify_token
from .config import Config
from .connection import ConnectionManager
from .protocol import failure, success
from .security import ProjectSandbox, SecurityError
from .tools.dispatcher import ToolDispatcher


class LocalWebAgentServer:
    def __init__(self, config: Config | None = None) -> None:
        self.config = config or Config.load()
        self.sandbox = ProjectSandbox(self.config.project_root)
        self.dispatcher = ToolDispatcher(self.sandbox)
        self.connections = ConnectionManager()
        self.logger = logging.getLogger("lwa")
        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None

    def _configure_logging(self) -> None:
        level = logging.DEBUG if self.config.logs_enabled else logging.INFO
        logging.basicConfig(
            level=level,
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )

    def set_project(self, path: str) -> str:
        resolved = self.sandbox.set_root(path)
        self.config.project_root = str(resolved)
        self.config.save()
        self.logger.info("project changed to %s", resolved)
        return str(resolved)

    def set_logs(self, enabled: bool) -> None:
        self.config.logs_enabled = enabled
        self.config.save()
        self._configure_logging()

    async def start(self) -> None:
        self._configure_logging()
        app = web.Application()
        app.router.add_get("/", self.handle_status)
        app.router.add_get("/status", self.handle_status)
        app.router.add_get("/ws", self.handle_websocket)

        self._runner = web.AppRunner(app)
        await self._runner.setup()
        self._site = web.TCPSite(self._runner, self.config.host, self.config.port)
        await self._site.start()
        self.logger.info("Local Web Agent listening on http://%s:%s", self.config.host, self.config.port)

    async def stop(self) -> None:
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None
            self._site = None

    async def handle_status(self, request: web.Request) -> web.Response:
        return web.json_response({
            "server": "running",
            "project": self.config.project_root,
            "logs": self.config.logs_enabled,
            "extension_connection": self.connections.connected,
            "connections": self.connections.count,
            "tools": self.dispatcher.available_tools(),
        })

    def _token_from_request(self, request: web.Request) -> str | None:
        authorization = request.headers.get("Authorization", "")
        if authorization.startswith("Bearer "):
            return authorization[7:]
        return request.query.get("token")

    async def handle_websocket(self, request: web.Request) -> web.StreamResponse:
        try:
            verify_token(self.config.token, self._token_from_request(request))
        except AuthenticationError:
            return web.json_response({"ok": False, "error": "UNAUTHORIZED"}, status=401)

        websocket = web.WebSocketResponse(heartbeat=30)
        await websocket.prepare(request)
        await self.connections.add(websocket)

        try:
            async for message in websocket:
                if message.type == web.WSMsgType.TEXT:
                    await self.handle_message(websocket, message.data)
                elif message.type == web.WSMsgType.ERROR:
                    self.logger.error("websocket error: %s", websocket.exception())
        finally:
            await self.connections.remove(websocket)

        return websocket

    async def handle_message(self, websocket: web.WebSocketResponse, raw: str) -> None:
        try:
            payload: Any = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.send_json(failure("", "INVALID_REQUEST", "Request must be valid JSON"))
            return

        request_id = payload.get("request_id", "") if isinstance(payload, dict) else ""
        try:
            if not isinstance(payload, dict):
                raise ValueError("INVALID_REQUEST")
            request_id = payload.get("request_id", "")
            tool = payload.get("tool")
            args = payload.get("args", {})
            if not isinstance(request_id, str) or not request_id:
                raise ValueError("INVALID_REQUEST")
            if not isinstance(tool, str) or not tool:
                raise ValueError("INVALID_REQUEST")
            if not isinstance(args, dict):
                raise ValueError("INVALID_REQUEST")

            self.logger.info("request_id=%s tool=%s", request_id, tool)
            result = await self.dispatcher.dispatch(tool, args)
            await websocket.send_json(success(request_id, result))
            self.logger.info("request_id=%s status=success", request_id)
        except SecurityError as exc:
            self.logger.warning("request_id=%s security=%s", request_id, exc.code)
            await websocket.send_json(failure(request_id, exc.code, exc.message))
        except FileNotFoundError as exc:
            code = str(exc) or "FILE_NOT_FOUND"
            await websocket.send_json(failure(request_id, code, code))
        except FileExistsError as exc:
            code = str(exc) or "FILE_ALREADY_EXISTS"
            await websocket.send_json(failure(request_id, code, code))
        except IsADirectoryError as exc:
            code = str(exc) or "PATH_IS_NOT_FILE"
            await websocket.send_json(failure(request_id, code, code))
        except NotADirectoryError as exc:
            code = str(exc) or "PATH_IS_NOT_DIRECTORY"
            await websocket.send_json(failure(request_id, code, code))
        except LookupError as exc:
            code = str(exc) or "PATCH_NOT_FOUND"
            await websocket.send_json(failure(request_id, code, code))
        except PermissionError as exc:
            code = str(exc) or "COMMAND_NOT_ALLOWED"
            await websocket.send_json(failure(request_id, code, code))
        except TimeoutError as exc:
            code = str(exc) or "COMMAND_TIMEOUT"
            await websocket.send_json(failure(request_id, code, code))
        except (ValueError, TypeError) as exc:
            code = str(exc) or "INVALID_REQUEST"
            await websocket.send_json(failure(request_id, code, code))
        except RuntimeError as exc:
            code = str(exc) or "COMMAND_FAILED"
            await websocket.send_json(failure(request_id, code, code))
        except Exception:
            self.logger.exception("request failed: %s", request_id)
            await websocket.send_json(failure(request_id, "INTERNAL_ERROR", "Internal server error"))


async def run_server() -> None:
    server = LocalWebAgentServer()
    await server.start()
    try:
        await asyncio.Event().wait()
    finally:
        await server.stop()


if __name__ == "__main__":
    asyncio.run(run_server())
