# Agent-first Tether: design

Date: 2026-11-01 · Branch: based on `feature/squads-tickets` (the newest Tether; `main` lags behind it). Prototype, approved by the owner ("looks good"): `docs/design/agent-first/prototype.html` (open it in a browser, click through the strip along the top).

## 1. Intent (owner, 2026-11-01)

The owner asked Tether's chat to finish a homework assignment in a plain folder. Tether said it could not work without git and recommended "skip Tether for this assignment and run Claude Code directly". The owner's reaction: "completely off the mark… it's literally telling us not to use the app".

What they want instead, in their words:

- Agents that are "grok bot type agents that get smarter over time" and "retain information about you and everything that you are working on, just like a hermes agent", and that "work as employees that can work on multiple projects".
- "Remove the main tether bot completely and make users create or import an agent first before they chat." A default agent called Tether may exist, but "any agent can do that tasks and everything that tether can do like assign agents, create teams, create workflows, create tickets".
- "Each agent on the sidebar should have its own chat window", with some way to "circumvent people having too many agents".
- The moment that defines success: "I type to an agent that i created that i need something done without using a git worktree but within just a file or folder and it decides/recommends what the best option is (create ticket, create workflow, create specialized team, do the task by itself)."
- "It should also be token efficient and not generate slop code or designs especially if people have limits."
- "Agents should carry over and retain information between folders and projects."
- "I would be annoyed if i had to tell an agent anything twice, but especially the main goal, steps, desired results, any other misc information."

## 2. Why Tether fails today (from the code on `feature/squads-tickets`)

1. **Chat cannot edit.** Every chat turn runs with `readOnly: true` (`src/assistant/turn.ts`, the `registry.get(agent).run` call), so the only help it can offer on a real job is to hand it elsewhere.
2. **Every run needs git.** Runs start by creating a worktree (`src/engine.ts` calling `createWorktree`, `src/git.ts`), which fails in a plain folder. Tickets can only start runs, so they fail too.
3. **Tether is special.** The main chat is a separate path: tickets are drafted only on Tether's own turn (`drafts` in `turn.ts` requires `!who`), and an @mentioned agent only answers as a guest in Tether's chat.
4. **Memory is thin.** Lessons are per agent (`src/lessons.ts`), so they could cross projects, but only squad turns read them (`teams.ts` `memory()`). One-to-one chats have none, chats are stored per project (`<home>/assistant/<workspace>/`), and the prompt keeps only the last 8 messages at 500 characters each (`src/assistant/prompt.ts`).
5. **Harness² covers less than assumed.** Evolve (`src/evolve.ts`, `src/harness.ts`) implements its method natively and is worth keeping, but it only improves an agent's instructions, from run results, with each change accepted by a person. It stores nothing about the person or their work.
6. **An agent has no chat.** Its page (`#/agents/<id>`) is a settings form. The sidebar already shows five agents and "All agents (74)".

## 3. Goals

1. A person can talk to their agent about any folder or file, git or not, and have the work done there.
2. Every agent can do everything Tether does today. Tether is an ordinary agent, shipped as the default.
3. The agent recommends the cheapest way that will work, and Tether never again tells someone to use another tool for work Tether can do.
4. Nobody has to tell an agent anything twice.
5. Agents carry what they know between folders and projects.
6. The sidebar stays small however many agents are imported.
7. Token use stays low, and output is careful.
8. Agents can answer with live, interactive interface, not only text.
9. Agents have real freedom to act once a person has agreed to it.

## 4. Non-goals

- Replacing Tickets, Squads, Runs, Workflows, Code, API, Graph, Triggers or Artifacts. They stay as places to see work, started by talking to an agent.
- Using the real Google harness2 package. Evolve keeps the method, as it does today.
- Evolve changing anything without a person's OK.
- Sharing memory between people, or syncing it off the Mac.
- A hard cap on specialists.
- Tether buying things, placing trades, or holding payment details.

## 5. Anti-goals (failure even if it technically works)

- An agent replying that the person should use Claude Code, or set up git, for work Tether can do itself. The same goes for any "I can't, because…" that a Tether feature could solve.
- Git showing up in a plain folder: no `.git`, branches or PRs, and no git words in the UI for that folder.
- Memory that makes turns expensive, by dumping everything an agent knows into every prompt.
- A sidebar that recreates the 74-agent problem under another name.
- Confident slop: an agent saying "done" without having checked the result.
- A bad edit in a plain folder that cannot be undone, with no warning first.

## 6. The design

### 6.0 Words (my calls)

