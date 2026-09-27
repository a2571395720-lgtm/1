const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('offline workspace supports profile, managed resumes, queue, backups and restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-workspace-e2e-'));
  const resume = path.join(root, '测试简历.pdf');
  const backup = path.join(root, 'backup.json');
  fs.writeFileSync(resume, '%PDF-1.4\nSynthetic fixture resume only\n%%EOF');
  const env = { ...process.env, JOBPILOT_TEST_DATA_DIR: path.join(root, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = { env, ...(process.env.JOBPILOT_EXECUTABLE ? { executablePath: process.env.JOBPILOT_EXECUTABLE, args: [] } : { args: [path.resolve(__dirname, '..')] }) };
  let app;
  const errors = [];
  try {
    app = await electron.launch(options);
    let page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('#loading-state')).toBeHidden();
    await expect(page.locator('#stat-saved')).toHaveText('0');
    const shots = path.resolve(__dirname, '../../artifacts/desktop-qa');
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'first-launch.png') });

    await page.locator('.nav-item[data-page=profile]').click();
    await page.locator('[name=fullName]').fill('测试候选人');
    await page.locator('[name=email]').fill('candidate@example.test');
    await page.locator('[name=skills]').fill('Java, React, Python');
    await page.locator('[name=preferredLocations]').fill('Shanghai, Syracuse');
    await page.locator('[name=workModes][value=Remote]').check();
    await page.locator('#save-profile').click();
    await expect(page.locator('#toast-region')).toContainText('个人档案已保存');

    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, resume);
    await page.locator('.nav-item[data-page=materials]').click();
    await page.locator('#import-resume').click();
    await expect(page.locator('.resume-card')).toContainText('测试简历.pdf');
    fs.unlinkSync(resume); // Uploaded copies must survive removal of the source.

    await page.locator('.nav-item[data-page=jobs]').click();
    await page.locator('#page-jobs [data-action=add-job]').click();
    const form = page.locator('#new-job-form');
    await form.locator('[name=title]').fill('Frontend Engineer');
    await form.locator('[name=company]').fill('Example Company');
    await form.locator('[name=url]').fill('https://example.test/jobs/1');
    await form.locator('[name=description]').fill('Build React applications and Java backend services.');
    await form.locator('[type=submit]').click();
    await expect(page.locator('#job-drawer')).toBeVisible();
    await expect(page.locator('#match-score')).toHaveText('67%');
    await page.locator('#edit-job-form [name=notes]').fill('跟进招聘联系人');
    await page.locator('#edit-job-form [name=status]').selectOption('applying');
    await page.locator('#edit-job-form [type=submit]').click();
    await expect(page.locator('#toast-region')).toContainText('职位修改已保存');
    await page.locator('#close-drawer').click();

    await page.locator('#bulk-import-open').click();
    await page.locator('#bulk-urls').fill('https://example.test/jobs/1?utm_source=test\nhttps://example.test/jobs/2');
    await page.locator('#bulk-import-form [type=submit]').click();
    await expect(page.locator('#job-result-count')).toHaveText('2 个职位');
    await expect(page.locator('#toast-region')).toContainText('跳过 1 个重复链接');
    await page.locator('#job-filter').selectOption('applying');
    await expect(page.locator('#jobs-list .job-row')).toHaveCount(1);
    await page.locator('#job-search').fill('跟进招聘联系人');
    await expect(page.locator('#jobs-list .job-row')).toHaveCount(1);
    await page.locator('#job-search').fill('不存在的公司');
    await expect(page.locator('#jobs-list .job-row')).toHaveCount(0);
    await page.locator('#job-search').fill('');
    await page.locator('#job-filter').selectOption('all');
    await page.screenshot({ path: path.join(shots, 'application-queue.png') });

    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, backup);
    await page.locator('.nav-item[data-page=settings]').click();
    await page.locator('#export-backup').click();
    await expect.poll(() => fs.existsSync(backup)).toBe(true);
    expect(JSON.parse(fs.readFileSync(backup, 'utf8')).state.jobs).toHaveLength(2);
    const saved = await page.evaluate(() => window.jobpilot.getState());
    expect(saved.jobs[0].resumeId).toBe(saved.resumes[0].id);
    await page.evaluate(async () => { const state = await window.jobpilot.getState(); for (const job of state.jobs) await window.jobpilot.deleteJob(job.id); });
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backup);
    await page.locator('#import-backup').click();
    await expect.poll(() => page.evaluate(async () => (await window.jobpilot.getState()).jobs.length)).toBe(2);
    await app.close(); app = null;

    app = await electron.launch(options);
    page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('#loading-state')).toBeHidden();
    await expect(page.locator('#stat-applying')).toHaveText('1');
    await expect(page.locator('#stat-submitted')).toHaveText('0');
    await page.locator('.nav-item[data-page=profile]').click();
    await expect(page.locator('[name=fullName]')).toHaveValue('测试候选人');
    await expect(page.locator('[name=skills]')).toHaveValue('Java, React, Python');
    await page.locator('.nav-item[data-page=materials]').click();
    await expect(page.locator('.resume-card')).toContainText('测试简历.pdf');
    await page.locator('.nav-item[data-page=overview]').click();
    await page.screenshot({ path: path.join(shots, 'workspace.png') });
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('jobpilot-workspace-e2e-')) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
