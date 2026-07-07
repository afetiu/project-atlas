/**
 * Bounded-context helpers: a restrained colour palette and assignment by index,
 * so groups get distinct, low-chroma region colours without the user picking
 * them. Kept tiny and deterministic.
 */

export const GROUP_COLORS = [
  '#c89b6c', // camel
  '#7fa98c', // sage
  '#c57f6d', // terracotta
  '#a98bb8', // dusty violet
  '#6fa8a0', // sea glass
  '#d9a253', // ochre
  '#9aa78a', // olive
] as const;

export function groupColorForIndex(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}
