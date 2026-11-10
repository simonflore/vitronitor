# Code Review Task

Perform comprehensive code review. Be thorough but concise.

## Check For:

**Logging** - No stray console.log debugging left in
**Error Handling** - Try-catch for async, centralized handlers, helpful messages
**TypeScript** - No `any` types, proper interfaces, no @ts-ignore
**Production Readiness** - No debug statements, no TODOs, no hardcoded secrets
**React/Hooks** - Effects have cleanup, dependencies complete, no infinite loops
**Performance** - No unnecessary re-renders, expensive calcs memoized
**Security** - Auth checked, inputs validated, RLS policies in place, no keys or secrets committed
**Architecture** - Follows existing patterns, code in correct directory, writes go through the outbox, generalises to any fork

## Output Format

### ✅ Looks Good
- [Item 1]
- [Item 2]

### ⚠️ Issues Found
- **[Severity]** [[File:line](File:line)] - [Issue description]
  - Fix: [Suggested fix]

### 📊 Summary
- Files reviewed: X
- Critical issues: X
- Warnings: X

## Severity Levels
- **CRITICAL** - Security, data loss, crashes
- **HIGH** - Bugs, performance issues, bad UX
- **MEDIUM** - Code quality, maintainability
- **LOW** - Style, minor improvements
