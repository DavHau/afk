"""afk_run: run a command from an eval cell and leave nothing running behind.

On timeout or interrupt, subprocess.run kills only its direct child. Anything
else the command started keeps running after the cell has given up: a shell
pipeline, a `cmd &` background job, the processes behind an ssh session. In
a long-lived kernel those orphans pile up and keep doing work nobody is
waiting for (2026-10-04: interrupted parallel-download tests most likely kept
downloading and got the host rate-limited). run() starts the command in its
own process group and kills the whole group on timeout or interrupt.
"""

from __future__ import annotations

import os
import signal
import subprocess
from collections.abc import Mapping, Sequence

__all__ = ["run"]


def run(
    cmd: str | Sequence[str],
    *,
    timeout: float = 60,
    cwd: str | os.PathLike[str] | None = None,
    input: str | None = None,
    env: Mapping[str, str] | None = None,
    check: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run `cmd` and capture stdout/stderr as text.

    cmd: argv list, or a string run by /bin/sh (pipes, globs, redirects).
    timeout: seconds. On expiry the whole process group is killed and
        subprocess.TimeoutExpired is raised, carrying the partial output.
    input: text fed to stdin. Otherwise stdin is /dev/null, so nothing
        waits on the kernel's stdin.
    check: raise subprocess.CalledProcessError on a nonzero exit.
    """
    proc = subprocess.Popen(
        cmd,
        shell=isinstance(cmd, str),
        cwd=cwd,
        env=env,
        stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        start_new_session=True,
    )
    try:
        out, err = proc.communicate(input, timeout=timeout)
    except subprocess.TimeoutExpired:
        out, err = _kill_group(proc)
        raise subprocess.TimeoutExpired(proc.args, timeout, out, err) from None
    except BaseException:
        _kill_group(proc)
        raise
    result = subprocess.CompletedProcess(proc.args, proc.returncode, out, err)
    if check:
        result.check_returncode()
    return result


def _kill_group(proc: subprocess.Popen[str]) -> tuple[str, str]:
    """Kill the process group and return whatever output was collected."""
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        return proc.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        # A process that left the group (setsid, daemonized) still holds the
        # pipes: stop reading so the cell returns instead of waiting on it.
        for stream in (proc.stdout, proc.stderr):
            if stream is not None:
                stream.close()
        proc.wait()
        return "", ""
