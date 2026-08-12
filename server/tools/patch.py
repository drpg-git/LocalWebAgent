from __future__ import annotations

import os
import tempfile
from pathlib import Path

from ..security import ProjectSandbox


def _atomic_write(path: Path, content: str) -> None:
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    except Exception:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def modify_file(sandbox: ProjectSandbox, path: str, old: str, new: str) -> dict:
    target = sandbox.resolve(path)
    if not target.exists():
        raise FileNotFoundError("FILE_NOT_FOUND")
    if not target.is_file():
        raise IsADirectoryError("PATH_IS_NOT_FILE")
    if not isinstance(old, str) or not isinstance(new, str):
        raise ValueError("INVALID_PATCH")

    content = target.read_text(encoding="utf-8")
    matches = content.count(old)
    if matches == 0:
        raise LookupError("PATCH_NOT_FOUND")
    if matches > 1:
        raise LookupError("PATCH_AMBIGUOUS")

    updated = content.replace(old, new, 1)
    _atomic_write(target, updated)
    return {
        "path": sandbox.relative(target),
        "modified": True,
        "replacements": 1,
    }
