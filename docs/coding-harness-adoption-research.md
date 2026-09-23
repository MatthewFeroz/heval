# Coding harness adoption evidence

Research date: 2026-09-22. Scope: primary-source surveys, vendor user disclosures, official GitHub metadata, and npm download counts. These measure overlapping products and populations, so they do not establish an exact worldwide CLI ranking.

## Conclusion and selection

The strongest public evidence supports Claude Code, GitHub Copilot, Codex, and Cursor as the broad-adoption leaders. The exact order changes across surveys. OpenCode and Antigravity also have current, comparable workplace-adoption evidence. The public data does not support an exact worldwide top-ten ranking of CLI harnesses.

For Heval, select two explicit groups rather than manufacture a combined popularity score:

- Broad-adoption coverage: Claude Code, Copilot, Codex, Cursor, OpenCode, Antigravity. Consider Junie for IDE coverage, but do not attribute the combined JetBrains adoption statistic to Junie alone.
- Open-harness coverage: Cline, Pi, DeepSeek Harness. Their evidence supports inclusion, but does not establish their position against the first group by active developers. Retain Gemini CLI as a separate technical treatment only if its continuing API/enterprise implementation is relevant; document its relationship to Antigravity.

This gives nine primary research candidates, or ten with Gemini CLI. It is a benchmark-selection recommendation, not a claimed top-ten user ranking. Model-route and unattended Linux compatibility remain separate admission tests. Deep Agents, Factory Droid, and Grok Build can remain additional research candidates; the evidence reviewed here does not establish that they outrank the missing Copilot, Cline, or Google entries.

No benchmark configuration was changed during this research.

## Best comparable survey

JetBrains surveyed more than 15,000 professional developers in May through July 2026. It used regional quotas, eight languages, and weighting for region, employment, language, and familiarity with JetBrains. Reported workplace adoption:

| Product | Adoption |
| --- | ---: |
| Claude Code | 39% |
| GitHub Copilot | 21% |
| Codex | 16% |
| Cursor | 12% |
| JetBrains AI in IDEs and/or Junie | 9% |
| OpenCode | 7% |
| Antigravity | 6% |

These are product-level measures; Junie's figure combines products. JetBrains is itself a coding-tool vendor. Its broad, weighted sample is useful, but survey responses are not verified usage logs. [Source and methodology](https://blog.jetbrains.com/research/2026/08/ai-coding-agent-adoption-2026/)

## Independent cross-check

Stack Overflow's late-April 2026 pulse surveyed 1,100 developers and working professionals. For code assistants used in the preceding six months, it reported Copilot 61%, Claude Code 51%, Codex 20%, and Cursor 20%. The article does not provide a per-question response count for that comparison. Its population and question differ from JetBrains, so do not average the percentages or interpret the discrepancy as a measured change in market share. Both support a leading group of the same four products. [Source](https://stackoverflow.blog/2026/05/27/agents-on-a-leash-agentic-ai-remains-mostly-monitored-at-work/)

## User counts: corroboration, not a ranking

| Product | Primary disclosure | Limitation |
| --- | --- | --- |
| Codex | More than 5 million weekly active users, June 2, 2026 | Whole product, not CLI-only; roughly 20% are knowledge workers |
| GitHub Copilot | 50 million users, FY2026 Q4 earnings call | No active-user time window in this statement; whole Copilot product |
| Claude Code | Weekly active users doubled since January 1, reported February 12, 2026 | Growth rate without an absolute total cannot rank it by users |
| Gemini CLI | Community of millions of users, May 19, 2026 | No active-user interval or exact count |
| Windsurf | Hundreds of thousands of daily active users, July 14, 2025 | Older disclosure; IDE usage, not a terminal CLI |

