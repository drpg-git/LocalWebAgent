from __future__ import annotations

import os
from pathlib import Path


class SecurityError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ProjectSandbox:
    """Resolves all project-relative paths while enforcing PROJECT_ROOT."""

    def __init__(self, project_root: str | Path | None = None):
        self._root: Path | None = None
        if project_root:
            self.set_root(project_root)

    @property
    def root(self) -> Path | None:
        return self._root

    def set_root(self, project_root: str | Path) -> Path:
        candidate = Path(project_root).expanduser()
        if not candidate.exists():
            raise SecurityError("PROJECT_NOT_FOUND", "Project path does not exist")
        if not candidate.is_dir():
            raise SecurityError("PROJECT_NOT_DIRECTORY", "Project path is not a directory")
        self._root = candidate.resolve()
        return self._root

    def require_root(self) -> Path:
        if self._root is None:
            raise SecurityError("PROJECT_NOT_SET", "No project has been selected")
        return self._root

    def resolve(self, relative_path: str) -> Path:
        root = self.require_root()
        if not isinstance(relative_path, str) or not relative_path.strip():
            raise SecurityError("INVALID_PATH", "Path must be a non-empty string")

        raw = relative_path.replace("\\", "/")
        candidate = Path(raw)

        if candidate.is_absolute() or os.path.isabs(raw):
            raise SecurityError("PATH_OUTSIDE_PROJECT", "Absolute paths are not allowed")
        if raw.startswith("//") or raw.startswith("\\\\"):
            raise SecurityError("PATH_OUTSIDE_PROJECT", "UNC paths are not allowed")
        if len(raw) >= 2 and raw[1] == ":":
            raise SecurityError("PATH_OUTSIDE_PROJECT", "Drive-letter paths are not allowed")

        resolved = (root / candidate).resolve(strict=False)
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise SecurityError("PATH_OUTSIDE_PROJECT", "Path is outside PROJECT_ROOT") from exc

        return resolved

    def relative(self, path: Path) -> str:
        root = self.require_root()
        resolved = path.resolve(strict=False)
        try:
            return resolved.relative_to(root).as_posix()
        except ValueError as exc:
            raise SecurityError("PATH_OUTSIDE_PROJECT", "Path is outside PROJECT_ROOT") from exc
