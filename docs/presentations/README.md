# Heval capstone presentation

**Matthew Feroz · 2026F SSW 695-A · Fall 2026**\
Software Engineering Capstone Studio · Prof. Rich Kempinski

Open [heval-capstone.html](heval-capstone.html) directly in a browser. It is a
self-contained, offline presentation with an embedded font and the supplied
screenshot of the published Merge comparison.
The accompanying [PDF](heval-capstone.pdf) contains the same 11 slides for submission.
[Speaker notes](heval-capstone-speaker-notes.md) are also available as Markdown.

With the local app running, the deck is available at:
<http://localhost:5181/docs/presentations/heval-capstone.html>.

| Control | Action |
| --- | --- |
| Arrow keys / Space / Page Down | Next slide |
| Left arrow / Shift+Space / Page Up | Previous slide |
| Home / End | First / last slide |
| O | Slide overview |
| N | Speaker notes (visible on the current screen) |
| F | Full screen |
| P | Print / save as PDF |
| ? | Shortcut help |
| Esc | Close a panel |

Swipe horizontally to navigate on a touch screen. Slide URLs use `#slide-1`
through `#slide-11`. Suggested presentation time is 7–9 minutes.

## Optional live demo

Run `bun run studio:local` from the repository root. Slide 6 links to the local
question-driven editor as evidence of the existing analysis engine. The deck and
its screenshot work without that server;
the live editor needs the server. Show a question, inspect the raw trials, and
export an image. The sample is an archived six-model, 20-task comparison through
Codex, not a universal ranking or an evaluation running during the presentation.

## Product direction

The full evaluation-to-publication workflow has already been completed. Slide 4
shows the published post and the six-model / 20-task evaluation as the foundation.
The semester scope is the next product release:

- Expand the installed CLI with authentication, run submission, status,
  cancellation, and result upload.
- Deliver the complete hosted application, including Studio and image/thread
  exports without a local backend dependency.
- Deploy one supported cloud worker environment with execution, recovery,
  cancellation, and saved results.
- Connect CLI artifacts and cloud reports under the user's account.

Cloud delivery is a core priority. Team workflow improvements are the next
priority; additional compute providers, scheduling, and CI extend the vision.
The CLI `login`, `run`, and `push` examples on slide 6 are proposed interfaces,
not currently shipped commands.

## Assignment coverage

- Project identity and repository: slides 1 and 11.
- Customer, problem, and impact: slide 2.
- Vision beyond this semester: slide 3.
- Completed evaluation and published output versus new product work: slide 4.
- Semester scope, priorities, and exclusions: slide 5.
- Target CLI-to-cloud user workflow: slide 6.
- Epics, features, stories, and acceptance criteria: slides 7–8.
- High-level technical approach: slide 9.
- Delivery milestones and proposed success criteria: slide 10.

The proposed scope and success criteria need team review. The presentation does
not claim that collaborators have been added, member commits verified, or the
course Wiki initialized. Use the instructor-provided Canvas `Home.md` and
`_Sidebar.md` templates for that setup. Submit after the course group is created.

## Source material

The deck reflects the existing repository and completed evaluation as reviewed in
September 2026: `README.md`, `docs/design-system.md`, `docs/architecture.md`,
`docs/reproducing-evaluations.md`, `packages/cli/README.md`,
`docs/connected-runners.md`, `docs/guided-evaluation-workflow.md`, and `src/studio/`.
The published-post screenshot was supplied by Matthew Feroz; its 27.5K view count
is a snapshot, not a live metric. The opening chart uses four
of the six models in `results/harbor/terminal-bench-comparison.json` and labels
that subset. Proposed work and targets are identified as proposals.

DM Sans is embedded under the SIL Open Font License; the full license is included
in the HTML source. No CDN, analytics, or external presentation library is used.
