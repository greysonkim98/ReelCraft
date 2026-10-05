// Parses ffmpeg's log output from the analysis pass:
//   scdet,blurdetect,blackdetect,freezedetect,signalstats,metadata=print

export interface FrameSample {
  t: number;
  yavg?: number;
  ydif?: number;
  blur?: number;
}

export interface Interval {
  start: number;
  end: number;
}

export interface ClipMetrics {
  samples: FrameSample[];
  sceneChanges: number[];
  black: Interval[];
  freeze: Interval[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function pairIntervals(starts: number[], ends: number[], duration: number): Interval[] {
  const s = [...starts].sort((a, b) => a - b);
  const e = [...ends].sort((a, b) => a - b);
  const out: Interval[] = [];
  let ei = 0;
  for (const start of s) {
    while (ei < e.length && e[ei]! < start) ei++;
    if (ei < e.length) {
      out.push({ start, end: e[ei]! });
      ei++;
    } else {
      out.push({ start, end: duration });
    }
  }
  return out;
}

/** Feed log lines one by one with `push`, then call `finish`. */
export class MetricsParser {
  private samples: FrameSample[] = [];
  private current: FrameSample | null = null;
  private scenes = new Set<number>();
  private blackIntervals: Interval[] = [];
  private freezeStarts = new Set<number>();
  private freezeEnds = new Set<number>();

  push(line: string): void {
    const pts = /pts_time:(-?\d+(?:\.\d+)?)/.exec(line);
    if (pts) {
      this.current = { t: Number(pts[1]) };
      this.samples.push(this.current);
    }

    const black = /black_start:(-?\d+(?:\.\d+)?)\s+black_end:(-?\d+(?:\.\d+)?)/.exec(line);
    if (black) {
      this.blackIntervals.push({ start: Number(black[1]), end: Number(black[2]) });
      return;
    }

    // Matches both metadata lines ("key=value") and info logs ("key: value").
    for (const m of line.matchAll(/lavfi\.([A-Za-z0-9_.]+?)\s*[:=]\s*(-?\d+(?:\.\d+)?)/g)) {
      const key = m[1]!;
      const value = Number(m[2]);
      switch (key) {
        case 'signalstats.YAVG':
          if (this.current) this.current.yavg = value;
          break;
        case 'signalstats.YDIF':
          if (this.current) this.current.ydif = value;
          break;
        case 'blur':
          if (this.current) this.current.blur = value;
          break;
        case 'scd.time':
          this.scenes.add(round2(value));
          break;
        case 'freezedetect.freeze_start':
          this.freezeStarts.add(round2(value));
          break;
        case 'freezedetect.freeze_end':
          this.freezeEnds.add(round2(value));
          break;
      }
    }
  }

  finish(duration: number): ClipMetrics {
    return {
      samples: this.samples,
      sceneChanges: [...this.scenes].sort((a, b) => a - b),
      black: this.blackIntervals,
      freeze: pairIntervals([...this.freezeStarts], [...this.freezeEnds], duration),
    };
  }
}

export function parseMetrics(lines: string[], duration: number): ClipMetrics {
  const parser = new MetricsParser();
  for (const line of lines) parser.push(line);
  return parser.finish(duration);
}