Sources: [OpenAI](https://openai.com/index/codex-for-knowledge-work/), [Microsoft earnings](https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q4), [Anthropic](https://www.anthropic.com/news/anthropic-raises-30-billion-series-g-funding-380-billion-post-money-valuation), [Google](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/), [Cognition](https://cognition.com/blog/windsurf).

No absolute active-user figure for Cursor or Factory Droid was verified in this research. That is a missing metric, not evidence of low adoption. Factory describes per-customer daily/weekly/monthly analytics, but its example API response is not a global user count. [Factory analytics](https://factory.ai/news/factory-analytics)

## Google naming affects the candidate list

Google launched Antigravity CLI on May 19, 2026 and encouraged Gemini CLI users to migrate. Consumer Gemini CLI and Code Assist access ended June 18 for the specified consumer plans; enterprise licenses and paid API-key access remain supported. Antigravity CLI shares the agent implementation used by Antigravity 2.0. Avoid blindly counting Gemini CLI and Antigravity as independent current consumer markets. [Google announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)

## Implication for the benchmark

A defensible broad-adoption core is Claude Code, GitHub Copilot, Codex, and Cursor. OpenCode and Antigravity have additional current survey support. Include Junie separately if testing its actual agent, while labeling the adoption figure as the combined JetBrains category. Windsurf is relevant for editor coverage but the user disclosure here is older.

A terminal benchmark with DeepSeek through Merge Gateway needs a second selection criterion: verified support for that exact external model route in unattended Linux execution. Product popularity alone does not establish that compatibility. Keep research candidates and validated runnable candidates separate. Pi and DeepSeek Harness may be valuable open-source candidates, but these surveys do not establish their relative active-user scale.

For future updates, retain measurement dates and denominators, prefer active-user telemetry or well-described adoption surveys, and use stars/downloads as secondary evidence. Do not combine lifetime accounts, weekly actives, paid seats, package downloads, and stars into a numerical popularity score without a defensible statistical model.

## Additional survey cross-check

The Pragmatic Engineer surveyed 900+ readers between January 27 and February 17, 2026. Its coding-product order was Claude Code, Copilot, Cursor, Codex, Gemini CLI, OpenCode, Antigravity, Junie, followed by other editors and agents. This is a self-selected newsletter audience, not a population-weighted world ranking; it corroborates the leading products and shows Gemini CLI deserved consideration in the earlier shortlist. [Original survey](https://newsletter.pragmaticengineer.com/p/ai-tooling-2026)

## Open-source and distribution evidence

GitHub counts were fetched directly with the repository API on September 22, 2026. npm counts use the fixed, completed week September 14–20, 2026. These are downloads, not distinct installations or active people. Updates, CI, dependency installation, SDK embedding, multiple computers, and alternate native installers prevent conversion to user counts. Package migration is another confounder: do not add the current and legacy Pi package totals and call the sum unique users.

| Project | GitHub stars | npm downloads, Sep 14–20 | Package |
| --- | ---: | ---: | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 232,588 | [353,089](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/@deepseek-ai/dsh) | @deepseek-ai/dsh |
| [OpenCode](https://github.com/anomalyco/opencode) | 209,207 | [1,743,930](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/opencode-ai) | opencode-ai |
| [Claude Code](https://github.com/anthropics/claude-code) | 147,504 | [9,211,672](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/@anthropic-ai/claude-code) | @anthropic-ai/claude-code |
| [Codex](https://github.com/openai/codex) | 125,811 | [15,057,834](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/@openai/codex) | @openai/codex |
| [Pi](https://github.com/earendil-works/pi) | 108,231 | [1,759,541](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/@earendil-works/pi-coding-agent) | @earendil-works/pi-coding-agent |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | 107,128 | [288,798](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/@google/gemini-cli) | @google/gemini-cli |
| [OpenHands](https://github.com/OpenHands/OpenHands) | 88,763 | Not measured | Not measured |
| [Cline](https://github.com/cline/cline) | 68,999 | [40,310](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/cline) | cline |
| [Goose](https://github.com/aaif-goose/goose) | 54,542 | Not measured | Not measured |
| [Aider](https://github.com/Aider-AI/aider) | 49,108 | Not measured | Not measured |
| [Continue](https://github.com/continuedev/continue) | 35,981 | Not measured | Not measured |
| [Deep Agents](https://github.com/langchain-ai/deepagents) | 29,630 | Not measured | Not measured |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | 28,056 | [55,342](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/@qwen-code/qwen-code) | @qwen-code/qwen-code |
| [Kilo](https://github.com/Kilo-Org/kilocode) | 27,382 | [21,566](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/@kilocode/cli) | @kilocode/cli |
| [Grok Build](https://github.com/xai-org/grok-build) | 27,001 | Not measured | Not measured |
| [Copilot CLI](https://github.com/github/copilot-cli) | 11,194 | [1,061,320](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/@github/copilot) | @github/copilot |

The legacy Pi package `@mariozechner/pi-coding-agent` separately recorded 555,976 downloads that week. [npm API](https://api.npmjs.org/downloads/point/2026-09-14:2026-09-20/@mariozechner/pi-coding-agent). Pi's repository contains a toolkit, and its coding package also exposes SDK usage; the count does not isolate interactive coding-agent users. [Pi](https://pi.dev/), [package ecosystem](https://pi.dev/packages)

The DeepSeek Harness repository was created August 13, 2026, according to the GitHub API. Its 232,588 stars and 353,089 weekly package downloads establish substantial interest and distribution, but its roughly six-week public history is too short for these sources to establish mature retention. [Repository metadata](https://api.github.com/repos/deepseek-ai/deepseek-harness)

Deep Agents' repository covers a general agent harness, not only its coding CLI. OpenHands and Pi also contain broader products/toolkits. Conversely, public repositories for proprietary tools can function as issue trackers and documentation. Equal star counts are not equal product adoption. The old Roo Code repository is archived, and the legacy Kimi CLI description directs users to Kimi Code; a stars-only list would miss those lifecycle changes. [Deep Agents](https://github.com/langchain-ai/deepagents), [Roo Code](https://github.com/RooCodeInc/Roo-Code), [legacy Kimi CLI](https://github.com/MoonshotAI/kimi-cli)

## Other first-party usage signals

| Project | Observed statement | Interpretation |
| --- | --- | --- |
| OpenCode | 16M monthly developers on its home page | Vendor claim; distinct-person counting and deduplication method not established here |
| OpenCode | Data page charts 320K daily users on September 21, labeled daily unique users by model | Additional live usage signal; coverage and across-model deduplication are not sufficiently specified for comparison with other products |
| Cline | 11M+ installs across platforms, marketplace plus Open VSX | Distribution across IDE platforms, not monthly active users or CLI-only adoption |
| Kilo | 5M+ coders, 10T+ tokens processed monthly | Vendor-scale signal; user activity interval unspecified |
| Aider | 6.8M installs and 15B tokens/week displayed on homepage | Page lacks a measurement date; its displayed stars lag the live API, so do not treat this as a current weekly measure |

Sources: [OpenCode](https://opencode.ai/), [OpenCode data](https://opencode.ai/data), [Cline](https://cline.bot/), [Kilo](https://kilo.ai/), [Aider](https://aider.chat/).

## Method used to judge popularity

1. Anchor broad-adoption conclusions in surveys with a stated population, fieldwork period, and question. Cross-check their leading groups instead of averaging incompatible percentages.
2. Use disclosed DAU/WAU/MAU only with the stated product scope and measurement date. Treat cumulative users, registrations, seats, and installs separately.
3. Use a completed download window and current repository metadata to identify omissions, new projects, and ongoing distribution. Do not convert package events to humans.
4. Use stars as corroborating awareness evidence, not as the main ranking. Check project age, redirects, archive status, and whether the repository covers a framework, CLI, IDE, or all of them.
5. Keep unknown values unknown. Lack of a public active-user count does not establish low usage.
6. Do not compute a weighted score from these incomparable units. A 40% survey / 30% downloads / 30% stars formula would mostly encode arbitrary choices and missing-data penalties.

Confidence is high that the four leading products belong in a broad-market study; moderate that the expanded coverage group captures other important audiences; low for precise active-user ordering among newer or privately measured tools. This confidence is a qualitative synthesis, not a statistical probability.
