from __future__ import annotations

import asyncio
import json
import logging
from typing import Any


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[Any] = set()
        self._lock = asyncio.Lock()
        self.logger = logging.getLogger("lwa.connection")

    async def add(self, websocket: Any) -> None:
        async with self._lock:
            self._connections.add(websocket)
        self.logger.info("extension connected")

    async def remove(self, websocket: Any) -> None:
        async with self._lock:
            self._connections.discard(websocket)
        self.logger.info("extension disconnected")

    async def broadcast(self, message: dict[str, Any]) -> None:
        payload = json.dumps(message, ensure_ascii=False)
        async with self._lock:
            connections = list(self._connections)
        if not connections:
            return
        results = await asyncio.gather(
            *(connection.send(payload) for connection in connections),
            return_exceptions=True,
        )
        failed = [
            connection
            for connection, result in zip(connections, results)
            if isinstance(result, Exception)
        ]
        if failed:
            async with self._lock:
                for connection in failed:
                    self._connections.discard(connection)

    @property
    def connected(self) -> bool:
        return bool(self._connections)

    @property
    def count(self) -> int:
        return len(self._connections)
