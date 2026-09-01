import type { Timeline } from '../types';

/**
 * Turns a playback position into the index of the word being spoken.
 *
 * Segment boundaries come from real pauses in the audio, so they need no
 * interpolation. Inside a segment — five to ten words, a second or three — time
 * is shared out by word length, which tracks how long each one takes to say far
 * better than dividing evenly does.
 *
 * Lookups happen on every animation frame, so the search is a binary search and
 * the per-segment weights are computed once and kept.
 */
export class WordClock {
  private readonly segments: Timeline['segments'];
  private readonly words: string[];
  /** Cumulative word weights for one segment, cached across frames. */
  private cacheIndex = -1;
  private cacheWeights: number[] = [];

  constructor(timeline: Timeline, words: string[]) {
    this.segments = timeline.segments;
    this.words = words;
  }

  /** Index of the segment covering `time`, or the one just before a gap. */
  private segmentAt(time: number): number {
    const segments = this.segments;
    let low = 0;
    let high = segments.length - 1;
    let before = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (time < segments[mid].s) {
        high = mid - 1;
      } else if (time > segments[mid].e) {
        before = mid;
        low = mid + 1;
      } else {
        return mid;
      }
    }
    // In the silence between two segments, hold the previous one.
    return before;
  }

  /** Cumulative weight per word in a segment, so the search below is a scan. */
  private weightsFor(index: number): number[] {
    if (this.cacheIndex === index) return this.cacheWeights;

    const { a, b } = this.segments[index];
    const weights: number[] = [];
    let total = 0;
    for (let i = a; i < b; i += 1) {
      // +1 so a one-letter word still occupies some time.
      total += (this.words[i]?.length ?? 1) + 1;
      weights.push(total);
    }

    this.cacheIndex = index;
    this.cacheWeights = weights;
    return weights;
  }

  /** The word index to highlight at `time`, or -1 before playback starts. */
  wordAt(time: number): number {
    if (!this.segments.length) return -1;

    const index = this.segmentAt(time);
    if (index < 0) return -1;

    const segment = this.segments[index];
    const span = segment.e - segment.s;
    // Past the end of a segment (we are in the pause after it) the last word
    // stays lit rather than the highlight blinking off.
    if (span <= 0 || time >= segment.e) return segment.b - 1;

    const weights = this.weightsFor(index);
    const total = weights[weights.length - 1] || 1;
    const target = ((time - segment.s) / span) * total;

    for (let i = 0; i < weights.length; i += 1) {
      if (target <= weights[i]) return segment.a + i;
    }
    return segment.b - 1;
  }
}
