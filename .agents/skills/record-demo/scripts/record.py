#!/usr/bin/env python3
"""Prepare, then record the fixed cat-loader demo on macOS."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

OUTPUT = Path.home() / "Downloads/pi-cat-loader-demo/demo.mp4"
MODEL = "openai-codex/gpt-6-astra"
WORKSPACE = Path.home() / "demo/pi-cat-loader"


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def apple(script):
    return run("osascript", "-e", script)


def literal(value):
    return json.dumps(str(value))


def terminals():
    result = apple('tell application "Ghostty" to get id of every terminal')
    return set(filter(None, result.split(", ")))


def command(terminal, text, animate=False):
    target = f"terminal id {literal(terminal)}"
    if animate:
        body = f'''repeat with c in characters of {literal(text)}
input text (c as text) to {target}
delay 0.045
end repeat'''
    else:
        body = f"input text {literal(text)} to {target}"
    apple(f'''tell application "Ghostty"
{body}
delay 0.6
send key "enter" to {target}
end tell''')


def foreground(state):
    # The helper launches a separate instance. Refuse ambiguous window selection.
    apple(f'''tell application "System Events"
tell (first process whose unix id is {int(state["pid"])})
if (count of windows) is not 1 then error "Expected exactly one demo window"
set frontmost to true
perform action "AXRaise" of window 1
end tell
end tell''')
    time.sleep(0.5)


def windows(run_dir):
    script = run_dir / "windows.swift"
    if not script.exists():
        script.write_text('''import CoreGraphics
import Foundation
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
let matches = windows.filter { ($0[kCGWindowOwnerName as String] as? String) == "Ghostty" }
let data = try JSONSerialization.data(withJSONObject: matches)
print(String(data: data, encoding: .utf8)!)
''')
    return json.loads(run("swift", str(script)))


def preflight():
    if sys.platform != "darwin":
        raise RuntimeError("Recording requires macOS")
    for tool in ("ghostty", "pi", "node", "rg", "swift", "ffmpeg", "screencapture", "osascript"):
        if not shutil.which(tool):
            raise RuntimeError(f"Missing executable: {tool}")
    if "TX-02" not in run("ghostty", "+list-fonts"):
        raise RuntimeError("TX-02 is required; install it before recording")


def prepare():
    preflight()
    repo = Path(__file__).resolve().parents[4]
    if not (repo / "src/index.ts").exists():
        raise RuntimeError("Run helper from its checked-in skill location")
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    if any(WORKSPACE.iterdir()):
        raise RuntimeError(f"Demo workspace must be empty; leave existing files untouched: {WORKSPACE}")
    directory = Path(tempfile.mkdtemp(prefix="pi-cat-demo-"))
    config = directory / "config"
    config.mkdir()
    (config / "settings.json").write_text(json.dumps({
        "quietStartup": True,
        "catLoader": {"enabled": True, "sizeCells": 4,
                      "framesPerSecond": 20, "colors": ["classic"]},
    }, indent=2) + "\n")
    # Preserve executable search paths, not personal Pi configuration or credentials.
    env = {
        "HOME": str(Path.home()), "PATH": os.environ["PATH"],
        "TERM": "xterm-ghostty", "TERM_PROGRAM": "ghostty", "LANG": "en_US.UTF-8",
        "PI_CODING_AGENT_DIR": str(config), "PI_OFFLINE": "1",
        "PI_SKIP_VERSION_CHECK": "1", "PI_TELEMETRY": "0",
    }
    args = ["/usr/bin/env", "-i", *(f"{k}={v}" for k, v in env.items()),
            shutil.which("pi"), "--no-session", "--no-extensions", "-e", str(repo),
            "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
            "--no-approve", "--model", MODEL, "--thinking", "medium"]
    launcher = directory / "launch.sh"
    launcher.write_text("#!/bin/bash\nset -eu\ncd " + shlex.quote(str(WORKSPACE))
                        + "\nprintf '\\033[2J\\033[H'\nexec " + shlex.join(args) + "\n")
    launcher.chmod(0o700)
    # Query only if Ghostty is already running; don't launch a personal shell to inspect it.
    running = subprocess.run(["pgrep", "-x", "ghostty"], capture_output=True).returncode == 0
    before_terminals = terminals() if running else set()
    before_windows = {w["kCGWindowNumber"] for w in windows(directory)}
    subprocess.run(["open", "-na", "Ghostty", "--args", "--config-default-files=false",
                    "--font-family=TX-02", "--font-size=24", "--window-width=54",
                    "--window-height=12", "--window-padding-x=16", "--window-padding-y=12",
                    "--window-save-state=never", "--title=pi-cat-loader",
                    "--shell-integration=none", "-e", str(launcher)], check=True)
    time.sleep(4)
    new_terminals = terminals() - before_terminals
    new_windows = [w for w in windows(directory)
                   if w["kCGWindowNumber"] not in before_windows
                   and w.get("kCGWindowName") == "pi-cat-loader"]
    if len(new_terminals) != 1 or len(new_windows) != 1:
        raise RuntimeError(f"Ambiguous Ghostty target. Inspect demo manually; temp files: {directory}")
    state = {"terminal": new_terminals.pop(), "window": new_windows[0]["kCGWindowNumber"],
             "pid": new_windows[0]["kCGWindowOwnerPID"], "output": str(OUTPUT)}
    state_file = directory / "state.json"
    state_file.write_text(json.dumps(state, indent=2) + "\n")
    foreground(state)
    print(f"Prepared. Inspect demo window, then record with state file:\n{state_file}")


def record(state_file, overwrite):
    preflight()
    directory = state_file.resolve().parent
    state = json.loads(state_file.read_text())
    output = Path(state["output"])
    if output.exists() and not overwrite:
        raise RuntimeError(f"Output exists: {output}. Ask before using --overwrite.")
    if state["terminal"] not in terminals() or not any(
        w["kCGWindowNumber"] == state["window"] and w["kCGWindowOwnerPID"] == state["pid"]
        for w in windows(directory)
    ):
        raise RuntimeError("Demo target changed. Prepare a new recording window.")
    foreground(state)
    # Restore starting state after any inspection previews, then clear their notifications.
    command(state["terminal"], "/cat-loader color classic")
    time.sleep(5.5)
    command(state["terminal"], "/new")
    time.sleep(1)
    raw = directory / "raw.mov"
    with (directory / "capture.log").open("w") as log:
        capture = subprocess.Popen(["screencapture", "-x", "-o", "-v", f'-l{state["window"]}',
                                    "-V28", str(raw)], stdout=log, stderr=log)
        try:
            time.sleep(1.5)
            if capture.poll() is not None:
                raise RuntimeError(f"Capture failed; inspect {directory / 'capture.log'}")
            for text in ("/cat-loader preview", "/cat-loader color random random random",
                         "/cat-loader preview"):
                command(state["terminal"], text, animate=True)
                time.sleep(5.7)
            if capture.wait(timeout=15) != 0:
                raise RuntimeError(f"Capture failed; inspect {directory / 'capture.log'}")
        finally:
            if capture.poll() is None:
                capture.terminate()
                capture.wait()
    output.parent.mkdir(parents=True, exist_ok=True)
    run("ffmpeg", "-v", "error", "-y" if overwrite else "-n", "-i", str(raw), "-t", "26",
        "-vf", "fps=30", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(output))
    for second in (5, 14, 22):
        run("ffmpeg", "-v", "error", "-y", "-ss", str(second), "-i", str(output),
            "-frames:v", "1", str(directory / f"review-{second}.png"))
    print(f"Video: {output}\nInspect review-*.png and raw.mov in: {directory}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("prepare", help="Open isolated demo window; do not record")
    rec = sub.add_parser("record", help="Record prepared window and export demo.mp4")
    rec.add_argument("state", type=Path)
    rec.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    try:
        prepare() if args.action == "prepare" else record(args.state, args.overwrite)
    except (RuntimeError, subprocess.SubprocessError, OSError, ValueError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
