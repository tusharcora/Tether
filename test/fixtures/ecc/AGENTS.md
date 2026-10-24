# ECC — Agent Instructions

## Available Agents

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| planner | Implementation planning | Complex features, refactoring |
| tdd-guide | Test-driven development | New features, bug fixes |
| security-reviewer | Vulnerability detection | Before commits, sensitive code |

## Agent Orchestration

Use agents proactively without user prompt:
- Complex feature requests → **ecc:planner**
- Bug fix or new feature → **ecc:tdd-guide**
- Security-sensitive code → **ecc:security-reviewer**
- Go changes → **ecc:go-reviewer**
- Open-source release prep → **ecc:opensource-forker** → **ecc:opensource-sanitizer**

## Security Guidelines

Not routing.
