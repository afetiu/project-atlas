/**
 * Bounded-context helpers: a restrained colour palette and assignment by index,
 * so groups get distinct, low-chroma region colours without the user picking
 * them. Kept tiny and deterministic.
 */

export const GROUP_COLORS = [
  '#7c93ff',
  '#4fd1a1',
  '#f0a868',
  '#c792ea',
  '#56c5ff',
  '#ff8b8b',
  '#9ad07a',
] as const;

export function groupColorForIndex(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}
