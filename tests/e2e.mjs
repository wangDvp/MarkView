import puppeteer from 'puppeteer-core';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests/fixtures');
const ARTIFACTS = path.join(ROOT, 'tests/artifacts');
const TEMP = path.join(ROOT, 'tests/.tmp');
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let checks = 0;

function check(name, condition, detail) {
  if (condition) {
    checks += 1;
    console.log(`  ✓ ${name}`);
    return;
  }
  console.error(`  ✗ ${name}`);
  if (detail !== undefined) console.error(JSON.stringify(detail, null, 2));
  throw new Error(`Check failed: ${name}`);
}

async function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cacheRoot = path.join(ROOT, '.cache/browsers/chrome');
  const entries = await fs.readdir(cacheRoot, { recursive: true, withFileTypes: true }).catch(() => []);
  const hit = entries.find((entry) => entry.isFile() && entry.name === 'Google Chrome for Testing');
  if (hit) return path.join(hit.parentPath || hit.path, hit.name);
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

async function prepareFixtures() {
  await fs.mkdir(TEMP, { recursive: true });
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await fs.mkdir(path.join(FIXTURES, 'local/pics'), { recursive: true });
  await fs.copyFile(path.join(ROOT, 'icons/icon128.png'), path.join(FIXTURES, 'local/pics/dot.png'));
  await fs.copyFile(path.join(ROOT, 'icons/icon128.png'), path.join(FIXTURES, 'pic.png'));

  await fs.writeFile(path.join(TEMP, 'invalid.txt'), '这是一个普通文本文件。\n');
  await fs.writeFile(path.join(TEMP, 'empty.md'), '');
  await fs.writeFile(
    path.join(TEMP, 'utf16.md'),
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# UTF-16 标题\n\n你好，世界。\n', 'utf16le')]),
  );
  await fs.writeFile(
    path.join(TEMP, 'bad-encoding.md'),
    Buffer.concat([Buffer.from('# 编码测试\n\n中文内容\n', 'utf8'), Buffer.from([0xff, 0xfe, 0xfd, 0x80])]),
  );
  await fs.writeFile(
    path.join(TEMP, 'large.md'),
    Buffer.concat([Buffer.from('# 大文件\n\n'), Buffer.alloc(MAX_FILE_BYTES + 1, 0x61)]),
  );
}

