# User environment and evaluation setup

## Starting new work

- Before starting a new project, task, or worktree, ask the user whether it is
  worth refreshing remote references and fast-forwarding from `main`. Do not
  let a newly created worktree silently start from an older local base.

Remember this environment context when helping with Heval (confirmed with the user on 2026-09-17):

- The user's physical laptop is a MacBook with an M5 Pro chip, running macOS. This host information is user-reported; the guest does not expose the exact Mac model or macOS version.
- This workspace runs inside a Try Omarchy VM on that MacBook, not directly on macOS. Guest inspection identifies Arch Linux ARM / aarch64, hostname `omarchy`, and QEMU virtualization.
- Distinguish the macOS host's resources from the VM's allocation. The VM was observed with about 8 GiB RAM and a 24 GiB root filesystem; recheck available resources before installations or evaluations.
- Do not ask the user again which OS their laptop uses unless there is evidence the machine has changed. On 2026-09-17, SSH access was verified as mattferoz@10.0.2.2 using ~/.ssh/heval_mac_ed25519. The user reported macOS 26.6.2; SSH confirmed Darwin and 532 GiB available host disk. Docker Desktop reported ARM64, 18 CPUs and 17.54 GiB assigned memory (not total host RAM). Try Omarchy uses its own QEMU launcher, not UTM. Keep host and guest resources distinct.
- The user wants to keep the downloaded harnesses on the VM for now.
- The intended initial comparison is Codex, Claude Code, and Pi using DeepSeek V4.1 Flash through Merge Gateway. On 2026-09-17, a Linux worker container named heval-smoke-worker was deployed on the Mac’s Docker Desktop, using /Users/mattferoz/heval-smoke-worker as an identical-path bind mount and the Docker socket. It is paired to the user’s Heval account; Oracle, Codex, Claude Code and Pi smoke trials passed and uploaded reports. Merge V4.1 Flash/particle was verified across all generation requests. The Mac must stay awake; SSH is only for administration.
- The connected Heval runner currently requires Linux. Do not imply it runs natively on macOS without implementation and validation. A separate Linux worker VM on the Mac or direct Harbor execution are distinct options.
