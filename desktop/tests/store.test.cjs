'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Store, scoreJob, normalizeJobUrl } = require('../store.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-store-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  return { root, dataDir, store: new Store(dataDir) };
}

function resumeFile(root, filename = 'Resume.pdf', contents = '%PDF-1.7\nExample resume test content') {
  const file = path.join(root, filename);
  fs.writeFileSync(file, contents);
  return file;
}

test('fresh state has no fabricated user data; edits persist through restart', (t) => {
  const { store, dataDir } = fixture(t);
  const first = store.getState();
  assert.equal(first.profile.fullName, '');
  assert.deepEqual(first.profile.skills, []);
  assert.deepEqual(first.jobs, []);
  store.saveProfile({ fullName: 'Example Person', skills: ['Go', 'React', 'Go'] });
  store.saveSettings({ startAtLogin: true });
  const result = store.saveJob({ title: 'Software Engineer', company: 'Example', description: 'Build React services', notes: 'Follow up Monday', url: 'https://example.com/jobs/123' });
  const restarted = new Store(dataDir);
  assert.deepEqual(restarted.getState(), result);
  assert.deepEqual(result.profile.skills, ['Go', 'React']);
  assert.equal(result.settings.startAtLogin, true);
  assert.equal(result.jobs[0].status, 'saved');
  assert.equal(result.jobs[0].resumeId, null);
  const copy = restarted.getState();
  copy.profile.fullName = 'Outside mutation';
  assert.equal(restarted.getState().profile.fullName, 'Example Person');
});

test('corrupt primary restores latest valid backup and preserves unreadable file', (t) => {
  const { store, dataDir } = fixture(t);
  const expected = store.saveProfile({ fullName: 'Recovery Example' });
  fs.writeFileSync(store.filePath, '{invalid');
  const recovered = new Store(dataDir);
  assert.deepEqual(recovered.getState(), expected);
  assert.match(recovered.recoveryMessage, /恢复/);
  const preserved = fs.readdirSync(dataDir).filter((name) => name.endsWith('.corrupt'));
  assert.equal(preserved.length, 1);
  assert.equal(fs.readFileSync(path.join(dataDir, preserved[0]), 'utf8'), '{invalid');
  assert.deepEqual(new Store(dataDir).getState(), expected);
});

test('structurally invalid primary recovers; two invalid files are preserved and reset', (t) => {
  const { store, dataDir } = fixture(t);
  const expected = store.saveProfile({ school: 'Example University' });
  fs.writeFileSync(store.filePath, JSON.stringify({ ...expected, jobs: [{ id: '../bad' }] }));
  assert.deepEqual(new Store(dataDir).getState(), expected);
  fs.writeFileSync(store.filePath, JSON.stringify({ schemaVersion: 900 }));
  fs.writeFileSync(store.backupPath, 'broken backup');
  const reset = new Store(dataDir);
  assert.equal(reset.getState().profile.school, '');
  assert.match(reset.recoveryMessage, /保留/);
  assert.equal(fs.readdirSync(dataDir).filter((name) => name.endsWith('.corrupt')).length, 3);
});

test('URL normalization removes trackers while keeping distinct ATS job identifiers', () => {
  assert.equal(normalizeJobUrl('https://jobs.example.com/apply?utm_source=email&gh_jid=123&fbclid=abc#form'), 'https://jobs.example.com/apply?gh_jid=123');
  assert.notEqual(normalizeJobUrl('https://jobs.example.com/apply?jobId=123'), normalizeJobUrl('https://jobs.example.com/apply?jobId=456'));
  assert.equal(normalizeJobUrl('https://jobs.example.com/apply?source=board&requisitionId=789'), 'https://jobs.example.com/apply?requisitionId=789&source=board');
  for (const value of ['javascript:alert(1)', 'file:///C:/secret', 'https://user:password@example.com', 'example.com']) {
    assert.throws(() => normalizeJobUrl(value));
  }
});

