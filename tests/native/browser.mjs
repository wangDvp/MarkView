// Real Chrome -> worker -> Native Messaging -> disk regression, without file chooser mocks.
// Usage: npm run test:native:browser
// Requires agent-browser / Chrome for Testing. Creates and cleans its own temporary profile, host and fixtures.
// Writes no registration to the normal Chrome profile. Closes only its named test session.
// --workspace-fixtures exercises macOS Downloads access; --diagnose-permissions records only
// a denied syscall's errno/filename in the temporary helper copy, never document data or credentials.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const extensionName = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')).name;
const temporary = await fs.mkdtemp('/private/tmp/markview-native-browser-');
const session = `markview-native-${path.basename(temporary).split('-').at(-1).toLowerCase()}`;
const profile = path.join(temporary, 'profile');
const helper = path.join(temporary, 'helper');
const workspaceFixtures = process.argv.includes('--workspace-fixtures');
const diagnosePermissions = process.argv.includes('--diagnose-permissions');
if (workspaceFixtures) await fs.mkdir(path.join(root, 'tests/artifacts'), { recursive: true });
const fixtures = workspaceFixtures
  ? await fs.mkdtemp(path.join(root, 'tests/artifacts/native-permission-'))
  : temporary;
let id;
let launcher;
function execute(binary, args, input) {
  const result = spawnSync(binary, args, { encoding: 'utf8', input, maxBuffer: 1024 * 1024, timeout: 40000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Command failed: ${binary}`);
  return result.stdout.trim();
}
const cli = (...args) => execute('agent-browser', ['--session', session, ...args]);
const evaluate = (input) => execute('agent-browser', ['--session', session, 'eval', '--stdin'], input);
const shadow = 'document.querySelector("#__mdp_overlay__")?.shadowRoot';
function click(label) {
  const snapshot = cli('snapshot', '-i');
  const ref = [...snapshot.matchAll(/button "([^"]+)" \[ref=(e\d+)\]/g)].find((match) => match[1] === label)?.[2];
  assert.ok(ref, label);
  cli('click', `@${ref}`);
}
function fill(value) {
  const ref = cli('snapshot', '-i').match(/textbox "Markdown 源码" \[ref=(e\d+)\]/)?.[1];
  assert.ok(ref);
  cli('fill', `@${ref}`, value);
}
function editorState() { return JSON.parse(evaluate(`(()=>{const root=${shadow};return {editing:root.querySelector('.mdp-app').classList.contains('mdp-is-editing'),notice:root.querySelector('.mdp-editor-notice').textContent,status:root.querySelector('.mdp-save-status').textContent,meta:root.querySelector('.mdp-meta').textContent};})()`)); }
function edit() {
  click('编辑');
  cli('wait', '--fn', `!${shadow}?.querySelector('[data-action=edit]').disabled`);
  const state=editorState(); assert.ok(state.editing, JSON.stringify(state));
}
function saved() {
  cli('wait', '--fn', `!${shadow}?.querySelector('[data-action=save]').disabled`);
  const state=editorState(); assert.equal(state.status, '已保存', JSON.stringify(state));
}
function open(file) {
  cli('open', pathToFileURL(file).href);
  cli('wait', '--fn', `!!${shadow}?.querySelector('.mdp-markdown')`);
}
const file = path.join(fixtures, '中文 空格 # 本地文件.md');
const utf16 = path.join(fixtures, 'UTF16.markdown');
let browserStarted = false;
try {
  browserStarted = true;
  cli('--profile', profile, '--extension', root, '--headed', 'open', 'chrome://extensions');
  const ids = JSON.parse(evaluate(`chrome.developerPrivate.getExtensionsInfo({includeDisabled:true}).then(items=>items.filter(item=>item.name===${JSON.stringify(extensionName)}).map(item=>item.id))`));
  assert.equal(ids.length, 1, 'Exactly one copy of the extension must be loaded');
  [id] = ids;
  assert.match(id, /^[a-p]{32}$/);
  execute('python3', [path.join(root, 'native/install.py'), '--extension-id', id, '--install-dir', helper,
    '--manifest-dir', path.join(profile, 'NativeMessagingHosts')]);
  launcher = JSON.parse(await fs.readFile(path.join(profile, 'NativeMessagingHosts/com.markview.local_save.json'), 'utf8')).path;
  if (diagnosePermissions) {
    const source = await fs.readFile(path.join(helper, 'save_host.py'), 'utf8');
    const instrumented = source.replace('except PermissionError:\n', `except PermissionError as error:
        Path(__file__).with_name("permission-probe.json").write_text(json.dumps({"errno": error.errno, "filename": str(error.filename)}))
`);
    assert.notEqual(source, instrumented, 'Permission probe must match the temporary helper');
    await fs.writeFile(path.join(helper, 'save_host.py'), instrumented);
  }
  await fs.writeFile(file, '# 原始正文\r\n\r\n本地文件。\r\n', { mode: 0o640 });
  evaluate(`new Promise((resolve,reject)=>chrome.developerPrivate.updateExtensionConfiguration({extensionId:'${id}',fileAccess:true},()=>chrome.runtime.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve(true)))`);
  open(file);
  edit();
  assert.ok((await fs.readFile(file, 'utf8')).includes('原始正文'), 'Entering edit must not write');
  fill('# 点击保存直接覆盖\n\n无需再次选文件。');
  click('保存'); saved();
  assert.equal(await fs.readFile(file, 'utf8'), '# 点击保存直接覆盖\r\n\r\n无需再次选文件。');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
  console.log('PASS native full chain writes the exact Unicode/space/# path without a file chooser');
  fill('# 快捷键第二次保存');
  cli('press', 'Control+s'); saved();
  assert.equal(await fs.readFile(file, 'utf8'), '# 快捷键第二次保存');
  open(file);
  assert.equal(evaluate(`${shadow}.querySelector('.mdp-markdown h1').textContent`), '"快捷键第二次保存"');
  edit();
  fill('# 不得覆盖外部修改');
  await fs.writeFile(file, '# 外部程序修改');
  click('保存');
  cli('wait', '--fn', `${shadow}?.querySelector('.mdp-editor-notice').textContent.includes('其他程序')`);
  assert.equal(await fs.readFile(file, 'utf8'), '# 外部程序修改');
  assert.equal(evaluate(`${shadow}.querySelector('.mdp-save-status').textContent`), '"未保存"');
  console.log('PASS shortcut persistence, refresh readback and real external-edit conflict protection');
  // Moving to another fixture uses the browser's ordinary discard confirmation.
  await fs.writeFile(utf16, Buffer.concat([Buffer.from([255, 254]), Buffer.from('# UTF16 原文\r\n', 'utf16le')]));
  open(utf16);
  const unchanged = await fs.readFile(utf16);
  click('保存'); saved();
  assert.deepEqual(await fs.readFile(utf16), unchanged, 'Saving pure preview must preserve original encoding');
  edit();
  fill('# UTF16 写回\n'); click('保存'); saved();
  assert.deepEqual(await fs.readFile(utf16), Buffer.concat([Buffer.from([255, 254]), Buffer.from('# UTF16 写回\r\n', 'utf16le')]));
  console.log('PASS real native save preserves UTF-16 BOM and CRLF');
  fill('# 助手故障时保留草稿');
  await fs.rename(launcher, launcher + '.off');
  click('保存');
  cli('wait', '--fn', `${shadow}?.querySelector('.mdp-editor-notice').textContent.includes('未连接')`);
  assert.equal(evaluate(`${shadow}.querySelector('.mdp-save-status').textContent`), '"未保存"');
  assert.ok((await fs.readFile(utf16)).includes(Buffer.from('UTF16 写回', 'utf16le')));
  await fs.rename(launcher + '.off', launcher);
  click('保存'); saved();
  assert.ok((await fs.readFile(utf16)).includes(Buffer.from('助手故障时保留草稿', 'utf16le')));
  console.log('PASS native host failure preserves draft and retry succeeds');
} finally {
  if (diagnosePermissions) {
    try { console.log('Permission probe:', await fs.readFile(path.join(helper, 'permission-probe.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (browserStarted) { try { cli('close'); } catch { /* Launch may have failed before a browser existed. */ } }
  if (fixtures !== temporary) await fs.rm(fixtures, { recursive: true, force: true });
  await fs.rm(temporary, { recursive: true, force: true });
}
