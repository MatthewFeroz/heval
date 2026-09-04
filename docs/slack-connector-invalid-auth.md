# Agent Handler Slack connector: unrecoverable `invalid_auth`

Reproduced 2026-09-03. Reported by multiple people in the org. Findings only.

## What fails

All Slack tool calls, reads and writes alike, return `502 tool_execution_error` wrapping
`Slack API error: invalid_auth`. `authenticate_slack` returns "already authenticated" and issues
no OAuth link, so the credential store and Slack disagree and nothing in-session reconciles them.

## Timeline (UTC)

| Time | Call | Result |
|---|---|---|
| 20:06:40 | `create_channel` | ok (`C0BUR4BNMLM`) |
| 20:06:46 | `set_channel_topic` | ok |
| 20:06:47 | `set_channel_purpose` | ok |
| 20:06:57 | `post_message` | ok (`1788466017.922429`) |
| ~20:07 | `pin_message` | ok |
| ~20:3x | `update_message`, `post_message`, `validate_credential` | `invalid_auth` |
| 20:44:48 | `validate_credential`, `get_channel_info` | `invalid_auth` — persistent |

## Connector probe

| Connector | Result |
|---|---|
| salesforce, gong | success |
| github, gmail, notion, google_calendar, google_drive, figma | `401 reauth_required` + `authenticate_tool` |
| **slack** | **`502 tool_execution_error`, raw `invalid_auth`** |

Salesforce and Gong show the platform is healthy. The six 401s show the reauth contract exists and
works. Slack is the only connector that fails without using it.

## Not scopes

Slack returns `missing_scope` for permission gaps; this is `invalid_auth`. Read-only calls fail
identically to writes, and the same token had just completed five successful writes.

## The app in the path

| Field | Value |
|---|---|
| App ID | `A098TS4T6LB` |
| Bot user | `B0BFV68UWQ3` |
| Name | `Merge demo testing` |
| Workspace | `T013VTY3NHG` |
| Last updated | 2026-07-08 17:48:18Z |
| Icon | Slack default placeholder, never customised |

Unbranded, untouched since July, and the authentication path of record for org Slack access.

It uses a **user token**, not a bot token: `create_channel` returned `"creator": "U0BFJNA2MJ8"`
(the human user), and `post_message` returned `"user": "U0BFJNA2MJ8", "username": "matt.feroz"`
alongside `"bot_id": "B0BFV68UWQ3"`. So messages are authored by the calling user's account, and
each affected person holds their own token issued by this one app.

## Unknown

Why Slack began rejecting the token. Simultaneous multi-user failure points to the shared
dependency — this app — via either a workspace-level uninstall/restriction or a rotation cadence
common to its user tokens. Not determinable from the payloads: who installed `A098TS4T6LB`, its
scopes, whether it is org-approved, or when its tokens last rotated.
