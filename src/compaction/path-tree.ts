/**
 * Grouped, prefix-folded path rendering shared by the checkpoint FILES index.
 *
 * A flat path list becomes a small directory tree: single-child directory
 * chains fold into one heading, each nesting level adds one `#`, and files are
 * printed bare under their directory heading. The output shape follows the
 * grouped listings used by oh-my-pi; the implementation here is local.
 */

const URL_LIKE_PATH_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

interface PathTreeNode {
  /** Direct file leaves, in first-seen order. */
  readonly files: { name: string; key: string }[];
  /** Names already present in `files`. */
  readonly fileNames: Set<string>;
  /** Child directories, in first-seen order. */
  readonly subdirs: { name: string; node: PathTreeNode }[];
  /** Dedup index for `subdirs`. */
  readonly dirIndex: Map<string, PathTreeNode>;
}

interface PathTreeInput {
  /** Path string; absolute, relative or URL-like. Backslashes are normalized. */
  readonly path: string;
  /** Whether the path itself is a directory (trailing slash). */
  readonly isDir: boolean;
  /** Opaque key passed to the annotate callback. Defaults to `path`. */
  readonly key?: string;
}

interface GroupedTreeEvent {
  readonly kind: 'dir' | 'file';
  /** Zero-based nesting depth; root children are depth 0. */
  readonly depth: number;
  /** Folded chain for directories, basename for files. */
  readonly name: string;
  /** Original key for a file; empty for a directory. */
  readonly key: string;
}

/** True for `scheme://...` entries that have no meaningful directory structure. */
export function isUrlLikePath(filePath: string): boolean {
  return URL_LIKE_PATH_RE.test(filePath);
}

function createNode(): PathTreeNode {
  return {
    files: [],
    fileNames: new Set<string>(),
    subdirs: [],
    dirIndex: new Map<string, PathTreeNode>(),
  };
}

function addFile(node: PathTreeNode, name: string, key: string): void {
  if (node.fileNames.has(name)) return;
  node.fileNames.add(name);
  node.files.push({ name, key });
}

/** Build a directory tree from a flat path list without escaping the input. */
function buildPathTree(entries: Iterable<PathTreeInput>): PathTreeNode {
  const root = createNode();
  for (const entry of entries) {
    const normalized = entry.path.replace(/\\/g, '/');
    const key = entry.key ?? entry.path;
    if (isUrlLikePath(normalized)) {
      addFile(root, normalized, key);
      continue;
    }
    const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
    if (trimmed.length === 0) continue;
    const segments = trimmed.split('/');
    const dirCount = entry.isDir ? segments.length : segments.length - 1;
    let node = root;
    for (let index = 0; index < dirCount; index += 1) {
      const segment = segments[index];
      if (segment === undefined) break;
      let child = node.dirIndex.get(segment);
      if (child === undefined) {
        child = createNode();
        node.dirIndex.set(segment, child);
        node.subdirs.push({ name: segment, node: child });
      }
      node = child;
    }
    if (!entry.isDir) {
      const name = segments[segments.length - 1];
      if (name !== undefined && name.length > 0) addFile(node, name, key);
    }
  }
  return root;
}

/**
 * Depth-first walk. Directories collapse their single-child chains so a shared
 * prefix becomes one heading; each node's direct files precede its subdirs.
 */
function* walkPathTree(node: PathTreeNode, depth = 0): Generator<GroupedTreeEvent> {
  for (const file of node.files) {
    yield { kind: 'file', depth, name: file.name, key: file.key };
  }
  for (const subdir of node.subdirs) {
    let dirNode = subdir.node;
    const parts = [subdir.name];
    while (dirNode.files.length === 0 && dirNode.subdirs.length === 1) {
      const only = dirNode.subdirs[0];
      if (only === undefined) break;
      parts.push(only.name);
      dirNode = only.node;
    }
    yield { kind: 'dir', depth, name: parts.join('/'), key: '' };
    yield* walkPathTree(dirNode, depth + 1);
  }
}

/**
 * Render a flat path list as a grouped, prefix-folded directory tree.
 *
 * `annotate` receives each file's original path key and its return value is
 * appended verbatim to the file line (for example ` (RW)`).
 */
export function formatGroupedPaths(
  paths: readonly string[],
  annotate?: (path: string) => string,
): string {
  if (paths.length === 0) return '';
  const tree = buildPathTree(paths.map((path) => ({ path, isDir: path.endsWith('/') })));
  const lines: string[] = [];
  for (const event of walkPathTree(tree)) {
    if (event.kind === 'dir') {
      lines.push(`${'#'.repeat(event.depth + 1)} ${event.name}/`);
    } else {
      lines.push(annotate === undefined ? event.name : `${event.name}${annotate(event.key)}`);
    }
  }
  return lines.join('\n');
}
