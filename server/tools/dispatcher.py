from __future__ import annotations

from typing import Any, Awaitable, Callable

from ..security import ProjectSandbox
from .commands import exec_command
from .filesystem import create_file, list_files, read_file
from .patch import modify_file
from .search import search_project


class ToolDispatcher:
    def __init__(self, sandbox: ProjectSandbox):
        self.sandbox = sandbox
        self.tools: dict[str, Callable[..., Any]] = {
            "read_file": read_file,
            "list_files": list_files,
            "search": search_project,
            "create": create_file,
            "modify": modify_file,
            "exec": exec_command,
        }

    async def dispatch(self, tool: str, args: dict[str, Any]) -> Any:
        handler = self.tools.get(tool)
        if handler is None:
            raise ValueError("UNKNOWN_TOOL")
        result = handler(self.sandbox, **args)
        if isinstance(result, Awaitable):
            return await result
        return result

    def available_tools(self) -> list[str]:
        return sorted(self.tools)
