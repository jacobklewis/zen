import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const markdown = `# A portable guide

Introduction with **bold text**, [a section link](#repeated), and punctuation a+b [x].

## First section

A searchable needle lives here.

- [x] Finished task
- [ ] Open task

\`\`\`javascript
const safe = "<script>not executable</script>";
console.log(safe);
\`\`\`

### Deep section

${'Long readable content with enough material for scrolling. '.repeat(90)}

## Repeated

Another needle appears here.

#### Skipped level

Inline math $E = mc^2$.

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

| Name | Value |
| --- | ---: |
| Offline | Yes |

![A tiny embedded image](${png})

## Repeated

The last needle. END OF DOCUMENT
`;

async function generate(page: Page, source = markdown): Promise<string> {
  await page.goto('http://localhost:1420/tests/fixtures/html-export.html');
  await page.waitForFunction(() => (window as any).ready);
  return page.evaluate(source => (window as any).buildExport(source), source);
}

async function openFile(page: Page, html: string) {
  const directory = await mkdtemp(join(tmpdir(), 'zen-html-test-'));
  const path = join(directory, 'document.html');
  await writeFile(path, html);
  await page.goto(pathToFileURL(path).href);
  return () => rm(directory, { recursive: true, force: true });
}

test('a real file opens offline with embedded images, math, formatting, and no app dependencies', async ({ page, context }) => {
  const html = await generate(page);
  expect(html).not.toContain('localhost:1420');
  expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
  const requests: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await context.setOffline(true);
  const cleanup = await openFile(page, html);
  try {
    await expect(page.locator('html')).toHaveClass('js');
    await expect(page.locator('article')).toContainText('END OF DOCUMENT');
    await expect(page.locator('article strong')).toContainText('bold text');
    await expect(page.locator('article table')).toContainText('Offline');
    expect(await page.locator('article input[type=checkbox]').count()).toBe(2);
    expect(await page.locator('.katex').count()).toBe(2);
    await expect.poll(() => page.locator('article img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).not.toMatch(/url\(["']?fonts\//);
    expect(await page.locator('article h2[id]').evaluateAll(nodes => nodes.map(node => node.id))).toEqual(['section-first-section', 'section-repeated', 'section-repeated-2']);
    expect(requests).toEqual([]);
  } finally { await cleanup(); }
});

test('navigation reveals nested collapsed sections and updates the active section', async ({ page }) => {
  const html = await generate(page);
  const cleanup = await openFile(page, html);
  try {
    await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
    expect(await page.locator('details.section[open]').count()).toBe(0);
    await page.getByRole('navigation').getByRole('link', { name: 'Skipped level' }).click();
    await expect(page.locator('#section-skipped-level')).toBeVisible();
    await expect(page).toHaveURL(/#section-skipped-level$/);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Skipped level' })).toHaveAttribute('aria-current', 'location');
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    expect(await page.locator('details.section:not([open])').count()).toBe(0);
    await page.locator('article a', { hasText: 'a section link' }).click();
    await expect(page).toHaveURL(/#section-repeated$/);
  } finally { await cleanup(); }
});

test('search handles literal punctuation, highlights matches, and opens hidden sections', async ({ page }) => {
  const html = await generate(page);
  const cleanup = await openFile(page, html);
  try {
    await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
    const input = page.getByRole('searchbox');
    await input.fill('needle');
    await expect(page.locator('#search-status')).toHaveText('1 / 3');
    await expect(page.locator('.search-hit.current')).toBeVisible();
    await page.getByRole('button', { name: 'Next match', exact: true }).click();
    await expect(page.locator('#search-status')).toHaveText('2 / 3');
    await expect(page.locator('.search-hit.current')).toBeVisible();
    await input.fill('with bold text');
    await expect(page.locator('#search-status')).toHaveText('1 / 1');
    await input.fill('a+b [x]');
    await expect(page.locator('#search-status')).toHaveText('1 / 1');
    await input.press('Escape');
    await expect(page.locator('.search-hit')).toHaveCount(0);
    await input.fill('absent-term');
    await expect(page.locator('#search-status')).toHaveText('No matches');
    await expect(page.getByRole('button', { name: 'Next match', exact: true })).toBeDisabled();
  } finally { await cleanup(); }
});

test('reader supports mobile layout, themes, and copying code', async ({ page }, testInfo) => {
  const html = await generate(page);
  const cleanup = await openFile(page, html);
  try {
    await page.screenshot({ path: testInfo.outputPath('reader-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('reader-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Copy code', exact: true }).click();
    await expect(page.locator('#reader-status')).toContainText(/copied|selected/i);
  } finally { await cleanup(); }
});

test('content and table of contents work with JavaScript disabled and without headings', async ({ page, browser }) => {
  const html = await generate(page, 'A simple **document** with no headings.');
  const context = await browser.newContext({ javaScriptEnabled: false });
  const reader = await context.newPage();
  const cleanup = await openFile(reader, html);
  try {
    await expect(reader.locator('article')).toContainText('A simple document');
    await expect(reader.getByRole('navigation')).toContainText('no sections');
    await expect(reader.getByRole('searchbox')).toBeHidden();
  } finally { await cleanup(); await context.close(); }
});

test('document text and links cannot inject executable markup', async ({ page }) => {
  await generate(page, 'Ready');
  const html = await page.evaluate(() => (window as any).buildFromModel({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '</summary><script>window.injected=true</script>' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Bad link', marks: [{ type: 'link', attrs: { href: 'javascript:window.injected=true' } }] }] },
    { type: 'code_block', attrs: { language: 'html' }, content: [{ type: 'text', text: '</code><img src=x onerror="window.injected=true">' }] },
  ] }));
  const cleanup = await openFile(page, html);
  try {
    expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
    await expect(page.locator('script')).toHaveCount(1);
    await expect(page.locator('article img')).toHaveCount(0);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(page.locator('article')).toContainText('<script>window.injected=true</script>');
  } finally { await cleanup(); }
});

test('missing images stop the export instead of leaving dependencies behind', async ({ page }) => {
  await expect(generate(page, '![Missing](missing.png)')).rejects.toThrow(/Could not embed image/);
});
