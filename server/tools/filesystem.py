from __future__ import annotations

from pathlib import Path

from ..security import ProjectSandbox, SecurityError

IGNORED_DIRECTORIES = {
    ".git",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".venv",
    "venv",
    "dist",
    "build",
}


def _ensure_file(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError("FILE_NOT_FOUND")
    if not path.is_file():
        raise IsADirectoryError("PATH_IS_NOT_FILE")


def read_file(sandbox: ProjectSandbox, path: str) -> dict:
    target = sandbox.resolve(path)
    _ensure_file(target)
    return {
        "path": sandbox.relative(target),
        "content": target.read_text(encoding="utf-8"),
    }


def create_file(sandbox: ProjectSandbox, path: str, content: str) -> dict:
    target = sandbox.resolve(path)
    if target.exists():
        raise FileExistsError("FILE_ALREADY_EXISTS")
    if not isinstance(content, str):
        raise ValueError("INVALID_CONTENT")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8", newline="")
    return {
        "path": sandbox.relative(target),
        "created": True,
    }


def list_files(sandbox: ProjectSandbox, path: str = ".") -> dict:
    target = sandbox.resolve(path)
    if not target.exists():
        raise FileNotFoundError("FILE_NOT_FOUND")
    if not target.is_dir():
        raise NotADirectoryError("PATH_IS_NOT_DIRECTORY")

    entries = []
    for child in sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        if child.is_dir() and child.name in IGNORED_DIRECTORIES:
            continue
        try:
            relative = sandbox.relative(child)
        except SecurityError:
            continue
        entries.append({
            "name": child.name,
            "type": "directory" if child.is_dir() else "file",
            "path": relative,
        })
    return {"path": sandbox.relative(target), "entries": entries}
