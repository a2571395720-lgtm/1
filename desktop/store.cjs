'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_RESUME_BYTES = 20 * 1024 * 1024;
const MAX_BACKUP_BYTES = 150 * 1024 * 1024;
const MAX_JOBS = 10000;
const MAX_RESUMES = 100;
const STATUSES = new Set(['saved', 'applying', 'submitted', 'interview', 'rejected']);
const EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);
const PROFILE_FIELDS = ['fullName', 'firstName', 'lastName', 'email', 'phone', 'location', 'school', 'degree', 'major', 'linkedin', 'github'];
const PROFILE_LISTS = ['skills', 'preferredLocations', 'workModes'];
const PROFILE_LABELS = { fullName: '姓名', firstName: '名', lastName: '姓', email: '邮箱', phone: '电话', location: '所在地', school: '学校', degree: '学位', major: '专业', linkedin: 'LinkedIn 网址', github: 'GitHub 网址', skills: '技能', preferredLocations: '期望工作地点', workModes: '工作方式' };
const clone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, field, max = 1000) {
  assert(typeof value === 'string' && value.length <= max && !value.includes('\0'), `${field}内容无效或过长。`);
  return value.trim();
}

function id(value) {
  assert(typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value), '记录 ID 无效。');
  return value;
}

function timestamp(value) {
  assert(typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)), '记录日期无效。');
  return value;
}

function normalizeJobUrl(value) {
  const input = text(value, '职位网址', 8192);
  if (!input) return '';
  let url;
  try { url = new URL(input); } catch { throw new Error('请输入包含 http:// 或 https:// 的完整职位网址。'); }
  assert(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, '职位网址必须使用 http 或 https，且不能包含登录凭据。');
  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^utm_/i.test(key) || /^(gclid|fbclid|msclkid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  }
  // Keep parameters such as gh_jid, jobId, requisitionId and source: ATS sites
  // can use arbitrary query parameters to identify a particular application.
  url.searchParams.sort();
  return url.toString();
}

function profileFrom(value) {
  assert(isObject(value), '个人档案无效。');
  const result = {};
  for (const field of PROFILE_FIELDS) result[field] = text(value[field] ?? '', PROFILE_LABELS[field], 2000);
  for (const field of PROFILE_LISTS) {
    const list = value[field] ?? [];
    assert(Array.isArray(list) && list.length <= 200, `${PROFILE_LABELS[field]}必须是列表，且不能超过 200 项。`);
    result[field] = [...new Set(list.map((entry) => text(entry, PROFILE_LABELS[field], 200)).filter(Boolean))];
  }
  return result;
}

function emptyState() {
  return { schemaVersion: 1, profile: profileFrom({}), jobs: [], resumes: [], settings: { startAtLogin: false } };
}