test('bulk imports count duplicates, retain different jobs, and reject invalid batches atomically', (t) => {
  const { store } = fixture(t);
  const result = store.importJobs('https://jobs.example.com/apply?gh_jid=1\nhttps://jobs.example.com/apply?gh_jid=1&utm_source=board\nhttps://jobs.example.com/apply?gh_jid=2');
  assert.equal(result.added, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(result.state.jobs.length, 2);
  const repeat = store.importJobs('https://jobs.example.com/apply?gh_jid=1');
  assert.equal(repeat.added, 0);
  assert.equal(repeat.duplicates, 1);
  const before = store.getState();
  assert.throws(() => store.importJobs('https://example.com/new\njavascript:bad'));
  assert.deepEqual(store.getState(), before);
  assert.throws(() => store.saveJob({ title: 'Duplicate', url: before.jobs[0].url }), /已经保存/);
});

test('editing/status/deleting jobs validate identity and status', (t) => {
  const { store, dataDir } = fixture(t);
  const original = store.saveJob({ title: 'Example Role' }).jobs[0];
  for (const status of ['applying', 'submitted', 'interview', 'rejected', 'saved']) {
    assert.equal(store.setJobStatus({ id: original.id, status }).jobs[0].status, status);
  }
  assert.throws(() => store.setJobStatus({ id: original.id, status: 'automatically-submitted' }), /状态/);
  const edited = store.saveJob({ id: original.id, title: 'Updated', notes: 'Interview scheduled' }).jobs[0];
  assert.equal(edited.createdAt, original.createdAt);
  assert.equal(edited.notes, 'Interview scheduled');
  assert.equal(store.getState().jobs.length, 1);
  assert.throws(() => store.deleteJob('../state.json'), /ID/);
  assert.equal(store.deleteJob(original.id).jobs.length, 0);
  assert.equal(new Store(dataDir).getState().jobs.length, 0);
});

test('resumes copy into managed storage and remain usable when the original is deleted', (t) => {
  const { store, root, dataDir } = fixture(t);
  const source = resumeFile(root);
  const original = fs.readFileSync(source);
  const state = store.importResume(source);
  const resume = state.resumes[0];
  const stored = store.getResumePath(resume.id);
  assert.ok(stored.startsWith(path.join(dataDir, 'resumes') + path.sep));
  assert.equal(path.basename(stored), 'Resume.pdf');
  assert.equal(path.basename(path.dirname(stored)), resume.id);
  assert.equal(resume.name, 'Resume.pdf');
  assert.equal(resume.size, original.length);
  fs.unlinkSync(source);
  assert.deepEqual(fs.readFileSync(stored), original);
  assert.deepEqual(fs.readFileSync(new Store(dataDir).getResumePath(resume.id)), original);
  assert.throws(() => store.getResumePath('../../secret'), /ID/);
});

test('resume validation rejects unsupported, empty, oversized and directory inputs', (t) => {
  const { store, root } = fixture(t);
  assert.throws(() => store.importResume(resumeFile(root, 'bad.exe')), /PDF/);
  assert.throws(() => store.importResume(resumeFile(root, 'empty.pdf', '')), /20 MB/);
  assert.throws(() => store.importResume(root), /文件/);
  const large = resumeFile(root, 'large.pdf');
  fs.truncateSync(large, 20 * 1024 * 1024 + 1);
  assert.throws(() => store.importResume(large), /20 MB/);
  assert.equal(store.getState().resumes.length, 0);
});

test('removing an assigned resume clears assignments and removes the managed file', (t) => {
  const { store, root, dataDir } = fixture(t);
  const resume = store.importResume(resumeFile(root)).resumes[0];
  const stored = store.getResumePath(resume.id);
  store.saveJob({ title: 'Role', resumeId: resume.id });
  const next = store.removeResume(resume.id);
  assert.equal(next.resumes.length, 0);
  assert.equal(next.jobs[0].resumeId, null);
  assert.equal(fs.existsSync(stored), false);
  assert.equal(fs.existsSync(path.dirname(stored)), false);
  fs.writeFileSync(store.filePath, 'broken');
  assert.deepEqual(new Store(dataDir).getState(), next);
});

test('backup roundtrip includes original resume bytes and reassigns jobs safely', (t) => {
  const { store, root } = fixture(t);
  store.saveProfile({ fullName: 'Backup Example', skills: ['Rust', '分布式系统'] });
  const source = resumeFile(root, 'CV.docx', Buffer.from([80, 75, 3, 4, 0, 255, 128, 22]));
  const resume = store.importResume(source).resumes[0];
  store.saveJob({ title: 'Engineer', resumeId: resume.id, status: 'interview', url: 'https://example.com/jobs?jobId=1' });
  const backupPath = path.join(root, 'export.jobpilot.json');
  const exported = store.exportBackup(backupPath);
  assert.equal(exported.resumes, 1);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.deepEqual(Buffer.from(backup.files[resume.id], 'base64'), fs.readFileSync(source));
  const restored = new Store(path.join(root, 'restored'));
  const result = restored.importBackup(backupPath);
  assert.equal(result.jobs[0].status, 'interview');
  assert.equal(result.profile.fullName, 'Backup Example');
  assert.notEqual(result.resumes[0].id, resume.id);
  assert.equal(result.jobs[0].resumeId, result.resumes[0].id);
  assert.deepEqual(fs.readFileSync(restored.getResumePath(result.resumes[0].id)), fs.readFileSync(source));
  assert.deepEqual(new Store(path.join(root, 'restored')).getState(), result);
});

test('invalid backup import leaves current data and files unchanged', (t) => {
  const { store, root } = fixture(t);
  const resume = store.importResume(resumeFile(root)).resumes[0];
  store.saveJob({ title: 'Preserve me', resumeId: resume.id });
  const backupPath = path.join(root, 'backup.json');
  store.exportBackup(backupPath);
  const good = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const original = store.getState();
  const originalFiles = fs.readdirSync(store.resumeDir);
  const variants = [
    (backup) => { backup.schemaVersion = 2; },
    (backup) => { backup.state.resumes[0].name = '../escape.pdf'; },
    (backup) => { backup.state.resumes[0].id = '../../../escape'; },
    (backup) => { backup.files[resume.id] = 'not-base64!!'; },
    (backup) => { backup.files[resume.id] = Buffer.from('short').toString('base64'); },
    (backup) => { backup.state.jobs[0].url = 'file:///secret'; },
    (backup) => { backup.state.jobs[0].resumeId = '00000000-0000-0000-0000-000000000000'; },
  ];
  for (const mutate of variants) {
    const invalid = structuredClone(good);
    mutate(invalid);
    fs.writeFileSync(backupPath, JSON.stringify(invalid));
    assert.throws(() => store.importBackup(backupPath));
    assert.deepEqual(store.getState(), original);
    assert.deepEqual(fs.readdirSync(store.resumeDir), originalFiles);
  }
});

test('backup import cleans staged files and preserves old state when the commit fails', (t) => {
  const { store, root, dataDir } = fixture(t);
  store.importResume(resumeFile(root));
  store.saveJob({ title: 'Keep current role' });
  const backupPath = path.join(root, 'backup.json');
  store.exportBackup(backupPath);
  const before = store.getState();
  const filesBefore = fs.readdirSync(store.resumeDir);
  store._commit = () => { throw new Error('Simulated disk failure'); };
  assert.throws(() => store.importBackup(backupPath), /disk failure/);
  assert.deepEqual(store.getState(), before);
  assert.deepEqual(new Store(dataDir).getState(), before);
  assert.deepEqual(fs.readdirSync(store.resumeDir), filesBefore);
});

test('backup cannot overwrite internal state or resume files', (t) => {
  const { store, root } = fixture(t);
  const resume = store.importResume(resumeFile(root)).resumes[0];
  const before = store.getState();
  assert.throws(() => store.exportBackup(store.filePath), /之外/);
  assert.throws(() => store.exportBackup(store.getResumePath(resume.id)), /之外/);
  assert.deepEqual(store.getState(), before);
});

test('scoring uses saved profile skills, handles punctuation/Chinese, and avoids partial words', () => {
  const result = scoreJob({ description: 'We use JavaScript, C++, Node.js and 分布式系统设计.', profile: { skills: ['Java', 'JavaScript', 'C', 'C++', 'Node.js', '分布式系统', 'Rust'] } });
  assert.equal(result.score, 57);
  assert.deepEqual(result.matched, ['JavaScript', 'C++', 'Node.js', '分布式系统']);
  assert.deepEqual(result.missing, ['Java', 'C', 'Rust']);
  assert.equal(scoreJob({ description: 'Go and Rust', profile: { skills: ['Rust'] } }).score, 100);
  assert.equal(scoreJob({ description: 'Django', profile: { skills: ['Go'] } }).score, 0);
});

test('scoring explains absent profile and job description without fabricated matches', () => {
  const noProfile = scoreJob({ description: 'React TypeScript' });
  assert.equal(noProfile.score, 0);
  assert.deepEqual(noProfile.matched, []);
  assert.match(noProfile.reasons[0], /添加技能/);
  const noText = scoreJob({ profile: { skills: ['Python'] } });
  assert.equal(noText.score, 0);
  assert.match(noText.reasons[0], /粘贴/);
});

test('backup validates Windows filenames, Unicode and traversal before touching current data', (t) => {
  const { store, root } = fixture(t);
  const resume = store.importResume(resumeFile(root, '中文简历.pdf')).resumes[0];
  assert.equal(path.basename(store.getResumePath(resume.id)), '中文简历.pdf');
  const backupPath = path.join(root, 'filenames.json');
  store.exportBackup(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const before = store.getState();
  const invalidNames = ['../escape.pdf', 'folder\\escape.pdf', 'CON.pdf', 'nul.docx', 'COM1.pdf', 'LPT².docx', 'stream:private.pdf', 'a?.pdf', 'a\u0001.pdf', '..', '.', 'resume.pdf.', 'resume.pdf ', ' 文件.pdf', '\ud800.pdf', `${'文'.repeat(90)}.pdf`];
  for (const name of invalidNames) {
    const invalid = structuredClone(backup);
    invalid.state.resumes[0].name = name;
    fs.writeFileSync(backupPath, JSON.stringify(invalid));
    assert.throws(() => store.importBackup(backupPath), undefined, name);
    assert.deepEqual(store.getState(), before);
  }
});

test('same-named resumes use separate directories and deleting one preserves the other', (t) => {
  const { store, root } = fixture(t);
  const source = resumeFile(root);
  const first = store.importResume(source).resumes[0];
  fs.writeFileSync(source, 'Updated resume content');
  const second = store.importResume(source).resumes[1];
  const firstPath = store.getResumePath(first.id);
  const secondPath = store.getResumePath(second.id);
  assert.notEqual(firstPath, secondPath);
  assert.equal(path.basename(firstPath), path.basename(secondPath));
  store.removeResume(first.id);
  assert.equal(fs.existsSync(path.dirname(firstPath)), false);
  assert.equal(fs.readFileSync(secondPath, 'utf8'), 'Updated resume content');
});
