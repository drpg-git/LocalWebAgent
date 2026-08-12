from pathlib import Path

import pytest

from server.security import ProjectSandbox
from server.tools.filesystem import create_file, list_files, read_file
from server.tools.search import search_project


def test_create_read_and_nested_directories(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    created = create_file(sandbox, "a/b/c/test.txt", "hello\nworld")
    assert created["created"] is True
    assert (tmp_path / "a/b/c/test.txt").exists()

    result = read_file(sandbox, "a/b/c/test.txt")
    assert result["content"] == "hello\nworld"


def test_create_existing_file_fails(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    create_file(sandbox, "test.txt", "one")
    with pytest.raises(FileExistsError):
        create_file(sandbox, "test.txt", "two")


def test_list_files_excludes_heavy_directories(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    create_file(sandbox, "main.py", "print(1)")
    (tmp_path / ".git").mkdir()
    (tmp_path / "node_modules").mkdir()

    result = list_files(sandbox)
    names = {entry["name"] for entry in result["entries"]}
    assert "main.py" in names
    assert ".git" not in names
    assert "node_modules" not in names


def test_search_returns_file_and_line(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    create_file(sandbox, "src/main.py", "one\nneedle here\nthree")
    result = search_project(sandbox, "needle")
    assert result["results"] == [{"file": "src/main.py", "line": 2, "match": "needle here"}]
