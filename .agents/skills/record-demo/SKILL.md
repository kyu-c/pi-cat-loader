---
name: record-demo
description: Record the cat-loader demo video.
disable-model-invocation: true
compatibility: macOS with Ghostty AppleScript support, TX-02 font, pi, node, ripgrep, python3, swift, ffmpeg, and Screen Recording/Automation permissions.
---

# Record demo

Produce `~/Downloads/pi-cat-loader-demo/demo.mp4` for local review. Do not upload, modify README, or commit generated media unless asked.

## Required presentation

- Separate Ghostty instance; **TX-02 at 24pt**. Font metrics affect cat proportions; do not substitute a font or shrink text to fit.
- Compact window, approximately **847×428 points** (54 columns × 12 rows). Adjust window dimensions, not font size, if needed.
- Clean temporary Pi config; empty working directory **`~/demo/pi-cat-loader`** for a readable footer. Leave existing files untouched if that directory isn't empty. Only this repository's cat-loader extension; no personal themes, skills, prompts, context files, credentials, or model requests.
- Model: **`openai-codex/gpt-6-astra`**, medium thinking. Default cat width: 4 cells.

## Fixed scenario

1. `/cat-loader preview` — one classic cat, full five-second animation.
2. `/cat-loader color random random random` — automatically previews three random cats; do not add another preview here.
3. `/cat-loader preview` — second three-cat run, newly randomized.

Allow each preview to finish. Random duplicates are valid; never force specific colors or imply every rerun guarantees different colors.

## Workflow

Resolve `scripts/record.py` relative to this skill directory.

1. Confirm permission to open/control a separate Ghostty window and record it. Leave existing windows and personal settings untouched.
2. Run `python3 <skill-dir>/scripts/record.py prepare`. Helper brings its separate demo window forward. Keep printed state-file path.
3. Keep demo window visible during inspection; obscured Ghostty windows can produce stale screenshots. Inspect prepared window with a window-specific screenshot. Verify model footer, TX-02 font, unclipped input/footer, and square-looking animated cats. Run a preview for verification if needed, then wait for it to finish. Preparation does not record.
4. Run `python3 <skill-dir>/scripts/record.py record <state-file>`. If output already exists, ask before passing `--overwrite`.
5. Inspect extracted frames from all three runs, plus playback when possible. Check square proportions, smooth motion, single → three → three sequence, footer visibility, and absence of private desktop content. Report output path.

Helper captures **one window** using `screencapture -v -o -l <window-id>`, then exports H.264/yuv420p MP4 with fast-start. Do not substitute region capture: switching focus can expose unrelated windows. macOS may show its capture indicator in the title bar; this is normal.

Helper discovers runtime IDs; never reuse IDs from a previous recording. Raw footage and review frames remain in the temporary run directory. If permissions, font, model, terminal targeting, or image proportions fail, stop and investigate rather than silently changing requirements. Do not change extension implementation merely to make a recording work.

Close only the demo window after review if requested. Never quit all Ghostty instances or kill an existing user session.
