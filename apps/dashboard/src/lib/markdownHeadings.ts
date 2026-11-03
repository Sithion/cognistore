type MarkdownNode = {
  type: string;
  depth?: number;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
};

/** Keep authored heading styles while fitting embedded content into the page outline. */
export function markdownHeadings({ level = 2 }: { level?: number } = {}) {
  return (tree: MarkdownNode) => {
    const parents: number[] = [];
    const visit = (node: MarkdownNode) => {
      if (node.type === 'heading' && node.depth) {
        const depth = node.depth;
        while (parents.length && parents[parents.length - 1] >= depth) parents.pop();
        node.depth = Math.min(6, level + parents.length);
        parents.push(depth);
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, 'data-markdown-heading': `h${depth}` },
        };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