- A **brief** is a long-lived piece of work, such as HW3. It has steps and can span many jobs.
- A **job** is one thing an agent does for a person: always one run underneath, a one-step run for Do it myself. It is the unit of a checkpoint, an Undo and a queue entry. "Finish question 3" is a job; a brief step can map to a job, but need not.
- The **active brief** is picked by the agent from the conversation and folder, shown in the panel beside the chat, and can be switched there.
- A **folder** picked in the composer is a Workspace. An unregistered folder is registered on first use. A subfolder of a Workspace stays in that Workspace, with the subfolder as the job's working path. The composer's folder also sets the sidebar's Workspace.
- In a plain folder, what Tether keeps today in `<folder>/.aorch/` lives under `<home>` instead, so the folder gets nothing of Tether's at all.

### 6.1 Leads and specialists (chosen from three options: mockup option B)

- **Leads** have a chat, a memory and a sidebar row. **At most five.** Tether is the default lead, and the owner may replace or demote it.
- **Specialists** are every other crew entry. They have no chat and no sidebar row. A lead calls one in for a job. Before that, a lead sees only a one-line list of what's available, so they cost almost no tokens until used.
- First run: no chat until there is a lead. Choices: Start with Tether, Create an agent, Import agents. An import of more agents than open lead slots asks which become leads, and the rest become specialists.
- Adding a sixth lead means demoting one. A demoted lead keeps its memory and can be promoted back.
- Any lead can do what Tether does: assign agents, create teams, workflows and tickets, start runs.
- The main-bot path goes away: an agent's turn and "Tether's turn" become one path. Tether's id stays `orchestrator` (`TETHER_ID`).

### 6.2 One ongoing chat per agent

- Each lead has one continuous chat across all folders, with a divider where the folder changes (prototype, Agent chat). My call: one chat per agent, not many. All chats lists history by agent and searches it.
- The composer shows which folder the agent is working in, and it can be changed there. A folder or file can also be named in a message.
- The agent's page gets two tabs, **Chat** and **Memory**. Settings move inside the page.
- Sidebar: Search, Home, Inbox, Runs; **Your agents** (3 of 5, with a live status line) and Add a lead; Squads; Workspace, with the project switcher moved into its header; Settings and the account row. Long tool lists fold into More tools.
- Home opens on the agents, what each is doing, and the queue. The New chat screen goes away.

### 6.3 The agent recommends how to do the work

On any request to do something, the reply offers the four routes with a rough cost for each and marks one as recommended: **Do it myself, Make a ticket, Workflow, Team**.

- Do it myself is the default for one job in one place. Plain questions get plain answers, with no card.
- The agent asks only for routes bigger than doing it itself. The first time, it also asks before doing it itself; a person can turn that off (my call).
- Routing happens inside the normal read-only turn, with no separate routing model. The work then continues in the same agent session where the adapter can resume one, so it doesn't re-read the files. My call: this costs one follow-up call, but a plain question never gets write access, and a checkpoint is only taken when work starts.
- This replaces "Turn asks into tickets" and the ticket card. A ticket drafted through this route uses the existing draft checks (`src/assistant/goalDraft.ts`).
- Cost estimates are rough and labelled "about". They come from past runs where there are some, otherwise from a fixed multiple of doing it alone.
- A lead can draft a team with specialists in the card, as in the prototype's Bigger job screen. My call: **Team is a one-off team run by default**, so it adds nothing to the sidebar, and the lead takes part as a worker, not only as a read-only manager. A person can choose **Keep this team** afterwards, which makes it a Squad. The New squad screen stays reachable.

### 6.4 Work in any folder, with or without git

**No git required.** Tether keeps its own hidden history outside the folder, as a git repo under `<home>` per folder, with the folder as its work tree. The folder gets no `.git`. Every run path that needs a repo uses a real repo if the folder has one, and the hidden history if it doesn't. So rewind, diffs, retries and worktrees work everywhere.

The owner rejected a plain "keep a copy of each file" approach in favor of something less visible. The hidden history is that answer, and the same approach is used by Cursor and Cline.

| The job | Where the work happens |
|---|---|
| Small solo edit | In the real folder, with a checkpoint first and one-click Undo |
| Risky or large change, or something to compare or discard | Worktree |
| Several agents at once | One worktree each, combined at the end after approval |
| Team or workflow in a plain folder | Worktree made from the hidden history, invisible to the person |

