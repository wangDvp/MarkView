// Targeted real-browser regression. No build, native helper or normal Chrome changes.
// Usage: node tests/mermaid.mjs [--artifacts DIR]
// Requires agent-browser / Chrome for Testing. Own profile and loopback server are
// closed in finally. Downloads/screenshots remain in tests/artifacts/mermaid.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const extensionArg = process.argv.indexOf('--extension');
const extension = extensionArg >= 0 ? path.resolve(process.argv[extensionArg + 1]) : root;
const artifactArg = process.argv.indexOf('--artifacts');
const artifacts = artifactArg >= 0 ? path.resolve(process.argv[artifactArg + 1]) : path.join(root, 'tests/artifacts/mermaid');
await fs.mkdir(artifacts, { recursive: true });
const temporary = await fs.mkdtemp('/private/tmp/markview-mermaid-');
const session = `markview-mermaid-${path.basename(temporary).split('-').at(-1).toLowerCase()}`;
const cli = async (...args) => (await execute('agent-browser', ['--session', session, ...args], {
  maxBuffer: 2 * 1024 * 1024, timeout: 45000,
})).stdout.trim();
const evaluate = async (source) => JSON.parse(await cli('eval', '-b', Buffer.from(source).toString('base64')));
async function button(label, action = 'click', target) {
  const snapshot = await cli('snapshot', '-i');
  const ref = [...snapshot.matchAll(/button "([^"]+)" \[ref=(e\d+)\]/g)].find((match) => match[1] === label)?.[2];
  assert.ok(ref, `${label}: ${snapshot}`);
  return cli(action, `@${ref}`, ...(target ? [target] : []));
}
let started = false;
let server;
try {
  started = true;
  await cli('--profile', path.join(temporary, 'profile'), '--extension', extension, '--headed', 'open', 'chrome://extensions');
  const name = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')).name;
  const ids = await evaluate(`chrome.developerPrivate.getExtensionsInfo({includeDisabled:true}).then(items=>items.filter(item=>item.name===${JSON.stringify(name)}).map(item=>item.id))`);
  assert.equal(ids.length, 1);
  const [id] = ids;
  await evaluate(`new Promise((resolve,reject)=>chrome.developerPrivate.updateExtensionConfiguration({extensionId:'${id}',fileAccess:true},()=>chrome.runtime.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve(true)))`);
  await cli('open', `chrome-extension://${id}/preview.html`);
  await cli('upload', '#fileInput', path.join(root, 'tests/fixtures/sample.md'));
  await cli('wait', '--fn', '!!document.querySelector("#content .mdp-markdown")');
  assert.equal(await evaluate('performance.getEntriesByType("resource").some(e=>e.name.includes("mermaid"))'), false);
  console.log('PASS ordinary Markdown does not load Mermaid');
  await cli('set','offline','on');
  await cli('upload', '#fileInput', path.join(root, 'tests/fixtures/mermaid.md'));
  await cli('wait', '--fn', 'document.querySelectorAll("[data-mdp-diagram-state]").length===2');
  const state = await evaluate(`Array.from(document.querySelectorAll('[data-mdp-mermaid]')).map(w=>({state:w.dataset.mdpDiagramState,text:w.querySelector('.mdp-diagram-view')?.shadowRoot.textContent,status:w.querySelector('.mdp-diagram-status')?.textContent,hidden:w.querySelector('pre').hidden}))`);
  assert.deepEqual(state.map(s => s.state), ['ready', 'ready'], JSON.stringify(state));
  assert.ok(state[0].text.includes('保存并导出') && state[1].text.includes('更新预览'));
  assert.ok(state.every(s=>s.hidden));
  assert.equal(await evaluate('!!document.querySelector("code.language-javascript.hljs")'), true);
  console.log('PASS Chinese flowchart / sequence diagram and normal highlighting');
  await cli('screenshot', path.join(artifacts, 'preview.png'));
  await button('下载 Word', 'download', path.join(artifacts, 'mermaid.docx'));
  await button('下载 PDF', 'download', path.join(artifacts, 'mermaid.pdf'));
  assert.equal(await evaluate('document.querySelector(".mdp-editor-notice").textContent'), 'PDF 已发起下载。');
  console.log('PASS actual Word/PDF downloads complete without diagram/image fallback');

  // Exercise the live editor and real browser file IO. Only the picker is
  // replaced with a handle in this disposable profile's OPFS sandbox.
  await evaluate(`(async()=>{
    const dir=await navigator.storage.getDirectory();
    const handle=await dir.getFileHandle('mermaid.md',{create:true});
    const stream=await handle.createWritable();
    await stream.write(document.querySelector('.mdp-editor').value);await stream.close();
    window.__mermaidHandle=handle;
    window.showOpenFilePicker=async()=>[handle];return true;
  })()`);
  await button('编辑');
  await cli('wait', '--fn', 'document.querySelector("#app").classList.contains("mdp-is-editing")');
  const broken = '# 语法错误\n\n```mermaid\nflowchart LR\n A[\n```\n\n正文继续显示。';
  const valid = '# 更新后\n\n```mermaid\nflowchart LR\n A[实时更新] --> B[确认保存]\n```';
  async function fill(markdown) {
    const snapshot = await cli('snapshot', '-i');
    const ref = snapshot.match(/textbox "Markdown 源码" \[ref=(e\d+)\]/)?.[1];
    assert.ok(ref, snapshot);
    await cli('fill', `@${ref}`, markdown);
  }
  await fill(broken);
  await cli('wait', '--fn', 'document.querySelector("[data-mdp-diagram-state=error]")?.querySelector("pre").hidden===false');
  assert.ok(await evaluate('document.querySelector("#content").textContent.includes("正文继续显示")'));
  await button('下载 Word', 'download', path.join(artifacts, 'invalid.docx'));
  assert.ok(await evaluate('document.querySelector(".mdp-editor-notice").textContent.includes("已保留源码")'));
  await button('下载 PDF', 'download', path.join(artifacts, 'invalid.pdf'));
  await fill(valid);
  await cli('wait', '--fn', 'document.querySelector("[data-mdp-diagram-state=ready]")?.querySelector(".mdp-diagram-view").shadowRoot.textContent.includes("确认保存")');
  await button('保存');
  await cli('wait', '--fn', 'document.querySelector(".mdp-save-status").textContent==="已保存"');
  assert.equal(await evaluate('(async()=>await (await __mermaidHandle.getFile()).text())()'), valid);
  console.log('PASS invalid syntax keeps source/body, export fallback, live recovery and saved Markdown');

  // A queued old preview must never replace the newest editor revision.
  const rapid = await evaluate(`(async()=>{
    const content=document.querySelector('#content');
    const old=MDPReview.renderInto(content,'\x60\x60\x60mermaid\\nflowchart LR\\n A[旧版本] --> B[旧结束]\\n\x60\x60\x60');
    const latest=MDPReview.renderInto(content,'\x60\x60\x60mermaid\\nflowchart LR\\n A[最终版本] --> B[最终结束]\\n\x60\x60\x60');
    await Promise.all([MDPReview.whenReady(old),MDPReview.whenReady(latest)]);
    return content.querySelector('.mdp-diagram-view').shadowRoot.textContent;
  })()`);
  assert.ok(rapid.includes('最终版本') && !rapid.includes('旧版本'));

  // Start export synchronously while diagrams are still pending, then replace
  // the live preview immediately. Verify the downloaded snapshot separately.
  await evaluate(`(()=>{
    const button=document.createElement('button');button.textContent='验证即时导出';
    button.addEventListener('click',()=>{
      const content=document.querySelector('#content');
      const article=MDPReview.renderInto(content,'# 导出快照\\n\\n\x60\x60\x60mermaid\\nflowchart LR\\n A[快照图表] --> B[导出版本]\\n\x60\x60\x60');
      window.__instantState=article.querySelector('[data-mdp-mermaid]').dataset.mdpDiagramState || 'pending';
      window.__instantExport=MDPExport.word(article,'snapshot.md');
      MDPReview.renderInto(content,'# 后续编辑不混入导出');
    });document.querySelector('#fileName').replaceWith(button);return true;
  })()`);
  await button('验证即时导出', 'download', path.join(artifacts, 'snapshot.docx'));
  assert.equal(await evaluate('window.__instantState'), 'pending');
  assert.deepEqual(await evaluate('window.__instantExport'), {missingImages:0,missingDiagrams:0});
  assert.equal(await evaluate('document.querySelector("#content h1").textContent'), '后续编辑不混入导出');
  console.log('PASS latest preview wins; immediate export freezes pending diagram revision');

  const otherDiagrams = await evaluate(`(async()=>{
    const container=document.querySelector('#content');
    const cases=[
      ['classDiagram\\n User : +String name\\n User : +save()', 'User'],
      ['stateDiagram-v2\\n [*] --> Editing\\n Editing --> Preview\\n Preview --> [*]', 'Editing'],
      ['gantt\\n title 编辑计划\\n dateFormat YYYY-MM-DD\\n section 验证\\n 预览 :a1,2026-11-01,1d\\n 导出 :after a1,1d', '编辑计划'],
      ['mindmap\\n root((Markdown))\\n  编辑\\n  导出', 'Markdown'],
    ];
    const result=[];
    for(const [source,label] of cases){
      const article=MDPReview.renderInto(container,'\x60\x60\x60mermaid\\n'+source+'\\n\x60\x60\x60');
      await MDPReview.whenReady(article);
      const wrapper=article.querySelector('[data-mdp-mermaid]');
      result.push({state:wrapper.dataset.mdpDiagramState,label:!!wrapper.querySelector('.mdp-diagram-view')?.shadowRoot.textContent.includes(label)});
    }
    return result;
  })()`);
  assert.ok(otherDiagrams.every(result=>result.state==='ready'&&result.label),JSON.stringify(otherDiagrams));
  console.log('PASS offline class/state/Gantt/mindmap diagrams');

  const guarded = await evaluate(`(async()=>{
    const container=document.querySelector('#content');
    const fence=source=>'\x60\x60\x60mermaid\\n'+source+'\\n\x60\x60\x60';
    const cases=[
      '%%{init: {"securityLevel":"loose","htmlLabels":true,"flowchart":{"htmlLabels":true}}}%%\\nflowchart LR\\n A[安全标签] --> B[完成]\\n click A "javascript:window.__mermaidXss=1"',
      'flowchart LR\\n A[外部样式]\\n classDef evil fill:url(https://example.invalid/pixel);\\n class A evil',
      'flowchart LR\\n A@{img:"https://example.invalid/pixel"}',
      'flowchart LR\\n A['+'x'.repeat(50001)+']',
    ];
    const result=[];
    for(const source of cases){
      const article=MDPReview.renderInto(container,fence(source));await MDPReview.whenReady(article);
      const wrapper=article.querySelector('[data-mdp-mermaid]');
      const svg=wrapper.querySelector('.mdp-diagram-view')?.shadowRoot.querySelector('svg');
      result.push({state:wrapper.dataset.mdpDiagramState,unsafe:!!svg?.querySelector('script,foreignObject,image,a,[onclick],[onerror]'),xss:!!window.__mermaidXss});
    }
    const forged=MDPReview.renderInto(container,'<div data-mdp-mermaid><pre><code>forged</code></pre></div>');
    return {cases:result,forged:forged.querySelectorAll('[data-mdp-mermaid]').length};
  })()`);
  assert.deepEqual(guarded.cases.map(s=>s.state),['ready','error','error','error'],JSON.stringify(guarded));
  assert.ok(guarded.cases.every(s=>!s.unsafe&&!s.xss));
  assert.equal(guarded.forged,0);
  console.log('PASS strict diagram configuration, blocked external resources, size limit and unforgeable markers');
  await cli('set','offline','off');

  // Direct file:// content-script entry; no native save helper is required.
  await cli('open', new URL('fixtures/mermaid.md', import.meta.url).href);
  const shadow = 'document.querySelector("#__mdp_overlay__")?.shadowRoot';
  await cli('wait', '--fn', `${shadow}?.querySelectorAll('[data-mdp-diagram-state=ready]').length===2`);
  await button('下载 Word', 'download', path.join(artifacts, 'file.docx'));
  await button('下载 PDF', 'download', path.join(artifacts, 'file.pdf'));
  assert.equal(await evaluate(`${shadow}.querySelector('.mdp-editor-notice').textContent`), 'PDF 已发起下载。');
  console.log('PASS file:// overlay and both exports without local helper');

  // The HTTP host forbids scripts/styles and requires Trusted Types. The real
  // extension still has to render and export locally without CDN access.
  const markdown = await fs.readFile(path.join(root, 'tests/fixtures/mermaid.md'));
  server = http.createServer((request,response)=>{
    response.writeHead(200, {'content-type':'text/plain; charset=utf-8',
      'content-security-policy':"default-src 'none'; style-src 'none'; script-src 'none'; img-src 'self' data:; require-trusted-types-for 'script'"});
    response.end(markdown);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/mermaid.md`;
  await cli('open', `chrome-extension://${id}/preview.html`);
  await evaluate(`(async()=>{
    const tab=await chrome.tabs.create({url:${JSON.stringify(url)}});
    for(let i=0;i<50;i++){
      try{if((await chrome.tabs.sendMessage(tab.id,{type:'MD_TOGGLE'})).handled)return true;}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }throw new Error('content script unavailable');
  })()`);
  const tab=(await cli('tab')).split('\n').find(line=>line.includes(url))?.match(/\[(t\d+)\]/)?.[1];
  assert.ok(tab);await cli('tab',tab);
  await cli('wait', '--fn', `${shadow}?.querySelectorAll('[data-mdp-diagram-state]').length===2`);
  const csp = await evaluate(`Array.from(${shadow}.querySelectorAll('[data-mdp-mermaid]')).map(w=>({state:w.dataset.mdpDiagramState,message:w.querySelector('.mdp-diagram-status')?.textContent}))`);
  assert.deepEqual(csp.map(s=>s.state),['ready','ready'],JSON.stringify(csp));
  await cli('set','offline','on');
  await button('下载 Word', 'download', path.join(artifacts, 'csp.docx'));
  await button('下载 PDF', 'download', path.join(artifacts, 'csp.pdf'));
  assert.equal(await evaluate(`${shadow}.querySelector('.mdp-editor-notice').textContent`), 'PDF 已发起下载。');
  await cli('screenshot', path.join(artifacts, 'csp.png'));
  await cli('set','offline','off');
  console.log('PASS strict CSP / Trusted Types overlay and offline Word/PDF');
  console.log(`Artifacts: ${artifacts}`);
} catch (error) {
  if (started) {
    console.error('Browser errors:', await cli('errors').catch(() => 'unavailable'));
    await cli('screenshot', path.join(artifacts, 'failure.png')).catch(() => {});
  }
  throw error;
} finally {
  if (started) await cli('close').catch(() => {});
  if (server) await new Promise(resolve=>server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
}
