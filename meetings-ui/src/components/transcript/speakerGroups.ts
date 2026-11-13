import type { Participant, Speaker, TranscriptSegment } from '../../lib/types'
import { speakerLabelText } from './exportText'

/**
 * One person as the transcript shows them: every label the creator assigned to the same Operai or external
 * participant, or renamed to the same text, is ONE speaker on screen (one chip, one filter). A label still
 * called "Speaker n" is its own group: nothing says two of them are the same voice.
 */
export type SpeakerGroup = {
  id: string
  name: string
  /** The transcript's labels in this group, in the transcript's own order. */
  speakers: Speaker[]
  keys: string[]
}

const groupIdOf = (speaker: Speaker): string =>
  speaker.label.kind === 'participant'
    ? `participant:${speaker.label.participantId}`
    : speaker.label.kind === 'text'
      ? `text:${speaker.label.text.trim().toLocaleLowerCase()}`
      : `key:${speaker.key}`

export function groupSpeakers(speakers: readonly Speaker[], participants: Participant[]): SpeakerGroup[] {
  const groups = new Map<string, SpeakerGroup>()
  for (const speaker of speakers) {
    const id = groupIdOf(speaker)
    const group = groups.get(id)
    if (group) {
      group.speakers.push(speaker)
      group.keys.push(speaker.key)
    } else {
      groups.set(id, {
        id,
        name: speakerLabelText(speaker.label, participants),
        speakers: [speaker],
        keys: [speaker.key],
      })
    }
  }
  return [...groups.values()]
}

/** The group's longest timed line: the best sample of the voice (null when no line has times). */
export function longestLine(
  group: SpeakerGroup,
  segments: readonly TranscriptSegment[],
): { startMs: number; endMs: number } | null {
  let best: { startMs: number; endMs: number } | null = null
  for (const segment of segments) {
    if (segment.speakerKey === null || !group.keys.includes(segment.speakerKey)) continue
    if (segment.startMs === null || segment.endMs === null || segment.endMs <= segment.startMs) continue
    if (best === null || segment.endMs - segment.startMs > best.endMs - best.startMs) {
      best = { startMs: segment.startMs, endMs: segment.endMs }
    }
  }
  return best
}