- The agent decides from the table and names the choice in its recommendation.
- **A checkpoint is taken before every job**, so changes the person made in between are preserved.
- **Undo reverses only that job's changes.** If a file it touched has changed since (by the person or a later job), Undo stops, says which files, and changes nothing until the person chooses. It never overwrites their work silently. (My call.)
- **One writer per real folder.** If a job would edit a folder another job is editing in place, it moves to a worktree or queues, whichever the agent recommends. This covers two leads and "start now". (My call.)
- **In a real git repo, a small solo edit stays uncommitted** on whatever branch is checked out, so `git status` shows it like the person's own edit. Its checkpoint lives in the hidden history, never in the repo's refs, and Undo leaves staged changes that aren't the job's alone. This is a change from today's rule that agents never touch the checkout. (My call: if it worries you, the alternative is always using a worktree in real repos.)
- A worktree from a real repo starts at the last commit, so uncommitted changes must be included first (snapshot them) or the person warned. A plain worktree would silently work from an older version.
- Finished work from a hidden worktree lands by copying changes back into the real folder, stopping to ask if a file changed in the folder meanwhile. No PR is involved. Repos with a GitHub remote keep today's Merge and Open PR paths.
- Large files and folders such as `node_modules` are left out of the history. The agent says so before changing one, because that change cannot be undone.
- A hidden worktree still needs those files to work. My call: dependencies and large files are linked in, and a job that would change one says so first. If linking won't do, the agent recommends working in place.
- The history protects only what Tether changes between checkpoints. It is not a backup of the person's own edits.
- Single files: the work tree is the file's folder, tracking only that file (my call).
- An agent's file edits go only inside the folder chosen for the job. Commands follow §6.9.

### 6.5 One job at a time, then a queue (owner's decision)

- An agent does one job at a time across all projects. Others queue, and the person sees the queue on Home, in the sidebar and above the composer. A person can reorder a queue or start a job now, which runs it alongside the current job.
- Today busy tracking is per squad (`${team.id}:${bot}` in `teams.ts`). It becomes per agent, across squads and chats.
- **Scope (my call):** the rule covers a lead's jobs from chat, tickets and squad asks, and a team waits for its lead. It does not cover saved workflows, schedules, triggers, retries or the CLI, which run as they do today, and specialists can work for two teams at once. This is a queue above the engine, not a scheduler inside it, so existing workflows can't slow down or deadlock.
- A person can still chat with a busy agent; the agent reads it when free, and answers plain questions without interrupting the job if that needs no file changes (my call).
- Tether's existing limits (optional spending caps, Auto-fix rounds) still apply.

### 6.6 Memory: never ask twice

Three layers, all per agent unless noted, all stored locally and shown on the Memory tab where they can be edited or deleted.

| Layer | What it holds | When it loads |
|---|---|---|
| **About you** | Preferences, how the person likes things done, standing facts | Every turn, in every folder |
| **Briefs** | One per job: main goal, steps with progress, desired result, anything else worth keeping | The active brief every turn. Other briefs only when the job relates to them |
| **Lessons and instructions** | Today's lessons and Evolve versions | As today, now in one-to-one chat too |

- **The brief is the heart of "never ask twice".** The agent writes and updates it from the conversation, without being asked. It sits beside the chat, replacing "Tickets · next", and the person can correct it. A correction is final: the agent never overrides it.
- Every agent working on a job reads its brief. Specialists get the brief, not the agent's whole memory.
- Memory follows the agent into every folder. Asking about another project is answered from its briefs, across folders.
- **Squads with other people are excluded (my call).** About you and briefs from other folders load only when the owner is the only person in the conversation. In a squad or Telegram group with others, an agent uses that squad's project brief and its lessons. Only the owner's own words can change memory or make a correction final, and an agent never reveals a private brief to someone else.
- Before asking the person anything, the agent checks its memory. Asking for something it already holds is a bug.
- **Size limits keep this cheap.** Each brief and About you have fixed size caps and get tidied when full, so per-turn memory cost stays flat as history grows. Exact numbers are left to the builder.
- Writing to memory must not add a model call to ordinary turns: the update comes back as part of the turn's reply (as the trailing ```tether block already does).
- Memory text is data, not instructions: fence it in every prompt (`src/fence.ts`), the same as lessons, because it can carry words from repos and other agents.
- Secrets never enter memory: run it through the same redaction as chat (`redactText`, `secretsFor`).
- Harness² stays as the **Getting better** section: suggestions from runs, applied only with the person's OK. Lessons are stored per agent already, but their prompt says "in this project"; a lesson that is really about one project should go in that project's brief instead.

### 6.7 Careful, cheap output

Written into every agent's base prompt, and checked by review where a run has one:

