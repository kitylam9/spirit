import { createHash, randomBytes } from "node:crypto";

/** 64-bit hex seed (16 chars), as required by the schemas. */
export function newSeed(): string {
  return randomBytes(8).toString("hex");
}

/** seed(child) = hash(seed(parent), childKind, index) — see docs/02-world-model.md §2. */
export function childSeed(parent: string, kind: string, index: number | string = 0): string {
  return createHash("sha256").update(`${parent}:${kind}:${index}`).digest("hex").slice(0, 16);
}

export class Rng {
  private state: number;

  constructor(seed: string) {
    this.state = parseInt(seed.slice(0, 8), 16) ^ parseInt(seed.slice(8, 16), 16) || 0x9e3779b9;
  }

  /** mulberry32, float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
