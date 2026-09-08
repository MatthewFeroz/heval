import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HarnessId } from '../types'

const prompt = 'Fix the race condition in the async cache and make the full test suite pass. Preserve the public API.'
const gatewayModel = process.env.HEVAL_GATEWAY_MODEL || 'anthropic/claude-sonnet-4-5-20250929'
const gatewayKeyEnv = 'HEVAL_GATEWAY_API_KEY'
const mergeOpenAIBaseUrl = 'https://api-gateway.merge.dev/v1/openai'
const mergeAnthropicBaseUrl = 'https://api-gateway.merge.dev/v1/anthropic'

type Launch = { command: string[]; env: Record<string, string | undefined> }

export function prepareLaunch(harness: HarnessId, workspace: string): Launch {
  if (!process.env[gatewayKeyEnv]) throw new Error(`${gatewayKeyEnv} is not configured`)
  const configRoot = join(workspace, '.heval')
  mkdirSync(configRoot, { recursive: true })
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: '/tmp/heval-home',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    MERGE_GATEWAY_API_KEY: process.env[gatewayKeyEnv],
  }

  if (harness === 'codex') {
    const codexHome = join(configRoot, 'codex')
    mkdirSync(codexHome, { recursive: true })
    writeFileSync(join(codexHome, 'config.toml'), [
      `model = ${JSON.stringify(gatewayModel)}`,
      'model_provider = "merge-gateway"',
      '',
      '[model_providers.merge-gateway]',
      'name = "Merge Gateway"',
      `base_url = ${JSON.stringify(mergeOpenAIBaseUrl)}`,
      'env_key = "MERGE_GATEWAY_API_KEY"',
      'wire_api = "responses"',
      '',
      `[projects.${JSON.stringify(workspace)}]`,
      'trust_level = "trusted"',
      '',
    ].join('\n'))
    env.CODEX_HOME = codexHome
    return {
      command: [
        'codex',
        '--dangerously-bypass-approvals-and-sandbox',
        '--dangerously-bypass-hook-trust',
        '--model',
        gatewayModel,
        prompt,
      ],
      env,
    }
  }

  if (harness === 'claude-code') {
    const claudeHome = join(configRoot, 'claude-home')
    const claudeConfig = join(claudeHome, '.claude')
    mkdirSync(claudeConfig, { recursive: true })
    writeFileSync(join(claudeConfig, 'settings.json'), JSON.stringify({
      theme: 'dark',
      skipDangerousModePermissionPrompt: true,
    }))
    writeFileSync(join(claudeConfig, '.claude.json'), JSON.stringify({
      hasCompletedOnboarding: true,
      lastOnboardingVersion: '2.0.64',
      lastReleaseNotesSeen: '2.1.251',
      installMethod: 'global',
      numStartups: 1,
      projects: {
        [workspace]: {
          allowedTools: [],
          mcpContextUris: [],
          mcpServers: {},
          enabledMcpjsonServers: [],
          disabledMcpjsonServers: [],
          hasTrustDialogAccepted: true,
          hasClaudeMdExternalIncludesApproved: false,
          hasClaudeMdExternalIncludesWarningShown: false,
        },
      },
    }))
    env.HOME = claudeHome
    env.CLAUDE_CONFIG_DIR = claudeConfig
    env.ANTHROPIC_BASE_URL = mergeAnthropicBaseUrl
    env.ANTHROPIC_AUTH_TOKEN = process.env[gatewayKeyEnv]
    env.ANTHROPIC_API_KEY = ''
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = gatewayModel
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = gatewayModel
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = gatewayModel
    return { command: ['claude', '--dangerously-skip-permissions', '--model', gatewayModel, prompt], env }
  }

  if (harness === 'opencode') {
    const opencodeRoot = join(configRoot, 'opencode')
    mkdirSync(opencodeRoot, { recursive: true })
    env.XDG_CONFIG_HOME = join(opencodeRoot, 'config')
    env.XDG_DATA_HOME = join(opencodeRoot, 'data')
    env.XDG_CACHE_HOME = join(opencodeRoot, 'cache')
    env.OPENCODE_CONFIG_DIR = join(opencodeRoot, 'agent')
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        'merge-gateway': {
          models: { [gatewayModel]: { name: gatewayModel } },
        },
      },
    })
    return { command: ['opencode', '--auto', '--model', `merge-gateway/${gatewayModel}`, '--prompt', prompt], env }
  }

  const piRoot = join(configRoot, 'pi')
  mkdirSync(piRoot, { recursive: true })
  writeFileSync(join(piRoot, 'models.json'), JSON.stringify({
    providers: {
      'merge-gateway': {
        name: 'Merge Gateway',
        baseUrl: mergeOpenAIBaseUrl,
        api: 'openai-completions',
        apiKey: '$MERGE_GATEWAY_API_KEY',
        compat: { supportsReasoningEffort: false },
        models: [{
          id: gatewayModel,
          name: gatewayModel,
          reasoning: true,
          input: ['text', 'image'],
          contextWindow: 200000,
          maxTokens: 64000,
        }],
      },
    },
  }, null, 2))
  env.PI_CODING_AGENT_DIR = piRoot
  return {
    command: ['pi', '--model', `merge-gateway/${gatewayModel}`, prompt],
    env,
  }
}