- Read the relevant files before changing them. Follow what's already there.
- Make the smallest change that does the job, and don't add extras that weren't asked for.
- Check the result (run the test, build or file) before saying it's done, and say plainly what wasn't checked.
- Ask only what memory and the files can't answer.
- Prefer doing it alone with a cheap model. Escalate only when the job needs it.
- Keep tool output small, using the existing pruner and spill (`src/codemode/spill.ts`).

### 6.8 Generative UI (owner, 2026-11-01)

"I want agents to be able to have generative ui": "interactive tables, charts, calendars, sports game scores and box scores, maps, dashboards, shopping items (cards with buy buttons) with links and price, stock charts with prices, candles and different time indicators. Also other integration components like mail, pull requests, databases, api client, etc."

An agent can answer with live interface in the chat, not only text.

**How it works (my calls):**

- Agents pick from a **catalog of Tether's own components** and send data, not code. The reply carries a small JSON description (in the existing trailing ```tether block) naming a component and its data. That costs far fewer tokens than writing a page, always matches the app's look, and can't produce a sloppy design.
- Tether validates each description at the boundary. Anything invalid or unknown falls back to plain text or a simple table, never a blank card.
- Components render in the chat thread, and can open larger or be pinned as a dashboard.
- HTML artifacts stay for anything the catalog can't do, and stay in their sandboxed iframe (`sandbox="allow-scripts"`).

**The catalog, first version:**

| Group | Components |
|---|---|
| Data | Interactive table (sort, filter, search), chart (line, bar, area, pie), dashboard (a layout of other components) |
| Life | Calendar, map, shopping cards (image, price, link, buy button) |
| Sports | Scoreboard, box score |
| Markets | Stock chart: price, candles, time ranges, indicators |
| Integrations | Mail, pull request, database table and query, API request and response |

**Rules:**

