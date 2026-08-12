from __future__ import annotations

from pathlib import Path

from ..security import ProjectSandbox
from .filesystem import IGNORED_DIRECTORIES


def search_project(sandbox: ProjectSandbox, query: str, path: str = ".", max_results: int = 200) -> dict:
    if not isinstance(query, str) or not query:
        raise ValueError("INVALID_SEARCH")
    if max_results < 1 or max_results > 5000:
        raise ValueError("INVALID_MAX_RESULTS")

    root = sandbox.resolve(path)
    if not root.exists():
        raise FileNotFoundError("FILE_NOT_FOUND")

    files = [root] if root.is_file() else _walk(root)
    results = []
    for file_path in files:
        if len(results) >= max_results:
            break
        try:
            text = file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if query in line:
                results.append({
                    "file": sandbox.relative(file_path),
                    "line": line_number,
                    "match": line,
                })
                if len(results) >= max_results:
                    break

    return {
        "query": query,
        "results": results,
        "truncated": len(results) >= max_results,
    }


def _walk(root: Path):
    for current, directories, filenames in __import__("os").walk(root):
        directories[:] = [name for name in directories if name not in IGNORED_DIRECTORIES]
        for filename in filenames:
            yield Path(current) / filename
