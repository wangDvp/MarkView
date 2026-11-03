/* Offline Word and PDF downloads. DOCX is packaged as a standard ZIP file. */
(function () {
  'use strict';

  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const xml = (value) => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  function filename(name, extension) {
    const base = String(name || 'Markdown').replace(/\.(md|markdown)$/i, '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 160);
    return `${base || 'Markdown'}.${extension}`;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.documentElement.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function readImage(url) {
    const limit = 5 * 1024 * 1024;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000), credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (!response.ok || Number(response.headers.get('content-length')) > limit || !response.body) throw new Error('image size');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new Error('image size');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
  }

  const crcTable = new Uint32Array(256).map((_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    return crc >>> 0;
  });

  function zip(files) {
    const parts = [];
    const directory = [];
    let offset = 0;
    let directorySize = 0;
    for (const [path, value] of files) {
      const name = new TextEncoder().encode(path);
      const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      let crc = 0xffffffff;
      for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
      crc = (crc ^ 0xffffffff) >>> 0;
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x800, true);
      lv.setUint16(12, 33, true); // 1980-01-01, a valid DOS date.
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x800, true);
      cv.setUint16(14, 33, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);
      parts.push(local, data);
      directory.push(central);
      offset += local.length + data.length;
      directorySize += central.length;
    }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, directorySize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, end], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  async function word(article, name, options = {}) {
    // Freeze the rendered document so typing during export cannot mix revisions.
    const root = article.cloneNode(true);
    root.querySelectorAll('.mdp-code-head, .mdp-task-box').forEach((node) => node.remove());
    const files = [];
    const relations = [];
    const imageRuns = new Map();
    let missingImages = 0;
    let imageBytes = 0;
    const imageDeadline = Date.now() + 30000;
    const relationship = (type, target, external = false) => {
      const id = `rId${relations.length + 1}`;
      relations.push(`<Relationship Id="${id}" Type="${R}/${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
      return id;
    };

    for (const image of root.querySelectorAll('img')) {
      try {
        if (Date.now() > imageDeadline) throw new Error('image timeout');
        const src = new URL(image.getAttribute('src'), document.baseURI);
        if (!['https:', 'http:', 'data:', 'blob:', 'file:'].includes(src.protocol)) throw new Error('image URL');
        const blob = await readImage(src.href);
        if (blob.size > 5 * 1024 * 1024 || imageBytes + blob.size > 20 * 1024 * 1024) throw new Error('image size');
        const bitmap = await createImageBitmap(blob);
        try {
          if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16000000) throw new Error('image dimensions');
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 1600 / bitmap.width, 1600 / bitmap.height);
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (!png || imageBytes + png.size > 20 * 1024 * 1024) throw new Error('image size');
          imageBytes += png.size;
          const id = imageRuns.size + 1;
          files.push([`word/media/image${id}.png`, new Uint8Array(await png.arrayBuffer())]);
          const rid = relationship('image', `media/image${id}.png`);
          const width = Math.min(canvas.width, 600) * 9525;
          const height = Math.round(width * canvas.height / canvas.width);
          imageRuns.set(image, `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="Image ${id}" descr="${xml(image.alt || '')}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`);
        } finally { bitmap.close(); }
      } catch {
        missingImages++;
        imageRuns.set(image, run(`[图片：${image.alt || image.getAttribute('src') || '无法读取'}]`));
      }
    }

    function run(value, properties = '') {
      return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${String(value).split('\n').map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t>`).join('')}</w:r>`;
    }

    function inline(node, properties = '') {
      if (node.nodeType === Node.TEXT_NODE) return run(node.textContent, properties);
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName;
      if (tag === 'IMG') return imageRuns.get(node) || '';
      if (tag === 'BR') return '<w:r><w:br/></w:r>';
      if (tag === 'INPUT') return run(node.checked ? '☑ ' : '☐ ', properties);
      const formats = { STRONG: '<w:b/>', B: '<w:b/>', EM: '<w:i/>', I: '<w:i/>', DEL: '<w:strike/>', S: '<w:strike/>', CODE: '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:fill="F6F8FA"/>' };
      const props = properties + (formats[tag] || '');
      const children = [...node.childNodes].map((child) => inline(child, props)).join('');
      if (tag === 'A') {
        try {
          const href = new URL(node.getAttribute('href'), options.baseUrl || document.baseURI).href;
          if (/^(https?:|mailto:|file:)/i.test(href)) {
            return `<w:hyperlink r:id="${relationship('hyperlink', href, true)}">${children}</w:hyperlink>`;
          }
        } catch { /* Keep the label when a URL cannot be represented. */ }
      }
      return children;
    }

    const paragraph = (runs, properties = '') => `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${runs}</w:p>`;
    const listDefinitions = [];

    function blocks(parent, level = 0) {
      let output = '';
      for (const node of parent.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.textContent.trim()) output += paragraph(run(node.textContent));
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = node.tagName;
        if (/^H[1-6]$/.test(tag)) {
          output += paragraph(inline(node), `<w:pStyle w:val="Heading${tag[1]}"/>`);
        } else if (tag === 'UL' || tag === 'OL') {
          const id = listDefinitions.length + 1;
          const depth = Math.min(level, 8);
          const start = Math.max(1, Math.min(2147483647, Number.parseInt(node.getAttribute('start'), 10) || 1));
          listDefinitions.push({ id, depth, start, ordered: tag === 'OL' });
          for (const item of node.children) {
            if (item.tagName !== 'LI') continue;
            let numbered = false;
            let pending = '';
            const flush = () => {
              if (!pending && numbered) return;
              output += paragraph(pending, numbered ? `<w:ind w:left="${720 * (depth + 1)}"/>` : `<w:numPr><w:ilvl w:val="${depth}"/><w:numId w:val="${id}"/></w:numPr>`);
              numbered = true;
              pending = '';
            };
            for (const child of item.childNodes) {
              if (child.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes(child.tagName)) {
                flush();
                output += blocks({ childNodes: [child] }, level + 1);
              } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'P') {
                pending += inline(child);
                flush();
              } else pending += inline(child);
            }
            flush();
          }
        } else if (tag === 'TABLE') {
          const rows = [...node.rows];
          const columns = Math.max(1, ...rows.map((row) => row.cells.length));
          output += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((edge) => `<w:${edge} w:val="single" w:sz="4" w:color="D1D9E0"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${'<w:gridCol w:w="2400"/>'.repeat(columns)}</w:tblGrid>`;
          for (const row of rows) {
            output += '<w:tr>';
            for (const cell of row.cells) {
              const align = cell.getAttribute('align');
              const props = ['left', 'center', 'right'].includes(align) ? `<w:jc w:val="${align}"/>` : '';
              output += `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(5000 / columns)}" w:type="pct"/>${cell.tagName === 'TH' ? '<w:shd w:fill="F6F8FA"/>' : ''}</w:tcPr>${paragraph(inline(cell, cell.tagName === 'TH' ? '<w:b/>' : ''), props)}</w:tc>`;
            }
            output += '</w:tr>';
          }
          output += '</w:tbl>';
        } else if (tag === 'PRE') {
          output += paragraph(run(node.textContent, '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/>'), '<w:shd w:fill="F6F8FA"/><w:spacing w:after="160"/>');
        } else if (tag === 'BLOCKQUOTE') {
          output += paragraph(inline(node), '<w:ind w:left="480"/><w:pBdr><w:left w:val="single" w:sz="18" w:color="D1D9E0"/></w:pBdr>');
        } else if (['DIV', 'SECTION', 'ARTICLE', 'DETAILS'].includes(tag)) {
          output += blocks(node, level);
        } else if (tag === 'HR') {
          output += paragraph('', '<w:pBdr><w:bottom w:val="single" w:sz="4" w:color="D1D9E0"/></w:pBdr>');
        } else output += paragraph(inline(node));
      }
      return output;
    }

    const body = blocks(root) || '<w:p/>';
    const numbering = listDefinitions.map(({ id, depth, start, ordered }) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="${depth}"><w:start w:val="${start}"/><w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${depth + 1}.` : '•'}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${720 * (depth + 1)}"/></w:tabs><w:ind w:left="${720 * (depth + 1)}" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>`).join('') + listDefinitions.map(({ id }) => `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join('');
    relationship('styles', 'styles.xml');
    relationship('numbering', 'numbering.xml');
    files.push(
      ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${['document', 'styles', 'numbering'].map((part) => `<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${part === 'document' ? 'document.main' : part}+xml"/>`).join('')}</Types>`],
      ['_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`],
      ['word/_rels/document.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`],
      ['word/document.xml', `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`],
      ['word/numbering.xml', `${XML}<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`],
      ['word/styles.xml', `${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${[1, 2, 3, 4, 5, 6].map((level) => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="160"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[40, 32, 28, 26, 24, 22][level - 1]}"/></w:rPr></w:style>`).join('')}</w:styles>`],
    );
    download(zip(files), filename(name, 'docx'));
    return { missingImages };
  }

  async function pdf({ article, name, options = {} }) {
    // Freeze before loading the engine/fonts so edits cannot mix export revisions.
    const root = article.cloneNode(true);
    root.querySelectorAll('.mdp-code-head, .mdp-task-box').forEach((node) => node.remove());
    const { generate } = await import(chrome.runtime.getURL('pdf-export.js'));
    const result = await generate(root, name, options, readImage);
    download(result.blob, filename(name, 'pdf'));
    return { missingImages: result.missingImages };
  }

  globalThis.MDPExport = Object.freeze({ word, pdf, download, filename });
})();