- **Local actions cost no tokens.** Sorting, filtering, zooming and changing a time range happen in the browser or the local server, with no model call. Only an action that needs the agent's judgment goes back to it, as a structured message.
- **Live data refreshes without the model.** A component can name a data source (a connector, a saved API request, a query), and Tether refreshes it directly, on a sensible interval.
- **Real data only.** A price, score, quote or date must come from a named source, and the component shows that source and when it was fetched. Without a source, the agent says so rather than making one up. Data comes from scraping, web search, connectors (MCP) and the API client.
- **Agents can scrape the web and rebuild it as a clean component** (owner's decision: "scrape it from the internet and rebuild a clean interface"). An agent gives a page and the fields it wants, and the result renders through the catalog.
- **Crawlee is the scraper (owner's decision, 2026-11-02, replacing Firecrawl).** It is Apache-2.0, TypeScript, and runs inside Tether's local server with no Docker or separate service. It fetches over plain HTTP first and uses a browser only when a page needs one. Add its notice to `THIRD_PARTY_NOTICES.md`, and check the licenses of what it pulls in when it is installed. The npm release 3.18.2 asks for Node 16 or newer, while the repo's next version asks for 22.13, so confirm the chosen version runs on the Node inside packaged Tether.app.
- **Extraction costs one model call, then none.** The first time, a cheap model works out selectors for the fields, and Tether saves them as the component's data source. Refreshes reuse the selectors with no model call. If they stop matching, the component shows the last good data with its time, and the agent repairs them once.
- Scraped text is untrusted: fence it and never treat it as instructions. A page that breaks or changes shape shows the last good data with its time, never guesses. Sites can forbid scraping, so Tether fetches only what a person asked for, at a modest refresh rate, with no logins and no bypassing of paywalls or blocks. Crawlee's anti-blocking features stay off.
- **Data arrives through the local server, never the browser**, matching the roadmap's rule that the browser never sees secrets. The app's content policy (`src/app/main.ts`) currently blocks outside connections and images, so remote images and map tiles need a deliberate change: serve them through the local server, or allow them narrowly.
- **Buy buttons open the seller's page in the browser.** Tether never buys anything, holds no card details, and fills in no checkout. Prices show when they were fetched.
- **Actions with outside effects always confirm:** sending mail, merging a PR, changing a database, sending a non-GET request. Each shows exactly what will happen, whatever §6.9 allows, and uses the existing approval card.
- Everything in a component is untrusted data: it is shown as data, never run as code, and links are checked as links.
- Stock views are information, not advice. Agents don't place trades.

There are no chart, map or calendar libraries in the project today. Picking them is left to the builder, with a preference for one well-kept library per job.

### 6.9 Commands: freedom after a first agreement (owner, 2026-11-01)

"An agent should have more freedom, but after an initial notice or agreement."

- **The first time any agent works in a folder, Tether asks "Trust this folder?"** (owner's decision). The notice says agents may run commands there, that Undo restores files but can't reverse everything a command does, what still asks, and that a downloaded project's files can try to steer an agent. Yes lasts for that folder and every agent, and can be withdrawn in Settings. (My call: per folder, so trusting homework doesn't cover a work repo.)
- After agreeing, the agent runs tests, builds, installs and other ordinary commands without asking, and shows them in the chat as they run.
- **These always ask, agreement or not:** anything acting outside the folder; deleting or overwriting outside what a checkpoint covers; `sudo` and system settings; `git push`, merges and history rewrites; anything that publishes, sends or spends. (My call, kept as a short list so freedom stays real.)
- Today's Evolve rule stands: `evolve` and `harness … rollback` commands ask every time.
- **Every model gets commands.** The OpenAI-compatible adapter behind OpenRouter and NVIDIA has no shell tool by design (`src/adapters/openai.ts`: "tests run in gate steps, outside the model's control"). That was a safety choice, not a limit of those models. Add a `run_command` tool to its tool loop, offered only in trusted folders and under these same rules. Its Code Mode path needs the same ability. Claude's adapter needs Bash allowed for these jobs. A model that handles tools badly says "not checked" instead of guessing.
- In an untrusted folder, nothing runs and the agent says "not checked".
- The "Trust this folder?" notice is the owner's chosen answer to hostile projects. The always-ask list matches commands, so it is a safeguard against mistakes, not a sandbox. Real sandboxing stays a later port (the macOS Seatbelt sandbox, in the handoff).

## 7. Migration (existing homes)

- Back up before migrating, and make the migration safe to re-run. It must not lose chats, runs, tickets, squads, lessons or Evolve versions.
- Existing Tether chats become Tether's history. Their folder is kept, so dividers work. Each old chat stays readable as its own entry in All chats (my call: don't merge old chats into one thread).
- Leads after migration: Tether, plus the agents in the person's squads that were used most, up to five in total. Everything else becomes a specialist. Squad membership is not changed: a specialist can stay in a squad and answer when @mentioned there. (My call: the owner can change leads afterwards.)
- Existing tickets and runs keep working. The old project switcher's choice becomes the Workspace choice.

## 8. Order of work (my suggestion)

1. **Work anywhere:** hidden history, checkpoints, Undo, worktrees from it. This fixes the HW3 failure on its own.
2. **Any agent can do it:** one turn path, edits from chat via Do it myself, the recommendation card.
3. **Memory:** About you, briefs, one-to-one lessons.
4. **Agent-first shell:** leads and specialists, per-agent chat, Home, sidebar, first run, migration.
5. **Queue across projects.**
6. **Generative UI:** the catalog's plumbing and data components first (table, chart, dashboard), then life and sports, markets, and integrations.

Commands (§6.9) ship with step 2, since Do it myself needs them to check its work.

Each step ships on its own. Each should get its own plan.

## 9. Left to the builder

Exact memory size caps, the tidy-up method, how related briefs are picked, the layout of data on disk, how a lead calls a specialist (`@ASK`-style consults in `src/consult.ts` are read-only and only reach finished steps, so hand-offs are the likelier base), the TUI and CLI wording, tests, and doc updates (README, `docs/HANDOFF.md`).

## 10. How to check it

Start from the prototype, then in the real app on a copy of a home folder:

- The HW3 moment: in a plain folder with no git, ask an agent to finish a task. It recommends doing it itself, edits the file, shows the changes, and Undo restores it exactly. The folder has no `.git` afterwards.
- A team in a plain folder completes and lands its work.
- A worktree job on a repo with uncommitted changes includes them.
- State a goal to an agent in one folder, restart Tether, and ask from another folder: it knows the goal and doesn't ask.
- Import 40 agents: the sidebar doesn't grow.
- Send a second job to a busy agent, from a different project: it queues and starts by itself.
- Compare token use for a turn with full memory against one with none: the difference stays within the cap.
- `grep` the prompts for any path that can still recommend another tool.
- First job in a new folder shows "Trust this folder?" once, for every agent. After Yes, a test run needs no approval on Claude, OpenRouter and NVIDIA alike, and `git push` still asks. After No, nothing runs.
- Ask for a table from a public page: it renders with its source, and refreshing makes no model call. Break the saved selectors: the last good data shows with its time, and the agent repairs them once.
- Ask for a table, a stock chart and shopping results. Each renders as a catalog component with its source shown. Sorting and changing the time range make no model call. An invalid component falls back to text. A buy button only opens the seller's page.
- Ask for a price with no data source connected: the agent says it can't get it and invents nothing.
- Mail and a PR merge show a confirmation before anything happens.
