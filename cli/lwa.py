from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from server.config import Config
from server.server import LocalWebAgentServer


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lwa", description="Local Web Agent CLI")
    subparsers = parser.add_subparsers(dest="command")

    project = subparsers.add_parser("project", help="Show or change the active project")
    project.add_argument("path", nargs="?", help="Project directory")

    logs = subparsers.add_parser("logs", help="Enable or disable detailed logs")
    logs.add_argument("state", choices=("on", "off"))

    subparsers.add_parser("status", help="Show server status")
    subparsers.add_parser("help", help="Show available commands")
    return parser


def print_help() -> None:
    print("Local Web Agent")
    print()
    print("Commands:")
    print("  lwa project <path>   Set active project")
    print("  lwa project          Show active project")
    print("  lwa logs on          Enable detailed logs")
    print("  lwa logs off         Disable detailed logs")
    print("  lwa status            Show server status")
    print("  lwa help              Show this help")


def handle_project(config: Config, path: str | None) -> int:
    server = LocalWebAgentServer(config)
    if path is None:
        print(config.project_root or "Project: not set")
        return 0
    try:
        resolved = server.set_project(path)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    print(resolved)
    return 0


def handle_logs(config: Config, state: str) -> int:
    server = LocalWebAgentServer(config)
    server.set_logs(state == "on")
    print(f"Logs: {'on' if state == 'on' else 'off'}")
    return 0


async def fetch_status(config: Config) -> int:
    import aiohttp

    url = f"http://{config.host}:{config.port}/status"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=3) as response:
                data = await response.json()
    except Exception:
        print("Server: stopped or unreachable")
        print(f"Project: {config.project_root or 'not set'}")
        print(f"Logs: {'on' if config.logs_enabled else 'off'}")
        print("Extension connection: unavailable")
        return 1

    print(f"Server: {data.get('server', 'unknown')}")
    print(f"Project: {data.get('project') or 'not set'}")
    print(f"Logs: {'on' if data.get('logs') else 'off'}")
    print(f"Extension connection: {'connected' if data.get('extension_connection') else 'disconnected'}")
    print(f"Tools: {', '.join(data.get('tools', []))}")
    return 0


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    config = Config.load()

    if args.command == "project":
        return handle_project(config, args.path)
    if args.command == "logs":
        return handle_logs(config, args.state)
    if args.command == "status":
        return asyncio.run(fetch_status(config))
    if args.command == "help" or args.command is None:
        print_help()
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
