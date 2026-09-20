# Heval — presenter notes

Matthew Feroz · 2026F SSW 695-A · Fall 2026
Software Engineering Capstone Studio · Prof. Rich Kempinski

Suggested length: 7–9 minutes, plus an optional 45-second demo of the existing editor.

The completed evaluation and published post are the baseline. The semester centers on the expanded CLI and complete cloud application.

## 01. Heval · Vision & scope

Heval has already completed the full evaluation-to-publication workflow. I ran a six-model comparison over 20 tasks and produced the charts used in a published Merge post.

The capstone builds on that demonstrated result. The next challenge is distribution: another developer should be able to install the CLI, run an evaluation, and use a complete cloud application to inspect and publish the results. The opening chart shows four of the six models from that completed run.

## 02. The users & the next problem

The customer problem has moved beyond producing a chart. Heval already does that. The product challenge is allowing someone other than the original author to perform and review an evaluation without reproducing my development environment.

Developers need a practical CLI. Evaluators need execution that can continue away from the laptop. Teams need a hosted workspace with the full graph editor, export workflow, and access to their saved evidence.

## 03. The long-term vision

The long-term vision connects execution, analysis, and communication. A terminal command and a browser action should operate on the same evaluation plan and produce the same durable result.

The semester moves Heval into a usable CLI and cloud product. Scheduled evaluation, CI integration, a broad cloud-provider ecosystem, and richer organization features extend that platform beyond this semester.

## 04. Already evaluated. Already published.

This is the baseline, not future scope. I have already completed an end-to-end evaluation and produced an entire published comparison. The screenshot shows the Merge post and the graphs generated from the results.

Six models were evaluated on 20 tasks, producing 120 trial records. The screenshot shows 27.5K views at capture time; that is a snapshot, not a live engagement metric. The evaluation is a particular task set and configuration, not a universal model ranking.

There is also an existing installable CLI for viewing results and checking prerequisites, plus hosted report and connected-runner work in the repository. The capstone extends and connects these capabilities so other users can complete the workflow.

## 05. Semester scope · CLI + cloud

Cloud is a core deliverable. The release should provide an installed CLI and an online application with the complete analysis and publishing flow, including the export services that currently depend on a local backend.

The CLI grows from opening results and checking setup into authentication, evaluation submission, status, cancellation, and result upload. Remote execution builds on the connected-runner work and targets one supported cloud worker environment.

Result synchronization closes the loop between local work and the hosted account. A publicly reachable application does not make private datasets public: existing ownership and sharing rules remain part of the release. Supporting every provider and enterprise administration belongs to later expansion.

## 06. The CLI-to-cloud user journey

This is the semester user journey. Another developer installs the package, signs in, submits a configured evaluation to the cloud, and opens the finished result online. The browser should not need to remain open for execution to continue.

The CLI syntax shown is a proposed interface, not a claim that login, run, or push are already released. The existing open and doctor commands provide the starting point; the preview runner commands provide additional implementation groundwork.

For a brief live demonstration, show the existing local question selector, raw trials, and export. Explain that this working analysis engine is what will become consistently available through the hosted application.

## 07. Epics · CLI, workspace, execution

The backlog now centers on product distribution and cloud execution. E1 covers the developer-facing CLI, E2 the complete hosted application, and E3 the lifecycle of work executed on a cloud worker.

Result synchronization crosses these boundaries: the CLI submits or uploads, the worker returns results, and the workspace preserves the report. Feature and story IDs make those dependencies explicit. Existing implementations are reused and extended rather than claimed as new work.

## 08. Acceptance criteria · the new capabilities

These examples test capabilities that advance the release. CLI submission can be delivered against a supported existing worker path. Cloud export must work without a localhost dependency and must preserve source ownership. Reconnection must retain run identity instead of triggering duplicate computation.

Each example is scoped around a concrete behavior. More failure paths and platform combinations become separate stories. An end-to-end test of the target deployment is part of the definition of done, not a substitute for delivering the functionality.

## 09. Architecture · CLI and cloud

This is an extension of the existing architecture. The CLI and browser are two clients of one hosted workspace. WorkOS provides identity, Convex stores the coordination and report state, and a cloud worker executes Harbor tasks.

The export services need a supported cloud runtime as well. Hosting a static frontend by itself does not deliver the full graph and publishing workflow. The implementation should provide a protected rendering service or an appropriate browser-based export path.

The first supported execution environment builds on the connected Linux runner and Docker path. Managed sandbox provisioning is a possible next step; it is not necessary to imply that every provider is supported. The capstone must deploy and test a real cloud execution path.

## 10. Milestones · release the platform

The semester outcome is tangible distribution: an expanded package people can install and a cloud application they can use. Milestones can overlap according to team ownership; the sequence shows the major integration dependencies.

The final demo should include a fresh evaluation on the supported cloud worker and an online report opened from another device. Archived fixtures still make regression testing economical, but they do not replace that cloud execution acceptance test.

Usability is measured through new-user installation and submission, while system tests verify status recovery, cancellation, ownership, and artifact delivery. The proposed 4-of-5 adoption target is not an existing measured outcome.

## 11. The semester promise · CLI + cloud

The closing promise is the updated capstone direction: install the CLI, execute through the cloud, and publish the evidence. The completed evaluation and public post establish what Heval can already do.

The semester makes that capability available to other developers and teams. Ask for feedback on CLI ergonomics, the hosted workflow, and the first pilot users. Keep the existing GitHub repository as the project location.
