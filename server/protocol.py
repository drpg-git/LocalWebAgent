from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ToolRequest:
    request_id: str
    tool: str
    args: dict[str, Any]


def parse_request(payload: Any) -> ToolRequest:
    if not isinstance(payload, dict):
        raise ValueError("INVALID_REQUEST")

    request_id = payload.get("request_id")
    tool = payload.get("tool")
    args = payload.get("args", {})

    if not isinstance(request_id, str) or not request_id:
        raise ValueError("INVALID_REQUEST")
    if not isinstance(tool, str) or not tool:
        raise ValueError("INVALID_REQUEST")
    if not isinstance(args, dict):
        raise ValueError("INVALID_REQUEST")

    return ToolRequest(request_id=request_id, tool=tool, args=args)


def success(request_id: str, result: Any) -> dict[str, Any]:
    return {
        "type": "tool_result",
        "request_id": request_id,
        "ok": True,
        "result": result,
    }


def failure(request_id: str, code: str, message: str) -> dict[str, Any]:
    return {
        "type": "tool_result",
        "request_id": request_id,
        "ok": False,
        "error": {
            "code": code,
            "message": message,
        },
    }
