# Active Task
- Skill: /ef-fix
- Skill file: .claude/skills/ef-fix/SKILL.md
- Bug: macOS Tauri: 1) traffic lights not showing, 2) app border radius is square instead of rounded
- Current step: Step 4: Fix the Bug
- Waiting for: nothing

## Completed
- [x] Step 1: Context read
- [x] Step 2: Investigate & reproduce
- [x] Step 3: Regression test (skipped — visual/platform bug, no E2E on macOS)
- [ ] Step 4: Fix the bug
- [ ] Step 5: Full regression
- [ ] Step 6: Update memory

## Key Artifacts
- Root cause: window-state plugin can restore decorations state overriding overlay titlebar; missing macOS corner radius CSS
