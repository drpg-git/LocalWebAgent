from pathlib import Path

import pytest

from server.security import ProjectSandbox, SecurityError


def test_relative_path_stays_inside_project(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    assert sandbox.resolve("src/main.py") == (tmp_path / "src/main.py").resolve()


@pytest.mark.parametrize("path", ["../secret.txt", "../../secret.txt", "/tmp/file", "C:/Windows/test.txt", "\\\\server\\share\\file.txt"])
def test_paths_outside_project_are_rejected(tmp_path: Path, path: str):
    sandbox = ProjectSandbox(tmp_path)
    with pytest.raises(SecurityError) as error:
        sandbox.resolve(path)
    assert error.value.code == "PATH_OUTSIDE_PROJECT"


def test_project_must_exist_and_be_directory(tmp_path: Path):
    sandbox = ProjectSandbox()
    with pytest.raises(SecurityError):
        sandbox.set_root(tmp_path / "missing")

    file_path = tmp_path / "file.txt"
    file_path.write_text("x", encoding="utf-8")
    with pytest.raises(SecurityError):
        sandbox.set_root(file_path)
