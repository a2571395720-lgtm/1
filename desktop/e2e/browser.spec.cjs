const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const applicationForm = `<!doctype html><html><head><title>Fixture application</title></head><body>
  <h1>Apply for a fixture job</h1>
  <form id="application">
    <label>Full name<input id="fullName" name="fullName"></label>
    <label>Email<input id="email" name="email" value="existing@example.test"></label>
    <label>Phone<input id="phone" name="phone"></label>
    <label>School<input id="school" name="school"></label>
    <label>First name<input id="firstName" autocomplete="given-name"></label>
    <label>Last name<input id="lastName" autocomplete="family-name"></label>
    <label>Signature: full name<input id="signature" name="name"></label>
    <label>Work authorization<input id="authorization" name="email"></label>
    <label hidden>Full name<input id="hiddenName" name="name"></label>
    <label>Resume<input id="resume" type="file" accept=".pdf,.doc,.docx"></label>
    <label>Cover letter<input id="cover-letter" type="file" accept=".pdf"></label>
    <button id="submit" type="submit">Submit application</button>
  </form>
  <a id="local-protocol" href="jobpilot://app/index.html">Unsafe local protocol</a>
  <a id="local-file" href="file:///jobpilot-e2e-nonexistent-fixture.html">Unsafe file protocol</a>
  <script>
    window.fixture = { submissions: 0, clicks: 0, inputs: 0, changes: 0, fileChanges: 0 };
    document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); window.fixture.submissions += 1; });
    document.querySelector('#submit').addEventListener('click', () => { window.fixture.clicks += 1; });
    document.addEventListener('input', () => { window.fixture.inputs += 1; });
    document.addEventListener('change', () => { window.fixture.changes += 1; });
    document.querySelector('#resume').addEventListener('change', () => { window.fixture.fileChanges += 1; });
  </script>
</body></html>`;

const captchaForm = '<!doctype html><html><body><h1>Apply for a fixture job</h1><p>Verify you are human</p><label>Email<input id="email" name="email"></label><label>Resume<input type="file" id="resume"></label></body></html>';

// Read only the test application's remote WebContentsView. Remote pages never
// receive the privileged preload exposed in the dashboard and browser toolbar.
async function remoteEvaluate(electronApp, expression) {
  return electronApp.evaluate(({ BrowserWindow }, code) => {
    const browserWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL() === 'jobpilot://app/browser.html');
    if (!browserWindow) throw new Error('Fixture application window is missing.');
    const remoteView = browserWindow.contentView.children.find((view) => view.webContents && view.webContents !== browserWindow.webContents);
    if (!remoteView) throw new Error('Fixture application WebContentsView is missing.');
    return remoteView.webContents.executeJavaScript(code, true);
  }, expression);
}

