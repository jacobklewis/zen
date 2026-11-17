import { test, expect, type Page } from '@playwright/test';

async function editorWindow(page: Page, label: string) {
  await page.goto(`http://localhost:1420/tests/fixtures/menu-events.html?label=${label}`);
  await page.waitForFunction(() => (window as any).ready);
}

async function sendTo(windows: Page[], target: string, event: string, payload: string) {
  await Promise.all(windows.map(page => page.evaluate(
    ({ target, event, payload }) => (window as any).deliverTargetedEvent(target, event, payload),
    { target, event, payload },
  )));
}

for (const action of ['export-html', 'export-pdf', 'export-pdf-viewer']) {
  test(`${action} opens a save dialog only in the addressed document window`, async ({ page, context }) => {
    const second = await context.newPage();
    await editorWindow(page, 'main');
    await editorWindow(second, 'editor-1');
    await sendTo([page, second], 'editor-1', 'menu', action);
    expect(await page.evaluate(() => (window as any).saves)).toEqual([]);
    expect(await second.evaluate(() => (window as any).saves)).toEqual([`editor-1.${action === 'export-html' ? 'html' : 'pdf'}`]);
    await sendTo([page, second], 'main', 'menu', action);
    expect(await page.evaluate(() => (window as any).saves)).toHaveLength(1);
    expect(await second.evaluate(() => (window as any).saves)).toHaveLength(1);
  });
}

test('opening a recent file is restricted to its addressed window, and listeners unsubscribe', async ({ page, context }) => {
  const second = await context.newPage();
  await editorWindow(page, 'main');
  await editorWindow(second, 'editor-1');
  await sendTo([page, second], 'editor-1', 'open-file', '/documents/guide.md');
  expect(await page.evaluate(() => (window as any).opened)).toEqual([]);
  expect(await second.evaluate(() => (window as any).opened)).toEqual(['/documents/guide.md']);
  await second.evaluate(() => (window as any).unsubscribe());
  await sendTo([page, second], 'editor-1', 'menu', 'export-html');
  await sendTo([page, second], 'editor-1', 'open-file', '/documents/other.md');
  expect(await second.evaluate(() => (window as any).saves)).toEqual([]);
  expect(await second.evaluate(() => (window as any).opened)).toEqual(['/documents/guide.md']);
});
