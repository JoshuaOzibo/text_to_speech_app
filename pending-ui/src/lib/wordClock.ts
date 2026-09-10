import type { Timeline } from '../types';

export function wordWeight(word: string): number {
  return word.length + 1;
}

export class WordClock {
  private readonly segments: Timeline['segments'];
  private readonly words: string[];
  private cacheIndex = -1;
  private cacheWeights: number[] = [];

  constructor(timeline: Timeline, words: string[]) {
    this.segments = timeline.segments;
    this.words = words;
  }

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
    return before;
  }

  private weightsFor(index: number): number[] {
    if (this.cacheIndex === index) return this.cacheWeights;

    const { a, b } = this.segments[index];
    const weights: number[] = [];
    let total = 0;
    for (let i = a; i < b; i += 1) {
      total += wordWeight(this.words[i] ?? '');
      weights.push(total);
    }

    this.cacheIndex = index;
    this.cacheWeights = weights;
    return weights;
  }

  wordAt(time: number): number {
    if (!this.segments.length) return -1;

    const index = this.segmentAt(time);
    if (index < 0) return -1;

    const segment = this.segments[index];
    const span = segment.e - segment.s;
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