async function startServer(sampleBody) {
  const server = http.createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, 'http://127.0.0.1');
      if (pathname === '/sample.md' || pathname === '/csp.md') {
        const headers = {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        };
        if (pathname === '/csp.md') {
          headers['content-security-policy'] =
            "default-src 'none'; style-src 'none'; script-src 'none'; img-src 'self' data:; require-trusted-types-for 'script'";
        }
        response.writeHead(200, headers);
        response.end(sampleBody);
        return;
      }
      if (pathname === '/huge.md') {
        const body = '# 超大文件\n\n' + 'a'.repeat(5 * 1024 * 1024 + 32);
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        response.end(body);
        return;
      }
      if (pathname === '/long.md') {
        const body =
          '# 长文档\n\n' +
          Array.from({ length: 420 }, (_, index) => `第 ${index + 1} 段：滚动位置测试。`).join('\n\n');
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        response.end(body);
        return;
      }
      if (pathname === '/page.html') {
        const body = await fs.readFile(path.join(FIXTURES, 'page.html'));
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(body);
        return;
      }
      if (pathname === '/pic.png') {
        const body = await fs.readFile(path.join(FIXTURES, 'pic.png'));
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        response.end(body);
        return;
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(String(error));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  await prepareFixtures();
  const browserPath = await findBrowser();
  console.log(`Chrome: ${browserPath}`);

  const sampleBody = await fs.readFile(path.join(FIXTURES, 'sample.md'));
  const { server, baseUrl } = await startServer(sampleBody);

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: false,
    defaultViewport: { width: 1280, height: 820 },
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--disable-background-networking',
      '--disable-sync',
      '--window-size=1280,900',
      '--window-position=40,40',
    ],
  });

  let activePage = null;
  const pageErrors = [];

  try {
    const swTarget = await browser
      .waitForTarget(
        (target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
        { timeout: 20000 },
      )
      .catch(() => {
        throw new Error(
          'The extension did not load. Chrome 137+ branded builds ignore --load-extension. ' +
            'Install Chrome for Testing with: npx @puppeteer/browsers install chrome@stable --path .cache/browsers',
        );
      });
    const extensionId = new URL(swTarget.url()).host;
    const previewUrl = `chrome-extension://${extensionId}/preview.html`;
    console.log(`Extension: ${extensionId}`);

    async function swEval(fn, ...args) {
      let target = browser
        .targets()
        .find((item) => item.type() === 'service_worker' && item.url().includes('/background.js'));
      if (!target) {
        target = await browser.waitForTarget(
          (item) => item.type() === 'service_worker' && item.url().includes('/background.js'),
          { timeout: 15000 },
        );
      }
      const worker = await target.worker();
      if (!worker) throw new Error('service worker is not available');
      return worker.evaluate(fn, ...args);
    }

    async function openPage(url, initScript) {
      const page = await browser.newPage();
      page.on('pageerror', (error) => {
        pageErrors.push(`${url}: ${error.message}`);
      });
      if (initScript) await page.evaluateOnNewDocument(initScript);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.bringToFront();
      activePage = page;
      return page;
    }

    async function previewPages() {
      const pages = [];
      for (const target of browser.targets()) {
        if (target.type() !== 'page' || target.url() !== previewUrl) continue;
        const page = await target.page().catch(() => null);
        if (page && !page.isClosed()) pages.push(page);
      }
      return pages;
    }

    async function waitOverlay(page) {
      await page.waitForFunction(
        () => {
          const host = document.getElementById('__mdp_overlay__');
          if (!host || !host.shadowRoot) return false;
          const root = host.shadowRoot;
          return Boolean(root.querySelector('.mdp-markdown') || root.querySelector('.mdp-state-card'));
        },
        { timeout: 15000 },
      );
    }

    async function overlaySnapshot(page) {
      return page.evaluate(() => {
        const host = document.getElementById('__mdp_overlay__');
        const root = host ? host.shadowRoot : null;
        if (!root) return null;
        const app = root.querySelector('.mdp-app');
        const markdown = root.querySelector('.mdp-markdown');
        const images = [...root.querySelectorAll('.mdp-markdown img')].map((image) => ({
          src: image.getAttribute('src'),
          absoluteSrc: image.src,
          naturalWidth: image.naturalWidth,
          complete: image.complete,
        }));
        const codeBlocks = [...root.querySelectorAll('.mdp-code')];
        const codePres = codeBlocks.map((block) => {
          const pre = block.querySelector('pre');
          return pre ? { clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth } : null;
        });
        return {
          hostCount: document.querySelectorAll('#__mdp_overlay__').length,
          filename: root.querySelector('.mdp-filename')?.textContent || '',
          meta: root.querySelector('.mdp-meta')?.textContent || '',
          theme: app?.dataset.theme || '',
          background: app ? getComputedStyle(app).backgroundColor : '',
          fontSize: app ? getComputedStyle(app).fontSize : '',
          h1: root.querySelector('.mdp-markdown h1')?.textContent || '',
          text: markdown ? markdown.textContent : '',
          stateTitle: root.querySelector('.mdp-state-card h2')?.textContent || '',
          stateDescription: root.querySelector('.mdp-state-card p')?.textContent || '',
          tables: root.querySelectorAll('.mdp-markdown table').length,
          tableWraps: root.querySelectorAll('.mdp-markdown .mdp-table-wrap > table').length,
          taskItems: root.querySelectorAll('.mdp-markdown li.mdp-task').length,
          checkedTasks: root.querySelectorAll('.mdp-markdown input[type="checkbox"]:checked').length,
          disabledTasks: [...root.querySelectorAll('.mdp-markdown input[type="checkbox"]')].every(
            (input) => input.disabled,
          ),
          taskBoxes: root.querySelectorAll('.mdp-task-box').length,
          checkedTaskBoxes: root.querySelectorAll('.mdp-task-box.is-checked').length,
          rightAlignedCell: (() => {
            const cell = root.querySelector('.mdp-markdown td[align="right"]');
            return cell ? getComputedStyle(cell).textAlign : '';
          })(),
          codeBlocks: codeBlocks.length,
          codePres,
          copyButtons: root.querySelectorAll('.mdp-copy-btn').length,
          highlightedSpans: root.querySelectorAll('.mdp-markdown code.hljs span').length,
          images,
          scripts: root.querySelectorAll('script, iframe, object, embed').length,
          eventAttributes: [...root.querySelectorAll('*')].flatMap((element) =>
            [...element.attributes].filter((attribute) => /^on/i.test(attribute.name)).map((attribute) => attribute.name),
          ).length,
          javascriptLinks: [...root.querySelectorAll('a')].filter((anchor) =>
            (anchor.getAttribute('href') || '').toLowerCase().startsWith('javascript:'),
          ).length,
          externalTarget: root.querySelector('.mdp-markdown a[href^="https://example.com"]')?.getAttribute('target') || '',
          xss: window.__mdpXss,
          overflow: document.documentElement.style.overflow,
          closeButton: Boolean(root.querySelector('[data-mdp="close"]')),
          stageScrollTop: root.querySelector('.mdp-stage')?.scrollTop || 0,
        };
      });
    }

    async function waitForOverlayClosed(page) {
      await page.waitForFunction(
        () => !document.getElementById('__mdp_overlay__'),
        { timeout: 5000 },
      );
    }

    async function previewSnapshot(page) {
      return page.evaluate(() => {
        const app = document.getElementById('app');
        const content = document.getElementById('content');
        const panel = document.getElementById('statePanel');
        const doc = document.getElementById('doc');
        const warning = document.getElementById('warning');
        return {
          docVisible: !doc.hidden,
          stateVisible: !panel.hidden,
          stateTitle: panel.querySelector('.mdp-state-card h2')?.textContent || '',
          stateDescription: panel.querySelector('.mdp-state-card p')?.textContent || '',
          filename: document.getElementById('fileName').textContent,
          meta: document.getElementById('fileMeta').textContent,
          title: document.title,
          h1: content.querySelector('h1')?.textContent || '',
          text: content.textContent || '',
          articleCount: content.querySelectorAll('article').length,
          tableWraps: content.querySelectorAll('.mdp-table-wrap').length,
          taskItems: content.querySelectorAll('li.mdp-task').length,
          checkedTasks: content.querySelectorAll('input[type="checkbox"]:checked').length,
          taskBoxes: content.querySelectorAll('.mdp-task-box').length,
          checkedTaskBoxes: content.querySelectorAll('.mdp-task-box.is-checked').length,
          rightAlignedCell: (() => {
            const cell = content.querySelector('td[align="right"]');
            return cell ? getComputedStyle(cell).textAlign : '';
          })(),
          codeBlocks: content.querySelectorAll('.mdp-code').length,
          copyButtons: content.querySelectorAll('.mdp-copy-btn').length,
          highlightedSpans: content.querySelectorAll('code.hljs span').length,
          warningVisible: !warning.hidden,
          warningText: warning.textContent,
          images: [...content.querySelectorAll('img')].map((image) => ({
            src: image.src,
            naturalWidth: image.naturalWidth,
            complete: image.complete,
          })),
          scripts: content.querySelectorAll('script, iframe').length,
          xss: window.__mdpXss,
          externalTarget: content.querySelector('a[href^="https://example.com"]')?.getAttribute('target') || '',
          theme: app.dataset.theme,
          background: getComputedStyle(app).backgroundColor,
          themeTitle: document.getElementById('themeBtn').title,
          shortcut: document.getElementById('shortcutText').textContent,
          shortcutWarning: document.getElementById('shortcutRow').classList.contains('is-warning'),
        };
      });
    }

    async function uploadAndWait(page, files) {
      const input = await page.$('#fileInput');
      await input.uploadFile(...files);
      await page.waitForFunction(
        () => {
          const doc = document.getElementById('doc');
          const panel = document.getElementById('statePanel');
          return (
            (!doc.hidden && Boolean(doc.querySelector('.mdp-markdown'))) ||
            (!panel.hidden && Boolean(panel.querySelector('.mdp-state-card')))
          );
        },
        { timeout: 15000 },
      );
      await sleep(120);
    }

    // ---------------------------------------------------------------------
    console.log('\n[1] Manifest, command registration');
    const commands = await swEval(() => chrome.commands.getAll());
    const toggleCommand = commands.find((command) => command.name === 'toggle-preview');
    check('Ctrl+M command is registered', Boolean(toggleCommand && toggleCommand.shortcut), toggleCommand);
    check(
      'Ctrl+M shortcut uses the M key',
      toggleCommand && /M/i.test(toggleCommand.shortcut),
      toggleCommand,
    );
    const manifest = await swEval(() => chrome.runtime.getManifest());
    check('manifest is MV3', manifest.manifest_version === 3);
    check('only storage permission requested', JSON.stringify(manifest.permissions) === JSON.stringify(['storage']));

    // ---------------------------------------------------------------------
    console.log('\n[2] In-page overlay on a text/markdown URL (with query string)');
    const mdPage = await openPage(`${baseUrl}/sample.md?from=test`);
    await sleep(600);
    check(
      'remote Markdown does not auto-preview',
      (await mdPage.evaluate(() => !document.getElementById('__mdp_overlay__'))) === true,
    );
    await swEval(() => togglePreview());
    await waitOverlay(mdPage);

    await mdPage.evaluate(() => {
      const root = document.getElementById('__mdp_overlay__').shadowRoot;
      const image = root.querySelector('.mdp-markdown img[src*="pic.png"]');
      if (image) image.scrollIntoView({ block: 'center' });
    });
    await mdPage.waitForFunction(
      () => {
        const root = document.getElementById('__mdp_overlay__').shadowRoot;
        const image = root.querySelector('.mdp-markdown img[src*="pic.png"]');
        return image && image.complete;
      },
      { timeout: 5000 },
    );

    let overlay = await overlaySnapshot(mdPage);
    check('overlay mounted exactly once', overlay.hostCount === 1, overlay);
    check('filename derived from URL', overlay.filename === 'sample.md', overlay.filename);
    check('UTF-8 content decoded', overlay.meta.includes('UTF-8'), overlay.meta);
    check('Chinese heading rendered', overlay.h1 === '中文标题：Markdown 预览', overlay.h1);
    check('Chinese body text rendered', overlay.text.includes('你好，世界'), overlay.text.slice(0, 300));
    check('table rendered and wrapped for scroll', overlay.tables === 1 && overlay.tableWraps === 1, overlay);
    check(
      'task list has one checked and one unchecked item, both disabled',
      overlay.taskItems === 2 && overlay.checkedTasks === 1 && overlay.disabledTasks,
      overlay,
    );
    check(
      'task checkboxes are visually distinct',
      overlay.taskBoxes === 2 && overlay.checkedTaskBoxes === 1,
      { taskBoxes: overlay.taskBoxes, checkedTaskBoxes: overlay.checkedTaskBoxes },
    );
    check('GFM right column alignment is honored', overlay.rightAlignedCell === 'right', overlay.rightAlignedCell);
    check('two code blocks with copy buttons', overlay.codeBlocks === 2 && overlay.copyButtons === 2, overlay);
    check('syntax highlighting applied', overlay.highlightedSpans > 5, overlay.highlightedSpans);
    check(
      'long code line overflows horizontally',
      overlay.codePres.some((pre) => pre && pre.scrollWidth > pre.clientWidth),
      overlay.codePres,
    );
    check(
      'relative image resolved and loaded',
      overlay.images.some((image) => image.absoluteSrc.endsWith('/pic.png') && image.naturalWidth === 128),
      overlay.images,
    );
    check('external links open in a new tab', overlay.externalTarget === '_blank', overlay.externalTarget);
    check(
      'markdown HTML is sanitized',
      overlay.scripts === 0 && overlay.eventAttributes === 0 && overlay.javascriptLinks === 0,
      overlay,
    );
    check('no inline script executed', overlay.xss === undefined, overlay.xss);
    check('page scroll locked while overlay open', overlay.overflow === 'hidden', overlay.overflow);
    check('close button present', overlay.closeButton);
    const systemDark = await mdPage.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    const expectedBackground = systemDark ? 'rgb(13, 17, 23)' : 'rgb(255, 255, 255)';
    check('shadow styles applied', overlay.background === expectedBackground, {
      got: overlay.background,
      expected: expectedBackground,
      theme: overlay.theme,
    });
    check('overlay resets inherited typography', overlay.fontSize === '16px', overlay.fontSize);
    const overlayCopy = await mdPage.evaluateHandle(
      () => document.getElementById('__mdp_overlay__').shadowRoot.querySelector('.mdp-copy-btn'),
    );
    await overlayCopy.asElement().click();
    await mdPage.waitForFunction(
      () => {
        const button = document
          .getElementById('__mdp_overlay__')
          .shadowRoot.querySelector('.mdp-copy-btn');
        return button && button.textContent !== '复制';
      },
      { timeout: 4000 },
    );
    const overlayCopyLabel = await mdPage.evaluate(
      () => document.getElementById('__mdp_overlay__').shadowRoot.querySelector('.mdp-copy-btn').textContent,
    );
    check('in-page copy button reports success', overlayCopyLabel === '已复制', overlayCopyLabel);

    await mdPage.evaluate(() => {
      document.getElementById('__mdp_overlay__').shadowRoot.querySelector('.mdp-stage').scrollTop = 0;
    });
    await sleep(150);
    await mdPage.screenshot({ path: path.join(ARTIFACTS, 'overlay.png') });

    const themeCycle = await mdPage.evaluate(async () => {
      const root = document.getElementById('__mdp_overlay__').shadowRoot;
      const app = root.querySelector('.mdp-app');
      const button = root.querySelector('[data-mdp="theme"]');
      const before = app.dataset.theme;
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const after = app.dataset.theme;
      while (app.dataset.theme !== 'auto') {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { before, after };
    });
    check('theme button cycles theme', themeCycle.before !== themeCycle.after, themeCycle);

    // Close through the actual command routing path.
    await swEval(() => togglePreview());
    await waitForOverlayClosed(mdPage);
    check(
      'second Ctrl+M removes the overlay',
      (await mdPage.evaluate(() => document.documentElement.style.overflow)) === '',
    );

    // Reopen and close with Escape.
    await mdPage.bringToFront();
    await swEval(() => togglePreview());
    await waitOverlay(mdPage);
    await mdPage.keyboard.press('Escape');
    await waitForOverlayClosed(mdPage);
    check('Escape closes the overlay', true);

    // Reopen and close with the in-overlay close button.
    await swEval(() => togglePreview());
    await waitOverlay(mdPage);
    await mdPage.evaluate(() => {
      const root = document.getElementById('__mdp_overlay__').shadowRoot;
      root.querySelector('[data-mdp="close"]').click();
    });
    await waitForOverlayClosed(mdPage);
    check('close button closes the overlay', true);

    // Scroll preservation.
    const scrollBefore = await mdPage.evaluate(() => {
      document.body.style.minHeight = '3200px';
      window.scrollTo(0, 620);
      return window.scrollY;
    });
    await mdPage.bringToFront();
    await swEval(() => togglePreview());
    await waitOverlay(mdPage);
    await swEval(() => togglePreview());
    await waitForOverlayClosed(mdPage);
    const scrollAfter = await mdPage.evaluate(() => window.scrollY);
    check('page scroll position is preserved', scrollBefore === 620 && scrollAfter === scrollBefore, {
      scrollBefore,
      scrollAfter,
    });

    // Repeated toggles create no duplicate DOM.
    for (let index = 0; index < 3; index += 1) {
      await mdPage.bringToFront();
      await swEval(() => togglePreview());
      await waitOverlay(mdPage);
      const count = await mdPage.evaluate(
        () => document.querySelectorAll('#__mdp_overlay__').length,
      );
      check(`toggle cycle ${index + 1}: exactly one overlay`, count === 1, count);
      await swEval(() => togglePreview());
      await waitForOverlayClosed(mdPage);
      const after = await mdPage.evaluate(
        () => document.querySelectorAll('#__mdp_overlay__').length,
      );
      check(`toggle cycle ${index + 1}: overlay fully removed`, after === 0, after);
    }

    // Tab switching keeps the overlay usable.
    await mdPage.bringToFront();
    await swEval(() => togglePreview());
    await waitOverlay(mdPage);
    const switchPage = await openPage(`${baseUrl}/page.html`);
    await mdPage.bringToFront();
    await sleep(150);
    check(
      'overlay survives tab switching',
      (await mdPage.evaluate(() => Boolean(document.getElementById('__mdp_overlay__')))) === true,
    );
    await mdPage.keyboard.press('Escape');
    await waitForOverlayClosed(mdPage);

    // Reload then toggle again.
    await mdPage.reload({ waitUntil: 'domcontentloaded' });
    await sleep(500);
    await mdPage.bringToFront();
    await swEval(() => togglePreview());
    await waitOverlay(mdPage);
    check('overlay works after page reload', true);
    await mdPage.keyboard.press('Escape');
    await waitForOverlayClosed(mdPage);

    // Oversized remote Markdown must be rejected before parsing.
    const hugePage = await openPage(`${baseUrl}/huge.md`);
    await sleep(800);
    await hugePage.bringToFront();
    await swEval(() => togglePreview());
    await waitOverlay(hugePage);
    const huge = await overlaySnapshot(hugePage);
    check('oversized remote Markdown is rejected', huge.stateTitle === '文件过大', huge);
    await hugePage.keyboard.press('Escape');
    await waitForOverlayClosed(hugePage);
    await hugePage.close();

    // ---------------------------------------------------------------------
    console.log('\n[3] Strict CSP + Trusted Types page');
    const cspPage = await openPage(`${baseUrl}/csp.md`);
    await sleep(600);
    await swEval(() => togglePreview());
    await waitOverlay(cspPage);
    const csp = await overlaySnapshot(cspPage);
    check('Markdown renders under strict CSP', csp.h1 === '中文标题：Markdown 预览', csp);
    check('sanitization still removes active content', csp.scripts === 0 && csp.xss === undefined, csp);
    check(
      'shadow stylesheet works without page style permission',
      csp.background === expectedBackground,
      csp.background,
    );
    await cspPage.keyboard.press('Escape');
    await waitForOverlayClosed(cspPage);

    // ---------------------------------------------------------------------
    console.log('\n[4] Local file:// Markdown with file URL access');
    const extensionsPage = await browser.newPage();
    await extensionsPage.goto(`chrome://extensions/?id=${extensionId}`, { waitUntil: 'domcontentloaded' });
    await sleep(1000);
    const fileAccess = await extensionsPage.evaluate(async (extId) => {
      if (typeof chrome.developerPrivate === 'undefined') return { ok: false, reason: 'no-api' };
      try {
        await new Promise((resolve, reject) => {
          chrome.developerPrivate.updateExtensionConfiguration(
            { extensionId: extId, fileAccess: true },
            () => {
              const error = chrome.runtime.lastError;
              if (error) reject(new Error(error.message));
              else resolve();
            },
          );
        });
      } catch (error) {
        return { ok: false, reason: String(error) };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      const info = await new Promise((resolve) => {
        chrome.developerPrivate.getExtensionInfo(extId, resolve);
      });
      return {
        ok: true,
        fileAccess: Boolean(info && info.fileAccess && info.fileAccess.isEnabled && info.fileAccess.isActive),
      };
    }, extensionId);
    check('file URL access can be enabled', fileAccess.ok && fileAccess.fileAccess, fileAccess);
    await extensionsPage.close();

    const filePage = await openPage(`file://${path.join(FIXTURES, 'sample.md')}`, () => {
      document.addEventListener('DOMContentLoaded', () => {
        window.__mdpDcl = {
          host: Boolean(document.getElementById('__mdp_overlay__')),
          htmlVisibility: document.documentElement.style.visibility,
          readyState: document.readyState,
        };
      });
    });
    await waitOverlay(filePage);
    const autoBoot = await filePage.evaluate(() => window.__mdpDcl || null);
    check('file auto-preview initializes before DOMContentLoaded', autoBoot && autoBoot.host === true, autoBoot);

    const fileContentType = await filePage.evaluate(() => document.contentType);
    check('local Markdown opens as a text document', /markdown|plain/.test(fileContentType), fileContentType);
    await filePage.evaluate(() => {
      const root = document.getElementById('__mdp_overlay__').shadowRoot;
      const image = root.querySelector('.mdp-markdown img');
      if (image) image.scrollIntoView({ block: 'center' });
    });
    await filePage.waitForFunction(
      () => {
        const root = document.getElementById('__mdp_overlay__').shadowRoot;
        const image = root.querySelector('.mdp-markdown img');
        return image && image.complete;
      },
      { timeout: 5000 },
    );
    const localFile = await overlaySnapshot(filePage);
    check('local file:// Markdown auto-renders without a shortcut', localFile.h1 === '中文标题：Markdown 预览', localFile);
    check(
      'sibling file:// image loads from the local folder',
      localFile.images.some(
        (image) => image.absoluteSrc.startsWith('file://') && image.naturalWidth === 128,
      ),
      localFile.images,
    );
    check('local file overlay is sanitized', localFile.scripts === 0 && localFile.xss === undefined, localFile);

    const bootState = await filePage.evaluate(() => ({
      visibility: document.documentElement.style.visibility,
      overflow: document.documentElement.style.overflow,
      hostCount: document.querySelectorAll('#__mdp_overlay__').length,
      rawTextPresent: Boolean(document.querySelector('pre') && document.querySelector('pre').textContent.includes('# 中文标题')),
    }));
    check('boot hiding does not leave the page hidden', bootState.visibility !== 'hidden', bootState);
    check('auto preview injects exactly one overlay', bootState.hostCount === 1, bootState);
    check('overlay locks page scroll while open', bootState.overflow === 'hidden', bootState);

    await filePage.bringToFront();
    await swEval(() => togglePreview());
    await waitForOverlayClosed(filePage);
    const rawAfterToggle = await filePage.evaluate(() => ({
      hostCount: document.querySelectorAll('#__mdp_overlay__').length,
      visibility: document.documentElement.style.visibility,
      overflow: document.documentElement.style.overflow,
      rawText: document.body.innerText,
    }));
    check(
      'Ctrl+M switches from preview to the original text',
      rawAfterToggle.hostCount === 0 && rawAfterToggle.rawText.includes('# 中文标题：Markdown 预览'),
      rawAfterToggle,
    );
    check(
      'closing restores scroll and visibility',
      rawAfterToggle.visibility !== 'hidden' && rawAfterToggle.overflow === '',
      rawAfterToggle,
    );
    await sleep(350);
    check(
      'overlay does not reopen by itself after closing',
      (await filePage.evaluate(() => document.querySelectorAll('#__mdp_overlay__').length)) === 0,
    );

    await swEval(() => togglePreview());
    await waitOverlay(filePage);
    check('Ctrl+M restores the rendered preview', true);

    await filePage.reload({ waitUntil: 'domcontentloaded' });
    await waitOverlay(filePage);
    const refreshedFile = await overlaySnapshot(filePage);
    check(
      'refresh automatically returns to the rendered preview',
      refreshedFile.h1 === '中文标题：Markdown 预览' && refreshedFile.hostCount === 1,
      refreshedFile,
    );

    await filePage.keyboard.press('Escape');
    await waitForOverlayClosed(filePage);
    check(
      'Escape exits auto preview and shows the original text',
      (await filePage.evaluate(() => document.body.innerText.includes('# 中文标题：Markdown 预览'))) === true,
    );

    await filePage.reload({ waitUntil: 'domcontentloaded' });
    await waitOverlay(filePage);
    await filePage.evaluate(() => {
      document.getElementById('__mdp_overlay__').shadowRoot.querySelector('[data-mdp="close"]').click();
    });
    await waitForOverlayClosed(filePage);
    check('close button exits auto preview', true);

    // ---------------------------------------------------------------------
    console.log('\n[5] Command routing: non-Markdown page, preview tab reuse, toggle off');
    check('no preview tab before routing test', (await previewPages()).length === 0);
    await switchPage.bringToFront();
    check(
      'ordinary web pages are not auto-previewed',
      (await switchPage.evaluate(() => !document.getElementById('__mdp_overlay__'))) === true,
    );
    await swEval(() => togglePreview());
    const previewTarget = await browser.waitForTarget(
      (target) => target.type() === 'page' && target.url() === previewUrl,
      { timeout: 15000 },
    );
    const routedPreview = await previewTarget.page();
    check('Ctrl+M on a normal page opens the picker tab', Boolean(routedPreview));
    await routedPreview.waitForSelector('#dropzone:not([hidden])', { timeout: 5000 });

    await swEval(() => openPreviewTab());
    await sleep(400);
    check('opening preview reuses the existing tab', (await previewPages()).length === 1);

    await routedPreview.bringToFront();
    const routedClosed = new Promise((resolve) => routedPreview.once('close', resolve));
    await swEval(() => togglePreview());
    await Promise.race([routedClosed, sleep(5000)]);
    check('Ctrl+M on the preview tab closes it', routedPreview.isClosed());

    // ---------------------------------------------------------------------
    console.log('\n[6] Standalone picker, drag/drop, files, encoding, sizes');
    const pv = await browser.newPage();
    pv.on('pageerror', (error) => pageErrors.push(`preview: ${error.message}`));
    await pv.goto(previewUrl, { waitUntil: 'domcontentloaded' });
    await pv.bringToFront();
    activePage = pv;
    await pv.waitForFunction(() => document.getElementById('themeBtn').title.includes('点击切换'), {
      timeout: 5000,
    });
    try {
      await pv.browserContext().overridePermissions(`chrome-extension://${extensionId}`, [
        'clipboard-read',
        'clipboard-write',
      ]);
    } catch (error) {
      console.warn('clipboard permission override unavailable:', error.message);
    }

    let picker = await previewSnapshot(pv);
    check('picker shows the drop zone', picker.stateVisible === false && picker.docVisible === false);
    check(
      'shortcut hint shows the bound shortcut',
      /M/i.test(picker.shortcut) && !picker.shortcutWarning,
      { shortcut: picker.shortcut, warning: picker.shortcutWarning },
    );

    await uploadAndWait(pv, [path.join(TEMP, 'invalid.txt')]);
    picker = await previewSnapshot(pv);
    check('invalid file type produces a clear error', picker.stateTitle === '不支持的文件类型', picker);

    await uploadAndWait(pv, [path.join(FIXTURES, 'sample.md')]);
    picker = await previewSnapshot(pv);
    check('standalone preview renders Markdown', picker.docVisible && picker.h1 === '中文标题：Markdown 预览', picker);
    check('standalone preview shows file name and metadata', picker.filename === 'sample.md' && /UTF-8/.test(picker.meta), {
      filename: picker.filename,
      meta: picker.meta,
    });
    check('standalone preview highlights code', picker.codeBlocks === 2 && picker.highlightedSpans > 5, picker);
    check('standalone preview sanitizes HTML', picker.scripts === 0 && picker.xss === undefined, picker);
    check('standalone preview wraps tables', picker.tableWraps === 1, picker);
    check('standalone preview renders task list', picker.taskItems === 2 && picker.checkedTasks === 1, picker);
    check(
      'standalone preview styles task checkboxes and alignment',
      picker.taskBoxes === 2 && picker.checkedTaskBoxes === 1 && picker.rightAlignedCell === 'right',
      picker,
    );
    check('standalone preview updates document title', picker.title.includes('sample.md'), picker.title);

    await pv.click('#content .mdp-copy-btn');
    await pv.waitForFunction(
      () => {
        const button = document.querySelector('#content .mdp-copy-btn');
        return button && button.textContent !== '复制';
      },
      { timeout: 4000 },
    );
    const copyLabel = await pv.$eval('#content .mdp-copy-btn', (button) => button.textContent);
    check('code copy button reports success', copyLabel === '已复制', copyLabel);
    let clipboardText = '';
    try {
      clipboardText = await pv.evaluate(() => navigator.clipboard.readText());
    } catch {
      clipboardText = '';
    }
    if (clipboardText) {
      check('clipboard receives the raw code', clipboardText.includes("const msg = '你好，世界'"), clipboardText);
    }

    await uploadAndWait(pv, [
      path.join(FIXTURES, 'local/README.md'),
      path.join(FIXTURES, 'local/pics/dot.png'),
    ]);
    await pv.evaluate(() => document.querySelector('#content img')?.scrollIntoView({ block: 'center' }));
    await pv.waitForFunction(
      () => {
        const image = document.querySelector('#content img');
        return image && image.complete;
      },
      { timeout: 5000 },
    );
    picker = await previewSnapshot(pv);
    check(
      'relative image resolves when image is selected with the Markdown',
      picker.images.some((image) => image.src.startsWith('blob:') && image.naturalWidth === 128),
      picker.images,
    );

    await pv.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['# 拖拽标题\n\n拖拽内容'], 'dropped.md', { type: 'text/markdown' }));
      window.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    });
    await pv.waitForFunction(
      () =>
        document.getElementById('fileName').textContent === 'dropped.md' &&
        !document.getElementById('doc').hidden,
      { timeout: 5000 },
    );
    picker = await previewSnapshot(pv);
    check('drag and drop renders a Markdown file', picker.h1 === '拖拽标题', picker.h1);
    check('re-render keeps a single article', picker.articleCount === 1, picker.articleCount);

    await uploadAndWait(pv, [path.join(TEMP, 'empty.md')]);
    picker = await previewSnapshot(pv);
    check('empty file shows an empty-file state', picker.stateTitle === '文件为空', picker);

    await uploadAndWait(pv, [path.join(TEMP, 'utf16.md')]);
    picker = await previewSnapshot(pv);
    check('UTF-16 file decodes correctly', picker.docVisible && picker.text.includes('你好，世界'), picker);
    check('UTF-16 encoding is reported', picker.meta.includes('UTF-16'), picker.meta);

    await uploadAndWait(pv, [path.join(TEMP, 'bad-encoding.md')]);
    picker = await previewSnapshot(pv);
    check('invalid UTF-8 bytes still render with a warning', picker.docVisible && picker.warningVisible, picker);
    check('encoding warning is shown in the header', picker.meta.includes('非 UTF-8'), picker.meta);

    await uploadAndWait(pv, [path.join(TEMP, 'large.md')]);
    picker = await previewSnapshot(pv);
    check('oversized file shows a size error', picker.stateTitle === '文件过大', picker);

    await uploadAndWait(pv, [path.join(FIXTURES, 'sample.md')]);
    picker = await previewSnapshot(pv);
    check('preview recovers after an error', picker.docVisible, picker);

    console.log('\n[7] Theme persistence');
    await pv.evaluate(() => chrome.storage.local.set({ mdTheme: 'auto' }));
    await pv.reload({ waitUntil: 'domcontentloaded' });
    await pv.waitForFunction(() => document.getElementById('themeBtn').title.includes('点击切换'), {
      timeout: 5000,
    });
    await pv.click('#themeBtn');
    await pv.waitForFunction(() => document.getElementById('app').dataset.theme === 'light', {
      timeout: 3000,
    });
    let themed = await previewSnapshot(pv);
    check('light theme applied', themed.background === 'rgb(255, 255, 255)', themed.background);
    await pv.click('#themeBtn');
    await pv.waitForFunction(() => document.getElementById('app').dataset.theme === 'dark', {
      timeout: 3000,
    });
    themed = await previewSnapshot(pv);
    check('dark theme applied', themed.background === 'rgb(13, 17, 23)', themed.background);
    await uploadAndWait(pv, [path.join(FIXTURES, 'sample.md')]);
    await pv.screenshot({ path: path.join(ARTIFACTS, 'preview-dark.png') });
    await pv.reload({ waitUntil: 'domcontentloaded' });
    await pv.waitForFunction(() => document.getElementById('app').dataset.theme === 'dark', {
      timeout: 5000,
    });
    check('theme persists across reload', true);

    const shortcutsResult = await pv.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'MD_OPEN_SHORTCUTS' }),
    );
    await sleep(500);
    console.log('  · shortcuts page response:', JSON.stringify(shortcutsResult));
    const shortcutTarget = browser
      .targets()
      .find((target) => target.type() === 'page' && target.url().startsWith('chrome://extensions/shortcuts'));
    if (shortcutTarget) {
      const shortcutPage = await shortcutTarget.page();
      await shortcutPage.bringToFront();
      await shortcutPage.close();
      await sleep(300);
      await pv.bringToFront();
    }
    check('shortcut settings entry point responds', Boolean(shortcutsResult && 'ok' in shortcutsResult), shortcutsResult);

    // Reset theme for the remaining/next runs.
    await pv.evaluate(() => chrome.storage.local.set({ mdTheme: 'auto' }));

    // ---------------------------------------------------------------------
    console.log('\n[8] Closing the standalone preview with Esc and the close button');
    await uploadAndWait(pv, [path.join(FIXTURES, 'sample.md')]);
    const pvClosed = new Promise((resolve) => pv.once('close', resolve));
    await pv.keyboard.press('Escape').catch(() => {});
    await Promise.race([pvClosed, sleep(5000)]);
    check('Escape closes the preview tab', pv.isClosed());
    await sleep(300);

    const storedAfterClose = await swEval(() => chrome.storage.session.get('previewTabId'));
    check('preview tab registry is cleared', storedAfterClose.previewTabId === undefined, storedAfterClose);

    const pv2 = await browser.newPage();
    pv2.on('pageerror', (error) => pageErrors.push(`preview2: ${error.message}`));
    await pv2.goto(previewUrl, { waitUntil: 'domcontentloaded' });
    await pv2.bringToFront();
    await pv2.waitForFunction(() => document.getElementById('themeBtn').title.includes('点击切换'), {
      timeout: 5000,
    });
    await uploadAndWait(pv2, [path.join(FIXTURES, 'sample.md')]);
    const pv2Closed = new Promise((resolve) => pv2.once('close', resolve));
    await pv2.click('#closeBtn').catch(() => {});
    await Promise.race([pv2Closed, sleep(5000)]);
    check('close button closes the preview tab', pv2.isClosed());

    // ---------------------------------------------------------------------
    console.log('\n[9] Runtime errors');
    check('no uncaught page errors', pageErrors.length === 0, pageErrors);

    console.log(`\nAll checks passed: ${checks}`);
  } catch (error) {
    console.error('\nE2E failed:', error);
    if (activePage && !activePage.isClosed()) {
      await activePage
        .screenshot({ path: path.join(ARTIFACTS, 'failure.png'), fullPage: false })
        .catch(() => {});
    }
    console.error('Open pages:', browser.pages ? (await browser.pages()).map((page) => page.url()) : 'unknown');
    if (pageErrors.length) console.error('Page errors:', pageErrors);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

main();
