#!/usr/bin/env python3
"""Worker launcher. Owner: Sam.
Loop: register -> report capacity -> claim a task -> run it in a worktree -> report -> repeat.
Contract: ../contract/tools.json. Routing: routing.json. Config: config.json (copy config.example.json).
"""
import json
import subprocess
import sys
import time


def load_config(path="config.json"):
    with open(path) as f:
        return json.load(f)


def register(cfg):
    """TODO: register this worker with the brain."""


def report_capacity(cfg):
    """TODO: read the statusLine cache and push usage to the brain."""


def claim_task(cfg):
    """TODO: claim the next task. Return None if nothing is open."""
    return None


def make_worktree(cfg, task):
    """TODO: git worktree add <worktree_dir>/<task id> -b <branch>."""


def run_task_real(cfg, task, workdir):
    """TODO: subprocess.run(['claude', '-p', prompt, '--model', ..., '--effort', ...], cwd=workdir).
    Catch rate-limit errors and raise a RateLimited exception."""


def run_task_simulated(cfg, task):
    """TODO: timed progress events and a canned result (structured result for map tasks)."""


def report_done(cfg, task, branch, summary, result=None):
    """TODO: call complete_task."""


def main():
    cfg = load_config()
    register(cfg)
    while True:
        report_capacity(cfg)
        task = claim_task(cfg)
        if not task:
            time.sleep(cfg.get("poll_seconds", 5))
            continue
        # TODO: lock files, run (real or simulated), report, release locks, handle failures and rate limits
        time.sleep(cfg.get("poll_seconds", 5))


if __name__ == "__main__":
    sys.exit(main())