function resumeFilename(value) {
  assert(typeof value === 'string' && value.isWellFormed() && value.length > 0 && value.length <= 180 && Buffer.byteLength(value, 'utf8') <= 240, '简历文件名无效或过长，请缩短文件名后重试。');
  assert(!/[<>:"/\\|?*]/.test(value) && !Array.from(value).some((letter) => letter.charCodeAt(0) < 32) && !/[. ]$/.test(value) && !/^\s/.test(value), '简历文件名包含 Windows 不支持的字符。');
  assert(!/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value), '简历文件名是 Windows 保留名称，请重命名后重试。');
  assert(EXTENSIONS.has(path.extname(value).toLowerCase()), '请选择 PDF、DOC 或 DOCX 简历文件。');
  return value;
}

function validateState(value) {
  assert(isObject(value) && value.schemaVersion === 1, '数据格式无效或当前版本不支持。');
  assert(Array.isArray(value.jobs) && value.jobs.length <= MAX_JOBS, '职位数据无效或超过 10000 项。');
  assert(Array.isArray(value.resumes) && value.resumes.length <= MAX_RESUMES, '简历数据无效或超过 100 份。');
  assert(isObject(value.settings) && typeof value.settings.startAtLogin === 'boolean', '设置数据无效。');
  const profile = profileFrom(value.profile);
  const resumeIds = new Set();
  const resumes = value.resumes.map((resume) => {
    assert(isObject(resume), '简历数据无效。');
    const resumeId = id(resume.id);
    assert(!resumeIds.has(resumeId), '存在重复的简历 ID。');
    resumeIds.add(resumeId);
    const name = resumeFilename(resume.name);
    assert(Number.isSafeInteger(resume.size) && resume.size > 0 && resume.size <= MAX_RESUME_BYTES, '简历文件大小必须在 1 字节到 20 MB 之间。');
    return { id: resumeId, name, size: resume.size, addedAt: timestamp(resume.addedAt) };
  });
  const jobIds = new Set();
  const jobs = value.jobs.map((job) => {
    assert(isObject(job), '职位数据无效。');
    const jobId = id(job.id);
    assert(!jobIds.has(jobId), '存在重复的职位 ID。');
    jobIds.add(jobId);
    assert(STATUSES.has(job.status), '申请状态无效。');
    assert(job.resumeId === null || resumeIds.has(job.resumeId), '该职位选择的简历不存在。');
    return {
      id: jobId, title: text(job.title, '职位名称', 500), company: text(job.company, '公司名称', 500),
      url: normalizeJobUrl(job.url), description: text(job.description, '职位描述', 200000),
      notes: text(job.notes, '备注', 50000), status: job.status, resumeId: job.resumeId,
      createdAt: timestamp(job.createdAt), updatedAt: timestamp(job.updatedAt),
    };
  });
  return { schemaVersion: 1, profile, jobs, resumes, settings: { startAtLogin: value.settings.startAtLogin } };
}

function atomicWrite(filePath, contents) {
  const temp = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, filePath);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

class Store {
  constructor(dataDir) {
    assert(typeof dataDir === 'string' && dataDir.length > 0, '请指定数据保存目录。');
    this.dataDir = path.resolve(dataDir);
    this.filePath = path.join(this.dataDir, 'state.json');
    this.backupPath = path.join(this.dataDir, 'state.backup.json');
    this.resumeDir = path.join(this.dataDir, 'resumes');
    this.recoveryMessage = '';
    fs.mkdirSync(this.resumeDir, { recursive: true });
    const errors = [];
    for (const file of [this.filePath, this.backupPath]) {
      if (!fs.existsSync(file)) continue;
      try {
        assert(fs.statSync(file).size <= MAX_BACKUP_BYTES, '数据文件过大。');
        this.state = validateState(JSON.parse(fs.readFileSync(file, 'utf8')));
        if (file === this.backupPath) {
          this.recoveryMessage = '已从自动备份恢复本地数据。';
          this._preserveCorrupt(this.filePath);
          atomicWrite(this.filePath, JSON.stringify(this.state, null, 2));
        }
        return;
      } catch (error) { errors.push(error); }
    }
    if (errors.length) {
      // Preserve unreadable data for manual recovery before initializing again.
      this._preserveCorrupt(this.filePath);
      this._preserveCorrupt(this.backupPath);
      this.recoveryMessage = '本地数据无法读取，已建立空档案。原文件已保留为 .corrupt 文件，可用于手动恢复。';
    }
    this.state = emptyState();
    this._commit(this.state);
  }

  _preserveCorrupt(file) {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.${Date.now()}.${randomUUID()}.corrupt`, fs.constants.COPYFILE_EXCL);
  }

  _commit(value) {
    const next = validateState(value);
    const contents = JSON.stringify(next, null, 2);
    // Keep the previous valid state recoverable while replacing the primary.
    if (this.state) atomicWrite(this.backupPath, JSON.stringify(this.state, null, 2));
    atomicWrite(this.filePath, contents);
    this.state = next;
    // A failure refreshing this mirror must not report a successful primary
    // write as failed, which could make import cleanup delete committed files.
    try { atomicWrite(this.backupPath, contents); } catch {
      this.recoveryMessage = '数据已保存，但自动恢复副本未能更新。请检查磁盘空间和目录权限。';
    }
    return this.getState();
  }

  getState() { return clone(this.state); }

  saveProfile(value) {
    assert(isObject(value), '个人档案无效。');
    const next = this.getState();
    next.profile = profileFrom({ ...next.profile, ...value });
    return this._commit(next);
  }

  saveJob(draft) {
    assert(isObject(draft), '职位数据无效。');
    const next = this.getState();
    const existing = draft.id ? next.jobs.find((job) => job.id === id(draft.id)) : null;
    assert(!draft.id || existing, '职位不存在。');
    const now = new Date().toISOString();
    const job = {
      id: existing?.id ?? randomUUID(), title: '', company: '', url: '', description: '', notes: '',
      status: 'saved', resumeId: null, createdAt: now, updatedAt: now, ...existing,
    };
    for (const field of ['title', 'company', 'url', 'description', 'notes', 'status', 'resumeId']) {
      if (Object.hasOwn(draft, field)) job[field] = draft[field];
    }
    job.updatedAt = now;
    job.url = normalizeJobUrl(job.url);
    job.title = text(job.title, '职位名称', 500);
    assert(job.title || job.url, '请填写职位名称或网址。');
    assert(!job.url || !next.jobs.some((entry) => entry.id !== job.id && entry.url === job.url), '这个职位网址已经保存过了。');
    if (existing) next.jobs[next.jobs.findIndex((entry) => entry.id === existing.id)] = job;
    else next.jobs.push(job);
    return this._commit(next);
  }

  importJobs(value) {
    const input = text(value, '职位网址列表', 500000);
    const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    assert(lines.length <= MAX_JOBS, '一次最多导入 10000 个职位网址。');
    const next = this.getState();
    const existing = new Set(next.jobs.map((job) => job.url).filter(Boolean));
    let duplicates = 0;
    let added = 0;
    const now = new Date().toISOString();
    for (const line of lines) {
      const url = normalizeJobUrl(line);
      if (existing.has(url)) { duplicates++; continue; }
      existing.add(url);
      next.jobs.push({ id: randomUUID(), title: '', company: new URL(url).hostname, url, description: '', notes: '', status: 'saved', resumeId: null, createdAt: now, updatedAt: now });
      added++;
    }
    const state = added ? this._commit(next) : this.getState();
    return { state, added, duplicates };
  }

  deleteJob(jobId) {
    id(jobId);
    const next = this.getState();
    assert(next.jobs.some((job) => job.id === jobId), '职位不存在。');
    next.jobs = next.jobs.filter((job) => job.id !== jobId);
    return this._commit(next);
  }

  setJobStatus({ id: jobId, status }) { return this.saveJob({ id: jobId, status }); }

  _resumePath(resume) {
    const target = path.join(this.resumeDir, id(resume.id), resumeFilename(resume.name));
    assert(target.length <= 250, '简历保存路径过长，请缩短简历文件名后重试。');
    return target;
  }

  _removeResumeFile(file) {
    const folder = path.dirname(file);
    assert(path.dirname(folder) === this.resumeDir && /^[a-f0-9-]{36}$/.test(path.basename(folder)), '简历保存路径无效。');
    assert(!fs.existsSync(folder) || !fs.lstatSync(folder).isSymbolicLink(), '简历保存路径不能是符号链接。');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    // Only remove this generated, empty directory; never recurse into user data.
    if (fs.existsSync(folder)) fs.rmdirSync(folder);
  }

  importResume(filePath) {
    assert(typeof filePath === 'string', '请选择简历文件。');
    const source = path.resolve(filePath);
    const file = fs.statSync(source);
    const name = resumeFilename(path.basename(source));
    assert(file.isFile() && file.size > 0 && file.size <= MAX_RESUME_BYTES, '简历必须是文件，且大小在 1 字节到 20 MB 之间。');
    const next = this.getState();
    assert(next.resumes.length < MAX_RESUMES, '最多保存 100 份简历，请先移除一份。');
    const resume = { id: randomUUID(), name, size: file.size, addedAt: new Date().toISOString() };
    const destination = this._resumePath(resume);
    fs.mkdirSync(path.dirname(destination));
    try {
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      assert(fs.statSync(destination).size === file.size, '复制期间简历文件发生变化，请重新导入。');
      next.resumes.push(resume);
      return this._commit(next);
    } catch (error) {
      this._removeResumeFile(destination);
      throw error;
    }
  }

  getResumePath(resumeId) {
    id(resumeId);
    const resume = this.state.resumes.find((entry) => entry.id === resumeId);
    assert(resume, '简历不存在。');
    const filePath = this._resumePath(resume);
    assert(fs.existsSync(filePath) && !fs.lstatSync(path.dirname(filePath)).isSymbolicLink() && fs.lstatSync(filePath).isFile(), '简历文件丢失或保存路径无效，请重新导入。');
    return filePath;
  }

  removeResume(resumeId) {
    id(resumeId);
    const next = this.getState();
    const resume = next.resumes.find((entry) => entry.id === resumeId);
    assert(resume, '简历不存在。');
    next.resumes = next.resumes.filter((entry) => entry.id !== resumeId);
    next.jobs = next.jobs.map((job) => job.resumeId === resumeId ? { ...job, resumeId: null, updatedAt: new Date().toISOString() } : job);
    const result = this._commit(next);
    this._discardUnreferencedResume(resume);
    return result;
  }

  _discardUnreferencedResume(resume) {
    // If the backup mirror could not refresh, retain files it still references.
    try {
      const recovery = JSON.parse(fs.readFileSync(this.backupPath, 'utf8'));
      if (recovery.resumes.some((entry) => entry.id === resume.id)) return;
      const file = this._resumePath(resume);
      this._removeResumeFile(file);
    } catch { /* Keep extra files rather than compromising recovery. */ }
  }

  saveSettings(settings) {
    assert(isObject(settings), '设置数据无效。');
    const next = this.getState();
    next.settings = { ...next.settings, ...settings };
    return this._commit(next);
  }

  exportBackup(filePath) {
    assert(typeof filePath === 'string' && filePath.length > 0, '请选择备份保存位置。');
    const destination = path.resolve(filePath);
    this._assertExternalBackupPath(destination);
    const state = this.getState();
    const files = {};
    let totalBytes = 0;
    for (const resume of state.resumes) {
      const contents = fs.readFileSync(this.getResumePath(resume.id));
      assert(contents.length === resume.size, '已保存的简历文件发生变化，请重新导入后再备份。');
      totalBytes += contents.length;
      assert(totalBytes <= MAX_BACKUP_BYTES / 2, '备份中的简历总大小不能超过 75 MB。');
      files[resume.id] = contents.toString('base64');
    }
    const output = JSON.stringify({ format: 'jobpilot-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), state, files }, null, 2);
    assert(Buffer.byteLength(output) <= MAX_BACKUP_BYTES, '备份文件不能超过 150 MB。');
    atomicWrite(destination, output);
    return { filePath: destination, resumes: state.resumes.length, jobs: state.jobs.length };
  }

  _assertExternalBackupPath(filePath) {
    const relative = path.relative(this.dataDir, filePath);
    assert(relative && (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), '请将备份保存在软件数据目录之外的位置。');
  }

  importBackup(filePath) {
    assert(typeof filePath === 'string', '请选择备份文件。');
    const file = fs.statSync(filePath);
    assert(file.isFile() && file.size <= MAX_BACKUP_BYTES, '备份文件无效或超过 150 MB。');
    let backup;
    try { backup = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { throw new Error('无法读取备份内容，请选择有效的 JobPilot JSON 备份。'); }
    assert(isObject(backup) && backup.format === 'jobpilot-backup' && backup.schemaVersion === 1, '备份格式无效或当前版本不支持。');
    const next = validateState(backup.state);
    assert(isObject(backup.files) && Object.keys(backup.files).length === next.resumes.length, '备份中的简历文件与记录不匹配。');
    const buffers = [];
    const mappings = new Map();
    let totalBytes = 0;
    for (const resume of next.resumes) {
      const encoded = backup.files[resume.id];
      assert(typeof encoded === 'string' && encoded.length <= Math.ceil(MAX_RESUME_BYTES / 3) * 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), '备份中的简历内容无效。');
      const contents = Buffer.from(encoded, 'base64');
      assert(contents.length === resume.size && contents.toString('base64') === encoded, '备份中的简历数据不完整或无效。');
      totalBytes += contents.length;
      assert(totalBytes <= MAX_BACKUP_BYTES / 2, '备份中的简历总大小不能超过 75 MB。');
      const newId = randomUUID();
      mappings.set(resume.id, newId);
      resume.id = newId;
      buffers.push({ resume, contents });
    }
    for (const job of next.jobs) if (job.resumeId) job.resumeId = mappings.get(job.resumeId);
    const previousResumes = this.getState().resumes;
    const written = [];
    try {
      for (const { resume, contents } of buffers) {
        const destination = this._resumePath(resume);
        fs.mkdirSync(path.dirname(destination));
        written.push(destination);
        fs.writeFileSync(destination, contents, { flag: 'wx', mode: 0o600 });
      }
      const result = this._commit(next);
      for (const resume of previousResumes) this._discardUnreferencedResume(resume);
      return result;
    } catch (error) {
      for (const destination of written) this._removeResumeFile(destination);
      throw error;
    }
  }
}

function scoreJob({ description, profile }) {
  const input = text(description ?? '', '职位描述', 200000).toLocaleLowerCase();
  const skills = profileFrom(profile ?? {}).skills;
  if (!input) return { score: 0, matched: [], missing: skills, reasons: ['请先粘贴职位描述，再与已保存的技能比较。'] };
  if (!skills.length) return { score: 0, matched: [], missing: [], reasons: ['请先在个人档案中添加技能，再计算匹配度。'] };
  const matched = [];
  const missing = [];
  for (const skill of skills) {
    const keyword = skill.toLocaleLowerCase();
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    // ASCII skills need token boundaries (Java must not match JavaScript).
    // Chinese phrases can occur adjacent to other Han characters.
    const left = /^[a-z0-9]/.test(keyword) ? '(?<![a-z0-9])' : '';
    const right = /[a-z0-9+#.]$/.test(keyword) ? '(?![a-z0-9+#])' : '';
    (new RegExp(left + escaped + right, 'iu').test(input) ? matched : missing).push(skill);
  }
  return {
    score: Math.round(matched.length / skills.length * 100), matched, missing,
    reasons: [`已保存的 ${skills.length} 项技能中，有 ${matched.length} 项出现在职位描述中。`, '关键词匹配仅供阅读职位时参考，不代表录用概率。'],
  };
}

module.exports = { Store, scoreJob, normalizeJobUrl };
