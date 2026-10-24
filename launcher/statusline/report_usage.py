#!/usr/bin/env python3
"""Claude Code statusLine command. Owner: Sam.
Reads the JSON Claude Code passes on stdin, writes usage numbers to a local cache file,
and prints a short status line. A separate step pushes the cache to the brain.
TODO: check which fields the statusLine JSON contains on your Claude Code version.
Configure it in settings with:
  {"statusLine": {"type": "command", "command": "python3 /path/to/report_usage.py"}}
"""
import json
import os
import sys
import time

CACHE = os.path.expanduser("~/.claude/team-brain-usage.json")


def main():
    data = json.load(sys.stdin)
    # TODO: pull the 5-hour and weekly usage numbers out of `data` if they are present.
    out = {"updated_at": time.time(), "raw": data}
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w") as f:
        json.dump(out, f)
    print("team-brain")


if __name__ == "__main__":
    main()
