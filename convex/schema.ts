import { gatewayCatalogValidator } from './gatewayCatalogValidator'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { machineKindValidator, profileValidator, runStatusValidator, runSettingsValidator } from './runnerValidators'
import { monitoringValidator } from './monitoringValidators'

export default defineSchema({
  runnerMonitoring: defineTable({ run: v.id('runnerRuns'), receivedAt: v.number(), snapshot: monitoringValidator }).index('by_run', ['run']),
  presentationExports: defineTable({
    report: v.id('reports'), owner: v.string(), requestId: v.string(), version: v.number(),
    status: v.union(v.literal('queued'), v.literal('rendering'), v.literal('complete'), v.literal('failed')),
    collection: v.boolean(), preset: v.string(), theme: v.string(), snapshotId: v.string(),
    startedAt: v.optional(v.number()), finishedAt: v.optional(v.number()), error: v.optional(v.string()),
    pathname: v.optional(v.string()), filename: v.optional(v.string()), contentType: v.optional(v.string()),
    bytes: v.optional(v.number()), inputHash: v.string(),
  }).index('by_report', ['report']).index('by_status', ['status']).index('by_owner', ['owner']).index('by_request', ['owner', 'requestId']),
  presentationExportInputs: defineTable({ job: v.id('presentationExports'), payload: v.string(), document: v.string() }).index('by_job', ['job']),
  onboardingProgress: defineTable({ owner: v.string(), step: v.number(), status: v.union(v.literal('started'), v.literal('completed'), v.literal('skipped')), updatedAt: v.number() }).index('by_owner', ['owner']),
  runnerPairings: defineTable({ owner: v.string(), name: v.string(), codeHash: v.string(), expiresAt: v.number(), runner: v.optional(v.id('runners')) }).index('by_hash', ['codeHash']).index('by_owner', ['owner']),
  runners: defineTable({ modelCatalog: v.optional(gatewayCatalogValidator), owner: v.string(), name: v.string(), credentialHash: v.string(), revoked: v.boolean(), lastSeen: v.number(), ready: v.boolean(), health: v.string(), profiles: v.array(profileValidator), session: v.optional(v.string()), leaseUntil: v.number(), activeRun: v.optional(v.id('runnerRuns')),
    // Absent means on; `machine` is reported by the worker, `icon` is the owner's override.
    enabled: v.optional(v.boolean()), machine: v.optional(machineKindValidator), icon: v.optional(machineKindValidator) }).index('by_owner', ['owner']).index('by_credential', ['credentialHash']),
  experiments: defineTable({ setupRun: v.optional(v.id('runnerRuns')), owner: v.string(), title: v.string(), runner: v.id('runners'), requestId: v.string(), selection: v.string(), attempts: v.number(), taskSet: v.string(), report: v.optional(v.id('reports')) }).index('by_owner', ['owner']).index('by_request', ['owner', 'requestId']),
  runnerRuns: defineTable({ experiment: v.optional(v.id('experiments')), requestedAttempts: v.optional(v.number()), runSettings: v.optional(runSettingsValidator), owner: v.string(), runner: v.id('runners'), requestId: v.string(), profile: profileValidator, status: runStatusValidator, claimId: v.optional(v.string()), startedAt: v.optional(v.number()), finishedAt: v.optional(v.number()), report: v.optional(v.id('reports')), phase: v.string(), message: v.optional(v.string()) }).index('by_owner', ['owner']).index('by_request', ['owner', 'requestId']).index('by_runner_status', ['runner', 'status']).index('by_experiment', ['experiment']),
  reports: defineTable({
    owner: v.string(), title: v.string(), trials: v.number(),
    shareToken: v.union(v.string(), v.null()),
  }).index('by_owner', ['owner']).index('by_share', ['shareToken']),
  reportData: defineTable({ report: v.id('reports'), json: v.string() }).index('by_report', ['report']),
  usedShareTokens: defineTable({ token: v.string() }).index('by_token', ['token']),
  reportProjects: defineTable({ report: v.id('reports'), draft: v.string(), version: v.number(), updatedBy: v.string(), published: v.optional(v.string()), publishedVersion: v.optional(v.number()) }).index('by_report', ['report']),
  reportRevisions: defineTable({ report: v.id('reports'), version: v.number(), document: v.string(), publishedBy: v.string() }).index('by_report', ['report', 'version']),
  reportMembers: defineTable({ report: v.id('reports'), user: v.string(), label: v.string(), role: v.union(v.literal('viewer'), v.literal('editor')) }).index('by_user', ['user']).index('by_report', ['report', 'user']),
  reportInvites: defineTable({ report: v.id('reports'), token: v.string(), role: v.union(v.literal('viewer'), v.literal('editor')), expiresAt: v.number(), usedBy: v.optional(v.string()), revoked: v.boolean() }).index('by_token', ['token']).index('by_report', ['report']),
})