test('application browser fills ordinary fields, attaches a chosen resume, blocks unsafe navigation and CAPTCHA', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-browser-e2e-'));
  const dataDir = path.join(temporaryRoot, 'data');
  const resumePath = path.join(temporaryRoot, 'Fixture Resume.pdf');
  const resumeContents = Buffer.from('%PDF-1.4\n% Synthetic JobPilot test resume only\n%%EOF\n');
  fs.writeFileSync(resumePath, resumeContents);
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(request.url === '/captcha' ? captchaForm : applicationForm);
  });
  let electronApp;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/apply`;
    const launchEnvironment = { ...process.env, JOBPILOT_TEST_DATA_DIR: dataDir };
    delete launchEnvironment.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({
      ...(process.env.JOBPILOT_EXECUTABLE ? { executablePath: process.env.JOBPILOT_EXECUTABLE, args: [] } : { args: [path.resolve(__dirname, '..')] }),
      env: launchEnvironment,
    });
    const dashboard = await electronApp.firstWindow();
    await dashboard.waitForFunction(() => Boolean(window.jobpilot));
    const jobId = await dashboard.evaluate(async (url) => {
      await window.jobpilot.saveProfile({ fullName: 'Fixture Candidate', email: 'new@example.test', phone: '+1 555 0100', school: 'Fixture University' });
      const state = await window.jobpilot.saveJob({ title: 'Fixture Engineer', company: 'Fixture Company', url });
      const job = state.jobs.find((item) => item.url === url);
      await window.jobpilot.openApplication(job.id);
      return job.id;
    }, fixtureUrl);
    await expect.poll(() => remoteEvaluate(electronApp, 'Boolean(window.fixture && document.readyState === "complete")')).toBe(true);

    await test.step('remote page is isolated and only ordinary empty fields are filled', async () => {
      const isolated = await remoteEvaluate(electronApp, '({ require: typeof require, process: typeof process, dashboard: typeof window.jobpilot, toolbar: typeof window.applicationBrowser })');
      expect(isolated).toEqual({ require: 'undefined', process: 'undefined', dashboard: 'undefined', toolbar: 'undefined' });
      const result = await dashboard.evaluate((id) => window.jobpilot.fillApplication(id), jobId);
      expect(result.filledCount).toBe(3);
      expect(result.sensitiveCount).toBe(2);
      const values = await remoteEvaluate(electronApp, `({ fullName: document.querySelector('#fullName').value, email: document.querySelector('#email').value, phone: document.querySelector('#phone').value, school: document.querySelector('#school').value, firstName: document.querySelector('#firstName').value, lastName: document.querySelector('#lastName').value, signature: document.querySelector('#signature').value, authorization: document.querySelector('#authorization').value, hiddenName: document.querySelector('#hiddenName').value, events: window.fixture })`);
      expect(values).toEqual({ fullName: 'Fixture Candidate', email: 'existing@example.test', phone: '+1 555 0100', school: 'Fixture University', firstName: '', lastName: '', signature: '', authorization: '', hiddenName: '', events: { submissions: 0, clicks: 0, inputs: 3, changes: 3, fileChanges: 0 } });
    });

    await test.step('native file selection and explicit confirmation attach only the selected resume', async () => {
      await electronApp.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
        dialog.showMessageBox = async () => ({ response: 1 });
      }, resumePath);
      await dashboard.evaluate(async (id) => {
        const state = await window.jobpilot.importResume();
        await window.jobpilot.saveJob({ id, resumeId: state.resumes[0].id });
      }, jobId);
      const canceled = await dashboard.evaluate((id) => window.jobpilot.attachResume(id), jobId);
      expect(canceled.attached).toBe(false);
      expect(await remoteEvaluate(electronApp, 'document.querySelector("#resume").files.length')).toBe(0);
      await electronApp.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
      const attached = await dashboard.evaluate((id) => window.jobpilot.attachResume(id), jobId);
      expect(attached.attached).toBe(true);
      await expect.poll(() => remoteEvaluate(electronApp, 'window.fixture.fileChanges')).toBe(1);
      const fileState = await remoteEvaluate(electronApp, '({ resume: Array.from(document.querySelector("#resume").files, file => ({ name: file.name, size: file.size })), cover: document.querySelector("#cover-letter").files.length, events: window.fixture })');
      expect(fileState.resume).toEqual([{ name: path.basename(resumePath), size: resumeContents.length }]);
      expect(fileState.cover).toBe(0);
      expect(fileState.events.submissions).toBe(0);
      expect(fileState.events.clicks).toBe(0);
      expect(fileState.events.fileChanges).toBe(1);
    });

    await test.step('remote pages cannot navigate into the local app or file protocol', async () => {
      await remoteEvaluate(electronApp, 'document.querySelector("#local-protocol").click(); true');
      const toolbar = electronApp.windows().find((page) => page.url() === 'jobpilot://app/browser.html');
      await expect(toolbar.locator('#result')).toContainText('无法');
      expect(await remoteEvaluate(electronApp, 'location.href')).toBe(fixtureUrl);
      await remoteEvaluate(electronApp, 'document.querySelector("#local-file").click(); true');
      expect(await remoteEvaluate(electronApp, '({ url: location.href, dashboard: typeof window.jobpilot, toolbar: typeof window.applicationBrowser, require: typeof require })'))
        .toEqual({ url: fixtureUrl, dashboard: 'undefined', toolbar: 'undefined', require: 'undefined' });
    });

    await test.step('a CAPTCHA stops filling and attachment without changing saved job status', async () => {
      await remoteEvaluate(electronApp, 'location.href = "/captcha"; true');
      await expect.poll(() => remoteEvaluate(electronApp, 'location.pathname === "/captcha" && document.readyState === "complete"')).toBe(true);
      const result = await dashboard.evaluate((id) => window.jobpilot.fillApplication(id), jobId);
      expect(result.blocked).toBe(true);
      expect(result.filledCount).toBe(0);
      expect(result.message).toContain('验证码');
      expect(await remoteEvaluate(electronApp, 'document.querySelector("#email").value')).toBe('');
      const attached = await dashboard.evaluate((id) => window.jobpilot.attachResume(id), jobId);
      expect(attached.attached).toBe(false);
      expect(attached.message).toContain('验证码');
      expect(await remoteEvaluate(electronApp, 'document.querySelector("#resume").files.length')).toBe(0);
      const state = await dashboard.evaluate(() => window.jobpilot.getState());
      expect(state.jobs.find((job) => job.id === jobId).status).toBe('saved');
    });
  } finally {
    if (electronApp) await electronApp.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    const temporaryPath = path.resolve(temporaryRoot);
    if (path.dirname(temporaryPath) === path.resolve(os.tmpdir()) && path.basename(temporaryPath).startsWith('jobpilot-browser-e2e-')) {
      fs.rmSync(temporaryPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});
