/* Lazy offline diagrams. Rendering is serialized because Mermaid owns global state. */
import mermaid from './lib/mermaid-vendor.js';

const FONT = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
const MAX_SOURCE = 50000;
const MAX_SVG = 2 * 1024 * 1024;
const cache = new Map();
let queue = Promise.resolve();

function configure() {
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, logLevel: 5,
    theme: 'default', fontFamily: FONT, htmlLabels: false, layout: 'dagre',
    maxTextSize: MAX_SOURCE, maxEdges: 500,
    flowchart: { htmlLabels: false },
    dompurifyConfig: { FORBID_TAGS: ['foreignObject', 'image', 'img', 'a'] },
    secure: ['secure', 'securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize',
      'maxEdges', 'htmlLabels', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'dompurifyConfig'],
  });
}

function validate(source) {
  if (!source.trim() || source.length > MAX_SOURCE) throw new Error('diagram size');
  // External images, styles and icon packs are outside the offline diagram feature.
  // Decode CSS escapes before checking, so escaped external URLs cannot bypass it.
  const css = source.replace(/\\([\da-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/\\([^\n\r])/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
  const urls = [...css.matchAll(/url\s*\(([^)]*)\)/gi)];
  if (/@import\b|image-set\s*\(|\bimg\s*["']?\s*:/i.test(css) || urls.some((match) => !/^['"]?#[\w.-]+['"]?$/.test(match[1].trim()))) {
    throw new Error('external diagram resource');
  }
}

function cleanSvg(svg, purify) {
  if (svg.length > MAX_SVG) throw new Error('diagram size');
  const fragment = purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true }, RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['foreignObject', 'image', 'a', 'script', 'iframe', 'animate', 'set'],
    ALLOW_DATA_ATTR: false,
  });
  const element = fragment.querySelector('svg');
  if (!element) throw new Error('diagram SVG');
  // Mermaid styles must remain inside their generated SVG. DOMPurify does not
  // sanitize CSS; parse it before adopting it into the host document for layout.
  const id = element.id;
  if (!/^mdpgraph[\da-f]+$/.test(id)) throw new Error('diagram id');
  for (const style of element.querySelectorAll('style')) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(style.textContent);
    style.textContent = [...sheet.cssRules].filter((rule) => rule.type === CSSRule.STYLE_RULE
      && rule.selectorText.split(',').every((selector) => new RegExp(`^#${id}(?:\\s|[.:\\[>#]|$)`).test(selector.trim()))
      && !/@|url\s*\(\s*(?!#)|image-set\s*\(/i.test(rule.style.cssText)).map((rule) => rule.cssText).join('\n');
  }
  for (const node of [element, ...element.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if (/^(?:href|xlink:href)$/i.test(attribute.name) && !attribute.value.startsWith('#')) node.removeAttributeNode(attribute);
    }
  }
  const viewBox = (element.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n)) || viewBox[2] <= 0 || viewBox[3] <= 0 || viewBox[2] > 100000 || viewBox[3] > 100000) {
    throw new Error('diagram dimensions');
  }
  element.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  element.setAttribute('width', String(viewBox[2]));
  element.setAttribute('height', String(viewBox[3]));
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', 'Mermaid 图表');
  return { element, width: viewBox[2], height: viewBox[3] };
}

async function render(source, purify) {
  validate(source);
  configure();
  // getRandomValues also works on ordinary HTTP pages (randomUUID requires HTTPS).
  const id = `mdpgraph${Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, '0')).join('')}`;
  const stage = document.createElement('div');
  stage.id = `${id}stage`;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`#${stage.id}{position:fixed;left:-100000px;top:0;width:1000px;visibility:hidden;pointer-events:none;font:16px ${FONT}}`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  (document.body || document.documentElement).append(stage);
  try {
    let output = await mermaid.render(id, source, stage);
    // Constructed stylesheets also work on hosts with style-src 'none'. A second
    // pass measures text using the diagram's own CSS even if inline styles fail.
    const first = cleanSvg(output.svg, purify);
    const css = [...first.element.querySelectorAll('style')].map((node) => node.textContent).join('\n');
    sheet.replaceSync(`${sheet.cssRules[0].cssText}\n${css}`);
    output = await mermaid.render(id, source, stage);
    const { element, width, height } = cleanSvg(output.svg, purify);
    return { svg: new XMLSerializer().serializeToString(element), width, height };
  } finally {
    stage.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
  }
}

export function diagram(source, purify) {
  const existing = cache.get(source);
  if (existing) return existing;
  const pending = queue.then(() => render(source, purify));
  queue = pending.catch(() => {});
  cache.set(source, pending);
  while (cache.size > 16) cache.delete(cache.keys().next().value);
  pending.catch(() => { if (cache.get(source) === pending) cache.delete(source); });
  return pending;
}

export function mount(host, result, purify) {
  const { element } = cleanSvg(result.svg, purify);
  const css = [...element.querySelectorAll('style')].map((node) => {
    const value = node.textContent;
    node.remove();
    return value;
  }).join('\n');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`${css}\n:host{display:block;color-scheme:light}svg{display:block;width:100%;height:auto;max-width:${result.width}px;margin:auto;font-family:${FONT}}`);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.adoptedStyleSheets = [sheet];
  shadow.append(element);
}

export async function png(result) {
  // Explicit dimensions make SVG decoding independent of the preview's layout.
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('diagram image'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
  let timer;
  try {
    await Promise.race([loaded, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('diagram timeout')), 8000); })]);
    const scale = Math.min(2, 1600 / result.width, 1600 / result.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(result.width * scale));
    canvas.height = Math.max(1, Math.round(result.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    clearTimeout(timer);
    image.src = '';
  }
}
