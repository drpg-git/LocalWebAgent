from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path


APP_NAME = "LocalWebAgent"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def _config_dir() -> Path:
    if os.name == "nt":
        base = os.environ.get("APPDATA") or str(Path.home())
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    path = Path(base) / "LocalWebAgent"
    path.mkdir(parents=True, exist_ok=True)
    return path


CONFIG_PATH = _config_dir() / "config.json"


@dataclass
class Config:
    project_root: str | None = None
    token: str = ""
    logs_enabled: bool = False
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT

    def __post_init__(self) -> None:
        if not self.token:
            self.token = secrets.token_urlsafe(32)

    @property
    def project_path(self) -> Path | None:
        return Path(self.project_root).resolve() if self.project_root else None

    def save(self) -> None:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = CONFIG_PATH.with_suffix(".tmp")
        data = {
            "project_root": self.project_root,
            "token": self.token,
            "logs_enabled": self.logs_enabled,
            "host": self.host,
            "port": self.port,
        }
        temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
        temporary.replace(CONFIG_PATH)

    @classmethod
    def load(cls) -> "Config":
        if not CONFIG_PATH.exists():
            config = cls()
            config.save()
            return config
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            config = cls()
            config.save()
            return config
        return cls(
            project_root=data.get("project_root"),
            token=data.get("token", ""),
            logs_enabled=bool(data.get("logs_enabled", False)),
            host=str(data.get("host", DEFAULT_HOST)),
            port=int(data.get("port", DEFAULT_PORT)),
        )
