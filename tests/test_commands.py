from pathlib import Path

import pytest

from server.security import ProjectSandbox
from server.tools.commands import exec_command


@pytest.mark.asyncio
async def test_allowed_command(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    result = await exec_command(sandbox, "python", ["--version"])
    assert result["returncode"] == 0
    assert "Python" in result["stdout"] or "Python" in result["stderr"]


@pytest.mark.asyncio
async def test_disallowed_command(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    with pytest.raises(PermissionError, match="COMMAND_NOT_ALLOWED"):
        await exec_command(sandbox, "powershell", ["-c", "echo forbidden"])


@pytest.mark.asyncio
async def test_shell_style_argument_is_rejected(tmp_path: Path):
    sandbox = ProjectSandbox(tmp_path)
    with pytest.raises(PermissionError, match="COMMAND_NOT_ALLOWED"):
        await exec_command(sandbox, "git", ["status", "-c", "echo forbidden"])
