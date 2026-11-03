/* Convert already sanitized preview DOM to a PDF document definition. */
const PAGE_WIDTH = 595.28;
const MARGIN = 48;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export function definition(root, { name, baseUrl, images = new Map() }) {
  function inline(node, style = {}) {
    if (node.nodeType === 3) return node.textContent.split(/(\S{24,})/u).filter(Boolean).map((text) => ({
      text, ...style, ...(/^\S{24,}$/u.test(text) ? { wordBreak: 'break-all' } : {}),
    }));
    if (node.nodeType !== 1) return [];
    const tag = node.tagName;
    if (node.matches('.mdp-code-head, .mdp-task-box')) return [];
    if (tag === 'BR') return [{ text: '\n', ...style }];
    if (tag === 'INPUT') return [{ text: node.checked ? '[x] ' : '[ ] ', ...style }];
    if (tag === 'IMG') return [{ imageNode: images.get(node) || { text: `[图片：${node.alt || '无法读取'}]`, color: '#59636e' } }];
    const next = { ...style };
    if (['B', 'STRONG'].includes(tag)) next.bold = true;
    if (['I', 'EM'].includes(tag)) next.italics = true;
    if (['S', 'DEL'].includes(tag)) next.decoration = 'lineThrough';
    if (tag === 'CODE') { next.background = '#f0f2f4'; next.fontSize = 9; }
    if (tag === 'A') {
      try {
        const url = new URL(node.getAttribute('href'), baseUrl || document.baseURI);
        if (['http:', 'https:', 'mailto:'].includes(url.protocol)) {
          next.link = url.href;
          next.color = '#0969da';
          next.decoration = 'underline';
        }
      } catch { /* Retain the text of unsupported links. */ }
    }
    return [...node.childNodes].flatMap((child) => inline(child, next));
  }

  function paragraph(node, style = {}) {
    const output = [];
    let runs = [];
    const flush = () => {
      if (!runs.length) return;
      output.push({ text: runs, margin: [0, 0, 0, 8], ...style });
      runs = [];
    };
    for (const run of inline(node)) {
      if (run.imageNode) { flush(); output.push(run.imageNode); }
      else runs.push(run);
    }
    flush();
    return output;
  }

  function blocks(parent) {
    const output = [];
    let pending = [];
    const flush = () => {
      if (pending.some((node) => node.nodeType !== 3 || node.textContent.trim())) {
        output.push(...paragraph({ nodeType: 1, childNodes: pending, tagName: 'P', matches: () => false }));
      }
      pending = [];
    };
    for (const node of parent.childNodes) {
      if (node.nodeType !== 1 || !/^(H[1-6]|P|DIV|SECTION|ARTICLE|DETAILS|UL|OL|TABLE|PRE|BLOCKQUOTE|HR)$/.test(node.tagName)) {
        pending.push(node);
        continue;
      }
      flush();
      const tag = node.tagName;
      if (/^H[1-6]$/.test(tag)) {
        output.push(...paragraph(node, {
          fontSize: [23, 18, 15, 13, 12, 11][Number(tag[1]) - 1], bold: true,
          margin: [0, 12, 0, 8], headlineLevel: Number(tag[1]),
        }));
      } else if (tag === 'UL' || tag === 'OL') {
        const items = [...node.children].filter((item) => item.tagName === 'LI').map((item) => ({ stack: blocks(item) }));
        if (items.length) output.push({
          [tag === 'UL' ? 'ul' : 'ol']: items, margin: [0, 0, 0, 8],
          start: Math.max(1, Number.parseInt(node.getAttribute('start'), 10) || 1),
        });
      } else if (tag === 'TABLE') {
        const rows = [...node.rows];
        const columns = Math.max(1, ...rows.map((row) => row.cells.length));
        const body = rows.map((row) => {
          const cells = [...row.cells].map((cell) => ({
            stack: blocks(cell), bold: cell.tagName === 'TH', wordBreak: 'break-all',
            fillColor: cell.tagName === 'TH' ? '#f6f8fa' : null,
            alignment: ['left', 'center', 'right'].includes(cell.getAttribute('align')) ? cell.getAttribute('align') : 'left',
            margin: [0, 3, 0, 0],
          }));
          while (cells.length < columns) cells.push({ text: '' });
          return cells;
        });
        if (body.length) output.push({
          table: {
            headerRows: [...rows[0].cells].every((cell) => cell.tagName === 'TH') ? 1 : 0,
            widths: Array(columns).fill(Math.max(1, (CONTENT_WIDTH - (columns + 1) * 0.5) / columns - 8)),
            body,
          },
          fontSize: 9, margin: [0, 0, 0, 12],
          layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#d1d9e0', vLineColor: () => '#d1d9e0' },
        });
      } else if (tag === 'PRE') {
        output.push({
          text: node.textContent.replace(/\t/g, '    '), wordBreak: 'break-all',
          fontSize: 9, lineHeight: 1.3, background: '#f6f8fa',
          preserveLeadingSpaces: true, preserveTrailingSpaces: true,
          margin: [8, 5, 8, 12],
        });
      } else if (tag === 'BLOCKQUOTE') {
        output.push({ stack: blocks(node), color: '#59636e', margin: [14, 0, 0, 8] });
      } else if (tag === 'HR') {
        output.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.5, lineColor: '#d1d9e0' }], margin: [0, 6, 0, 12] });
      } else if (['DIV', 'SECTION', 'ARTICLE', 'DETAILS'].includes(tag)) {
        if (!node.matches('.mdp-code-head, .mdp-task-box')) output.push(...blocks(node));
      } else output.push(...paragraph(node));
    }
    flush();
    return output;
  }

  return {
    pageSize: 'A4', pageMargins: [MARGIN, MARGIN, MARGIN, MARGIN],
    info: { title: name, creator: 'Markdown 预览' },
    defaultStyle: { font: 'NotoSansSC', fontSize: 11, lineHeight: 1.35, color: '#1f2328' },
    content: blocks(root),
    pageBreakBefore(node, container) {
      return Boolean(node.headlineLevel && !container.getFollowingNodesOnPage().length && container.getNodesOnNextPage().length);
    },
  };
}
