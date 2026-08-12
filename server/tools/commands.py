from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass

from ..security import ProjectSandbox


@dataclass(frozen=True)
class CommandSpec:
    executable: str
    subcommands: frozenset[str] | None = None


ALLOWED_COMMANDS = {
    "git": CommandSpec("git", frozenset({"status", "diff", "log"})),
    "dir": CommandSpec("dir"),
    "tree": CommandSpec("tree"),
    "where": CommandSpec("where"),
    "python": CommandSpec("python"),
    "node": CommandSpec("node"),
    "npm": CommandSpec("npm"),
}


def _validate(command: str, args: list[str]) -> None:
    spec = ALLOWED_COMMANDS.get(command)
    if spec is None:
        raise PermissionError("COMMAND_NOT_ALLOWED")
    if not all(isinstance(arg, str) and "\x00" not in arg for arg in args):
        raise ValueError("INVALID_COMMAND_ARGUMENTS")
    if spec.subcommands is not None:
        if not args or args[0] not in spec.subcommands:
            raise PermissionError("COMMAND_NOT_ALLOWED")
    for arg in args:
        if arg in {"/c", "/C", "-c", "--command", "--exec"}:
            raise PermissionError("COMMAND_NOT_ALLOWED")


async def exec_command(
    sandbox: ProjectSandbox,
    command: str,
    args: list[str] | None = None,
    timeout: float = 15.0,
) -> dict:
    root = sandbox.require_root()
    args = args or []
    _validate(command, args)
    if timeout <= 0 or timeout > 120:
        raise ValueError("INVALID_TIMEOUT")

    executable = ALLOWED_COMMANDS[command].executable
    try:
        process = await asyncio.create_subprocess_exec(
            executable,
            *args,
            cwd=str(root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_safe_environment(),
        )
    except FileNotFoundError as exc:
        raise RuntimeError("COMMAND_NOT_FOUND") from exc
    except OSError as exc:
        raise RuntimeError("COMMAND_FAILED") from exc

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        raise TimeoutError("COMMAND_TIMEOUT")

    return {
        "command": command,
        "args": args,
        "returncode": process.returncode,
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
    }


def _safe_environment() -> dict[str, str]:
    allowed = {"PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE"}
    return {key: value for key, value in os.environ.items() if key in allowed}
