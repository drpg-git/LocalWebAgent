from pathlib import Path

import pytest

from server.security import ProjectSandbox
from server.tools.filesystem import create_file
from server.tools.patch import modify_file


def test_modify_replaces_exactly_one_match(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    create_file(sandbox, "test.txt", "before\nold value\nafter\n")
    result = modify_file(sandbox, "test.txt", "old value", "new value")
    assert result["replacements"] == 1
    assert (tmp_path / "test.txt").read_text(encoding="utf-8") == "before\nnew value\nafter\n"


def test_patch_not_found_does_not_change_file(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    create_file(sandbox, "test.txt", "original")
    with pytest.raises(LookupError, match="PATCH_NOT_FOUND"):
        modify_file(sandbox, "test.txt", "missing", "new")
    assert (tmp_path / "test.txt").read_text(encoding="utf-8") == "original"


def test_patch_ambiguous_does_not_change_file(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    create_file(sandbox, "test.txt", "same\nother\nsame")
    with pytest.raises(LookupError, match="PATCH_AMBIGUOUS"):
        modify_file(sandbox, "test.txt", "same", "changed")
    assert (tmp_path / "test.txt").read_text(encoding="utf-8") == "same\nother\nsame"
