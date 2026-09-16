import type { RunEvent, Runner } from '../data'

// Layouts checked against the native CLI startup screens; see docs/landing-design.md.
const reset = '\x1b[0m'
const color = (value: string, text: string) => `\x1b[${value}m${text}${reset}`
const muted = (text: string) => color('38;2;132;132;132', text)
const dim = (text: string) => color('38;2;101;101;101', text)
const bold = (text: string) => color('1', text)
const accent = (text: string) => color('38;2;215;119;87', text)
const blue = (text: string) => color('38;2;92;156;245', text)
const directory = '~/project'

function wrap(text: string, width: number) {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(current)
      current = ''
    }
    let remaining = word
    while (remaining.length > width) {
      if (current) lines.push(current)
      lines.push(remaining.slice(0, width))
      remaining = remaining.slice(width)
      current = ''
    }
    current += `${current ? ' ' : ''}${remaining}`
  }
  if (current) lines.push(current)
  return lines
}

export function terminalFrame(runner: Runner, events: RunEvent[], isDone: boolean, started: boolean, cols: number, rows: number) {
  let out = '\x1b[0m\x1b[2J\x1b[H\x1b[?25l'
  const put = (row: number, col: number, text: string) => {
    if (row <= rows) out += `\x1b[${row};${col}H${text}`
  }
  const rule = muted('─'.repeat(cols))

  if (!started && runner.id === 'opencode') {
    const logo = [
      '                                 ▄     ',
      '█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█',
      '█  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀',
      '▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀',
    ]
    const top = Math.max(1, Math.floor((rows - 18) / 2))
    const left = Math.max(1, Math.floor((cols - 39) / 2) + 1)
    logo.forEach((row, i) => put(top + i, left, muted(row.slice(0, 20)) + bold(row.slice(20))))
    const boxWidth = Math.min(76, cols - 4)
    const boxLeft = Math.floor((cols - boxWidth) / 2) + 1
    const boxTop = top + 6
    const model = wrap(`Build · ${runner.model} ${runner.provider}`, boxWidth - 5)
    const boxLines = ['', 'Ask anything… "Fix broken tests"', '', ...model]
    boxLines.forEach((text, i) => {
      put(boxTop + i, boxLeft, blue('┃') + color('48;2;30;30;30;38;2;160;160;160', `  ${text}`.padEnd(boxWidth - 1)))
    })
    put(boxTop + boxLines.length, boxLeft, blue('╹') + color('38;2;30;30;30', '▀'.repeat(boxWidth - 1)))
    const shortcuts = 'tab agents  ctrl+p commands'
    put(boxTop + boxLines.length + 1, boxLeft + boxWidth - shortcuts.length, muted(shortcuts))
    const tip = wrap('● Tip Run /connect to add an AI provider and start coding', cols - 6)
    tip.forEach((text, i) => put(rows - 2 - tip.length + i, Math.floor((cols - text.length) / 2) + 1, muted(text)))
    put(rows - 1, 3, dim(directory))
    put(rows - 1, cols - runner.version.length - 1, dim(runner.version.replace(/^v/, '')))
    return out
  }

  let contentTop = 1
  if (runner.id === 'claude-code') {
    put(1, 1, accent(' ▐▛███▛█') + `   ${bold(`Claude Code ${runner.version}`)}`)
    put(2, 1, accent('▝▜██████▀') + `  ${muted(runner.model)}`)
    put(3, 1, accent('  ▝▝ ▝▝') + `    ${dim(directory)}`)
    contentTop = 5
  } else if (runner.id === 'codex') {
    const boxWidth = Math.min(cols, Math.max(44, runner.model.length + 28))
    const inside = boxWidth - 4
    const boxRow = (row: number, text: string) => put(row, 1, muted(`│ ${text.padEnd(inside)} │`))
    put(1, 1, muted(`╭${'─'.repeat(boxWidth - 2)}╮`))
    boxRow(2, `>_ OpenAI Codex (${runner.version})`)
    put(2, 3, `>_ ${bold('OpenAI Codex')}${muted(` (${runner.version})`)}`)
    boxRow(3, '')
    boxRow(4, `model:     ${runner.model}   /model`)
    boxRow(5, `directory: ${directory}`)
    put(6, 1, muted(`╰${'─'.repeat(boxWidth - 2)}╯`))
    contentTop = 8
    if (!started) {
      const tip = wrap('Tip: Use /model to choose which model to use.', cols - 4)
      tip.forEach((text, i) => put(contentTop + i, 3, muted(text)))
      contentTop += tip.length + 2
    }
  } else if (runner.id === 'pi-agent') {
    put(1, 1, ` ${color('1;38;2;230;142;13', 'pi')} ${dim(runner.version)}`)
    contentTop = 2
    if (!started) {
      for (const text of [
        'escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more',
        'Press ctrl+o to show full startup help and loaded resources.',
        '',
        'Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.',
      ]) {
        const lines = text ? wrap(text, cols - 2) : ['']
        lines.forEach(line => put(contentTop++, 2, muted(line)))
      }
      contentTop += 2
    }
  } else {
    put(1, 2, bold('OpenCode') + ` ${dim(runner.version)}`)
    put(2, 2, dim(directory))
    contentTop = 4
  }

  // Playback is explicitly illustrative. Keep its log inside the available rows.
  const composerTop = started ? rows - 4 : contentTop + (runner.id === 'claude-code' ? 1 : 0)
  if (started) {
    const activity: string[] = []
    events.filter(event => event.at > 0).forEach(event => {
      const marker = runner.id === 'claude-code' ? '●' : runner.id === 'codex' ? '•' : '›'
      wrap(`${marker} ${event.text}`, cols - 2).forEach(text => activity.push(text))
      if (event.detail) wrap(event.detail, cols - 4).forEach(text => activity.push(`  ${text}`))
      activity.push('')
    })
    if (!activity.length) activity.push('Starting sample task…')
    activity.slice(-Math.max(1, composerTop - contentTop - 1)).forEach((text, i) => put(contentTop + i, 2, muted(text)))
  }

  if (runner.id === 'codex') {
    put(composerTop + 1, 1, `› ${dim(isDone ? 'Ask a follow-up question' : 'Ask Codex to do anything')}`)
    put(composerTop + 3, 3, dim(`${runner.model} · ${directory}`))
  } else if (runner.id === 'pi-agent') {
    put(composerTop, 1, color('38;2;211;95;95', '─'.repeat(cols)))
    put(composerTop + 2, 1, color('38;2;211;95;95', '─'.repeat(cols)))
    put(composerTop + 3, 1, dim(directory))
    put(composerTop + 4, 1, dim('0.0%/200k (auto)'))
    put(composerTop + 4, cols - runner.model.length + 1, dim(runner.model))
  } else if (runner.id === 'claude-code') {
    put(composerTop, 1, rule)
    put(composerTop + 1, 1, `❯ ${dim(isDone ? 'Try "review my changes"' : 'Try "refactor <filepath>"')}`)
    put(composerTop + 2, 1, rule)
    put(composerTop + 3, 3, dim('? for shortcuts'))
  } else {
    put(composerTop, 2, blue('┃') + muted(' Ask anything…'))
    put(composerTop + 2, 2, blue('Build') + ` ${muted(runner.model)}`)
    put(composerTop + 4, 2, dim('tab agents  ctrl+p commands'))
  }
  return out
}
