/**
 * Cuts a document's blocks into chunks: runs of neighbouring blocks,
 * each rendered as a column of its own.
 *
 * One column of five thousand blocks costs a keystroke 20 ms of layout
 * even when every block is a memo hit, because flex visits every child
 * of the column on the way to the one that changed (GESSO-ISSUES.md 1).
 * In chunks of a few dozen, it visits the chunks and the blocks of one.
 *
 * A chunk is named by the ID of its first block, and chunks are kept
 * rather than recut, so an edit changes the chunk it lands in and no
 * other: typing never changes a chunk, and inserting or removing a
 * block changes one, unless that tips it over the size limits and it
 * splits or merges with its neighbour.
 */

export interface ChunkLimits {
  /** A chunk this long splits in half. */
  readonly max: number;
  /** A chunk this short joins the one before it. */
  readonly min: number;
}

export const CHUNK_LIMITS: ChunkLimits = { max: 64, min: 16 };

/**
 * The chunks of `blocks`, given the first blocks of last time's chunks.
 * Returns each chunk's block IDs, keyed by its first block's ID, in order.
 */
export function chunk(
  blocks: readonly { readonly id: string }[],
  starts: ReadonlySet<string>,
  limits: ChunkLimits = CHUNK_LIMITS
): Map<string, string[]> {
  // Last time's boundaries, wherever their blocks still are. A chunk whose
  // first block was deleted runs on into the chunk before it.
  const groups: string[][] = [];
  for (const { id } of blocks) {
    if (groups.length === 0 || starts.has(id)) {
      groups.push([id]);
    } else {
      groups[groups.length - 1]!.push(id);
    }
  }

  const sized: string[][] = [];
  for (const group of groups) {
    const previous = sized[sized.length - 1];
    if (previous !== undefined && (group.length < limits.min || previous.length < limits.min) && previous.length + group.length <= limits.max) {
      previous.push(...group);
      continue;
    }
    sized.push(group);
  }

  const out = new Map<string, string[]>();
  for (const group of sized) {
    // Halve until it fits, so a paste of a thousand blocks makes chunks
    // near the middle of the range rather than a row of full ones.
    const pieces = Math.ceil(group.length / limits.max) * (group.length > limits.max ? 2 : 1);
    const size = Math.ceil(group.length / pieces);
    for (let at = 0; at < group.length; at += size) {
      const piece = group.slice(at, at + size);
      out.set(piece[0]!, piece);
    }
  }
  return out;
}
