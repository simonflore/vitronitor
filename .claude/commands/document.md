# Update Documentation Task

You are updating documentation after code changes.

## 1. Identify Changes
- Check git diff or recent commits for modified files
- Identify which features/modules were changed
- Note any new files, deleted files, or renamed files

## 2. Verify Current Implementation
Verify against the code, not the existing docs — docs drift, and the point of this pass is to catch that.

For each changed file:
- Read the current implementation
- Understand actual behavior (not documented behavior)
- Note any discrepancies with existing docs

## 3. Update Relevant Documentation

- **CHANGELOG.md**: Add entry under "Unreleased" section
  - Use categories: Added, Changed, Fixed, Security, Removed
  - Be concise, user-facing language

## 4. Documentation Style

Terse (grammar can go for brevity), example-led, and verified against the current code.

## 5. Ask if Uncertain

If you're unsure about intent behind a change or user-facing impact, **ask the user** - don't guess.
