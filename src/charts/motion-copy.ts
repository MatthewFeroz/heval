/**
 * The composition's built-in copy, in one browser-safe place.
 *
 * Two callers need the same sentences. `harbor/social/completion.ts` draws them
 * whenever an editor slot is left blank, and the Studio's Motion editor shows
 * them as the input's placeholder so a person can read what they are about to
 * replace. While these strings were computed inside the composition alone, the
 * editor could only say "blank keeps the built-in" without ever saying what the
 * built-in was, which is the same as not offering the control.
 *
 * Pure functions over rows. No fs, no DOM - the server builds the frame with
 * these and the browser previews it with these.
 */

import { labelLines } from './poster'
import type { TrialRow } from './trial'

/** The copy slots the composition draws as free text. */
export type CopySlot = 'title' | 'kicker' | 'cue' | 'note' | 'source'

export type CompletionCopy = Record<CopySlot, string>

/**
 * A bar label carries at most two lines, so an override needs a way to say
 * where the break goes. A pipe reads as a break in a single-line input and
 * survives a URL without escaping, unlike a newline.
 */
export const BAR_LABEL_SEPARATOR = '|'

/** `'DeepSeek | V4 Pro'` -> `['DeepSeek', 'V4 Pro']`. Third line dropped. */
export function barLabelLines(text: string): string[] {
  return text.split(BAR_LABEL_SEPARATOR).map((part) => part.trim()).filter(Boolean).slice(0, 2)
}

/**
 * The derived label a bar carries with no override, written in the same
 * separator syntax an override uses. Typing this string back reproduces the
 * built-in exactly, so the placeholder doubles as the format's documentation.
 */
export function barLabelText(key: string): string {
  return labelLines(key).join(` ${BAR_LABEL_SEPARATOR} `)
}

/**
 * Stable key for a tick's override, taken from its value rather than its
 * position: the 20% tick keeps its override whether the step is 5% or 20%,
 * where an index would silently hand it to a different level. Rounded because
 * walking the axis by a step accumulates float drift.
 */
export function tickKey(value: number): string {
  return String(Math.round(value * 1e6) / 1e6)
}

/**
 * What the frame says when every text slot is blank.
 *
 * `modelCount` is the number of series that entered the comparison and
 * `better` comes from the panel, so the attempt density and the direction cue
 * match the chart actually being drawn rather than a fixed sentence.
 */
export function builtInCopy(
  rows: readonly TrialRow[],
  job: string,
  modelCount: number,
  better: 'higher' | 'lower',
): CompletionCopy {
  const cue = `${better[0].toUpperCase()}${better.slice(1)} is better`
  // The editor calls this while an export is still loading. Without this the
  // placeholders would advertise "NaN attempts per task per model".
  if (!rows.length || !modelCount) {
    return { title: 'Completion rate', kicker: '', cue, note: '', source: job ? `source: heval · ${job}` : '' }
  }
  const tasks = new Set(rows.map((row) => row.task)).size
  const harnesses = [...new Set(rows.map((row) => row.agent))]
  const perCell = rows.length / (modelCount * tasks)
  return {
    title: 'Completion rate',
    kicker: `${rows.length} trials · ${tasks} tasks · ${harnesses.join(' + ')}`,
    cue,
    note: perCell < 3
      ? `${perCell < 1.05 ? 'One attempt' : `${perCell.toFixed(1)} attempts`} per task per model. Treat small differences as directional`
      : `${perCell.toFixed(1)} attempts per task per model`,
    source: `source: heval · ${job}`,
  }
}
