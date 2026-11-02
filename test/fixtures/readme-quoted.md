Here is the complete proposed README.md, otherwise unchanged.

````markdown
# Aorch

A durable orchestrator for CLI coding agents.

## Quick start

```sh
npm install
npm run dev
```

### Worker handoffs: `@HAND`

```
@HAND reviewer: check a.txt | expect: PASS or a list of problems | context: step-1
@HAND! coder: add the missing test | expect: the test passes
```

`@HAND <bot>: <goal>` is a read-only handoff; `@HAND!` asks for a write handoff.

**Workers can ask you: `@ASK user:`.** A worker that needs a decision ends its answer with a line in column 0:

```
@ASK user: Which database? | options: postgres; sqlite | recommended: sqlite | why: the repo has no server
```

A step can ask a step that already finished:

```
@ASK planner: why a map and not an array?
```
````

Changes by section: the intro bullets are updated.
