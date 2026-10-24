#!/usr/bin/env python3
"""PreToolUse hook: block edits to files locked by another task.
TODO(Omar): verify the hook input format and exit-code behavior in the Claude Code hooks docs.
"""
import json
import sys


def lookup_lock(path):
    """Return {'task_id': ..., 'worker_id': ...} if another task holds this path, else None.
    TODO: ask the brain (for example through a local endpoint exposed by the MCP server)."""
    return None


def main():
    event = json.load(sys.stdin)
    path = (event.get("tool_input") or {}).get("file_path")
    if not path:
        return 0
    held = lookup_lock(path)
    if held:
        print(f"Blocked: {path} is locked by task {held['task_id']}. Report as blocked and wait.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
