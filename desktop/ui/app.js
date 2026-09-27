'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const api = window.jobpilot;
  const statuses = { saved: '已收藏', applying: '申请中', submitted: '已提交', interview: '面试中', rejected: '未通过' };
  const pageTitles = { overview: '工作台', jobs: '申请队列', profile: '个人档案', materials: '简历材料', settings: '设置与帮助' };
  const profileFields = ['fullName', 'firstName', 'lastName', 'email', 'phone', 'location', 'school', 'degree', 'major', 'linkedin', 'github'];
  let state;
  let selectedJobId = null;
  let lastDrawerFocus = null;
  let scoreGeneration = 0;
  let drawerScoreGeneration = 0;
  let applicationJobIds = new Set();
  const scoreCache = new Map();

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }
  function button(text, className, handler) {
    const item = node('button', className, text);
    item.type = 'button';
    item.addEventListener('click', handler);
    return item;
  }
  function errorMessage(error) {
    return String(error?.message || error || '操作未完成，请重试。').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  }
  function toast(message, isError = false) {
    const item = node('div', `toast${isError ? ' error' : ''}`, message);
    item.setAttribute('role', isError ? 'alert' : 'status');
    $('#toast-region').append(item);
    setTimeout(() => item.remove(), isError ? 8500 : 4500);
  }
  async function action(trigger, task) {
    if (trigger?.disabled) return;
    if (trigger) { trigger.disabled = true; trigger.setAttribute('aria-busy', 'true'); }
    try { return await task(); }
    catch (error) { toast(errorMessage(error), true); return undefined; }
    finally { if (trigger) { trigger.disabled = false; trigger.removeAttribute('aria-busy'); } }
  }
  function updateState(nextState, { updateProfile = false } = {}) {
    state = nextState;
    scoreCache.clear();
    render();
    if (updateProfile) fillProfile();
    if (selectedJobId) fillDrawer();
  }
  function displayDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }
  function splitList(value) { return [...new Set(value.split(/[,，\n]+/).map(item => item.trim()).filter(Boolean))]; }
  function isProfileReady() { return Boolean((state.profile.fullName || state.profile.firstName) && state.profile.email); }
  function switchPage(page) {
    if (!pageTitles[page]) return;
    $$('.page').forEach(item => { item.hidden = item.id !== `page-${page}`; });
    $$('.nav-item[data-page]').forEach(item => { item.classList.toggle('active', item.dataset.page === page); item.setAttribute('aria-current', item.dataset.page === page ? 'page' : 'false'); });
    $('#breadcrumb-page').textContent = pageTitles[page];
    if (page === 'profile') fillProfile();
    window.scrollTo(0, 0);
  }
  function emptyState(title, description, actionLabel, handler) {
    const item = node('div', 'empty-state');
    const image = node('div', 'empty-icon'); image.append(icon('jobs'));
    item.append(image, node('h3', '', title), node('p', '', description));
    if (actionLabel) item.append(button(actionLabel, 'button secondary small', handler));
    return item;
  }
  function companyAvatar(job) { return node('span', 'company-avatar', (job.company || job.title || 'J').slice(0, 1).toUpperCase()); }
  function statusBadge(status) { return node('span', `status-badge status-${status}`, statuses[status] || '已收藏'); }
  function jobSummary(job) {
    const summary = node('div', 'job-summary');
    summary.append(node('strong', '', job.title || '待补充职位名称'), node('p', '', job.company || '待补充公司'));
    return summary;
  }
  function renderOverview() {
    Object.keys(statuses).forEach(status => { const target = $(`#stat-${status}`); if (target) target.textContent = state.jobs.filter(job => job.status === status).length; });
    const profileReady = isProfileReady();
    const resumeReady = state.resumes.length > 0;
    const jobsReady = state.jobs.length > 0;
    const completed = [profileReady, resumeReady, jobsReady].filter(Boolean).length;
    $('#setup-progress').textContent = `完成 ${completed} / 3 项准备`;
    const setup = $('#setup-list'); setup.replaceChildren();
    [
      { title: '完善个人档案', text: '准备常用信息，减少重复填写', complete: profileReady, handler: () => switchPage('profile') },
      { title: '导入你的简历', text: '按职位选择最合适的版本', complete: resumeReady, handler: () => switchPage('materials') },
      { title: '收藏第一个机会', text: '从一条职位链接开始', complete: jobsReady, handler: openNewJob },
    ].forEach((step, index) => {
      const row = node('div', 'setup-item');
      const copy = node('div'); copy.append(node('strong', '', step.title), node('p', '', step.text));
      row.append(node('span', `setup-number${step.complete ? ' complete' : ''}`, step.complete ? '✓' : String(index + 1)), copy, button(step.complete ? '查看' : '去准备 →', 'text-button', step.handler));
      setup.append(row);
    });
    const heroAction = $('#hero-action');
    if (!profileReady) { $('#hero-title').textContent = '一次准备，专注每个机会。'; $('#hero-description').textContent = '完善资料、放入简历，就可以在申请页面复用你的信息。'; heroAction.replaceChildren(document.createTextNode('完善个人档案'), icon('arrow')); heroAction.onclick = () => switchPage('profile'); }
    else if (!resumeReady) { $('#hero-title').textContent = '资料已就绪，带上你的简历。'; $('#hero-description').textContent = '导入简历副本，为下一次申请做好准备。'; heroAction.replaceChildren(document.createTextNode('导入我的简历'), icon('arrow')); heroAction.onclick = () => switchPage('materials'); }
    else { $('#hero-title').textContent = '准备好了，去发现下一个机会。'; $('#hero-description').textContent = '打开职位、填写资料、检查提交。每一步进展都由你掌握。'; heroAction.replaceChildren(document.createTextNode(jobsReady ? '查看申请队列' : '添加第一个职位'), icon('arrow')); heroAction.onclick = jobsReady ? () => switchPage('jobs') : openNewJob; }
    const recent = $('#recent-jobs'); recent.replaceChildren();
    const jobs = [...state.jobs].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 4);
    if (!jobs.length) recent.append(emptyState('你的下一个机会，从这里开始', '添加感兴趣的职位链接。进度、资料和备注都会留在这里。', '添加第一个职位', openNewJob));
    for (const job of jobs) { const row = button('', 'recent-job', () => openDrawer(job.id)); row.append(companyAvatar(job), jobSummary(job), statusBadge(job.status)); recent.append(row); }
  }
  async function score(job) {
    const key = `${job.id}:${job.description}:${JSON.stringify(state.profile)}`;
    if (!scoreCache.has(key)) scoreCache.set(key, api.scoreJob({ description: job.description || '', profile: state.profile }));
    return scoreCache.get(key);
  }
  function renderJobs() {
    const generation = ++scoreGeneration;
    const query = $('#job-search').value.trim().toLocaleLowerCase();
    const filter = $('#job-filter').value;
    const jobs = [...state.jobs].filter(job => (filter === 'all' || job.status === filter) && `${job.title} ${job.company} ${job.notes || ''}`.toLocaleLowerCase().includes(query)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    $('#job-result-count').textContent = `${jobs.length} 个职位`;
    const list = $('#jobs-list'); list.replaceChildren();
    if (!jobs.length) { list.append(emptyState(state.jobs.length ? '没有找到符合条件的职位' : '队列还是空的，放入第一个机会吧', state.jobs.length ? '试试其他关键词，或切换申请状态。' : '支持单个添加，也可以一次导入多个申请链接。', state.jobs.length ? null : '添加职位', openNewJob)); return; }
    jobs.forEach(job => {
      const row = node('div', 'job-row'); row.dataset.jobId = job.id;
      const main = button('', 'job-main-button', () => openDrawer(job.id)); main.append(companyAvatar(job), jobSummary(job)); main.setAttribute('aria-label', `查看 ${job.title} 详情`);
      const scoreCell = node('div', 'score-cell no-score', job.description ? '计算中…' : '待补描述');
      if (job.description) score(job).then(result => { if (generation !== scoreGeneration) return; scoreCell.classList.remove('no-score'); scoreCell.textContent = `${result.score}%`; scoreCell.title = (result.reasons || []).join('；'); }).catch(() => { scoreCell.textContent = '暂不可用'; });
      const status = node('select'); status.setAttribute('aria-label', `${job.title} 的申请状态`); fillStatusOptions(status, job.status);
      status.addEventListener('change', () => action(status, async () => { try { updateState(await api.setJobStatus({ id: job.id, status: status.value })); toast('申请状态已更新'); } catch (error) { status.value = job.status; throw error; } }));
      const actions = node('div', 'row-actions'); actions.append(button('详情', 'text-button', () => openDrawer(job.id)), button('打开 ↗', 'button secondary', event => openApplication(job.id, event.currentTarget)));
      row.append(main, scoreCell, status, actions); list.append(row);
    });
  }
  function fillStatusOptions(select, selected) { select.replaceChildren(); Object.entries(statuses).forEach(([value, text]) => { const option = node('option', '', text); option.value = value; select.append(option); }); select.value = selected; }
  function fillResumeOptions(select, selected = '') { select.replaceChildren(); const placeholder = node('option', '', '暂不选择'); placeholder.value = ''; select.append(placeholder); state.resumes.forEach(resume => { const option = node('option', '', resume.name); option.value = resume.id; select.append(option); }); select.value = selected || ''; }
  function fillProfile() {
    const form = $('#profile-form');
    profileFields.forEach(key => { form.elements[key].value = state.profile[key] || ''; });
    form.elements.skills.value = (state.profile.skills || []).join(', ');
    form.elements.preferredLocations.value = (state.profile.preferredLocations || []).join(', ');
    $$('input[name=workModes]', form).forEach(input => { input.checked = (state.profile.workModes || []).includes(input.value); });
  }
  function renderMaterials() {
    const container = $('#resumes-list'); container.replaceChildren();
    if (!state.resumes.length) { container.append(emptyState('每次申请，都带上合适的简历', '点击导入，选择电脑中的 PDF、DOCX 或 DOC 文件。原始文件会保留。', '导入第一份简历', () => $('#import-resume').click())); return; }
    state.resumes.forEach(resume => {
      const card = node('article', 'resume-card');
      const type = resume.name.split('.').pop().toUpperCase();
      const size = resume.size >= 1024 * 1024 ? `${(resume.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(resume.size / 1024))} KB`;
      const uses = state.jobs.filter(job => job.resumeId === resume.id).length;
      card.append(node('span', 'file-type', type), node('h3', '', resume.name), node('p', '', `${size} · ${displayDate(resume.addedAt)} 导入`), node('p', '', uses ? `${uses} 个职位正在使用` : '尚未分配到职位'));
      const actions = node('div', 'resume-actions');
      actions.append(button('打开简历 ↗', 'text-button', event => action(event.currentTarget, () => api.openResume(resume.id))), button('移除', 'text-button danger', event => action(event.currentTarget, async () => { if (!window.confirm(`移除“${resume.name}”？\n仅删除 JobPilot 保存的副本，原始文件会保留。${uses ? '\n相关职位将取消这份简历的关联。' : ''}`)) return; updateState(await api.removeResume(resume.id)); toast('已移除简历副本'); })));
      card.append(actions); container.append(card);
    });
  }
  function render() {
    $('#nav-job-count').textContent = state.jobs.length;
    $('#user-avatar').textContent = (state.profile.fullName || state.profile.firstName || 'J').slice(0, 1).toUpperCase();
    $('#start-at-login').checked = Boolean(state.settings.startAtLogin);
    renderOverview(); renderJobs(); renderMaterials();
  }
  function openNewJob() { $('#new-job-form').reset(); fillResumeOptions($('#new-job-resume'), state.resumes.length === 1 ? state.resumes[0].id : ''); $('#job-dialog').showModal(); }
  function feedback(message, isError = false) { const target = $('#application-feedback'); target.hidden = false; target.textContent = message; target.classList.toggle('error', isError); }
  async function openApplication(id, trigger) {
    await action(trigger, async () => {
      const result = await api.openApplication(id);
      applicationJobIds.add(id);
      if (selectedJobId !== id) openDrawer(id);
      feedback('申请窗口已打开。请先完成登录并进入表单，然后回到这里填写资料。');
      if (result?.url) $('#open-application').title = result.url;
      toast('已打开申请窗口');
    });
  }
  function openDrawer(id) {
    if (!state.jobs.some(job => job.id === id)) return;
    lastDrawerFocus = document.activeElement;
    selectedJobId = id;
    $('#application-feedback').hidden = true;
    $('#job-drawer').hidden = false;
    $('#drawer-backdrop').hidden = false;
    document.body.classList.add('open-drawer');
    fillDrawer();
    $('.drawer-scroll').scrollTop = 0;
    $('#close-drawer').focus();
  }
  function closeDrawer() { selectedJobId = null; ++drawerScoreGeneration; $('#job-drawer').hidden = true; $('#drawer-backdrop').hidden = true; document.body.classList.remove('open-drawer'); lastDrawerFocus?.focus(); }
  function fillDrawer() {
    const job = state.jobs.find(item => item.id === selectedJobId);
    if (!job) { closeDrawer(); return; }
    $('#drawer-title').textContent = job.title || '待补充职位名称';
    $('#drawer-company').textContent = job.company || '待补充公司';
    const form = $('#edit-job-form');
    ['title', 'company', 'url', 'description', 'notes', 'status'].forEach(key => { form.elements[key].value = job[key] || ''; });
    fillResumeOptions($('#edit-job-resume'), job.resumeId);
    $('#attach-resume').title = job.resumeId ? '将已保存的职位简历附到申请页面' : '请先为职位选择简历并保存';
    const generation = ++drawerScoreGeneration;
    $('#match-score').textContent = '—'; $('#match-skills').replaceChildren();
    if (!job.description) { $('#match-reason').textContent = '添加职位描述后，可查看本地技能关键词匹配。'; return; }
    $('#match-reason').textContent = '正在分析关键词…';
    score(job).then(result => {
      if (generation !== drawerScoreGeneration) return;
      $('#match-score').textContent = `${result.score}%`;
      $('#match-reason').textContent = (result.reasons || []).join('；') || '根据职位描述与个人技能计算，仅供参考。';
      const tags = $('#match-skills'); tags.replaceChildren();
      (result.matched || []).forEach(skill => tags.append(node('span', '', `✓ ${skill}`)));
      (result.missing || []).slice(0, 10).forEach(skill => tags.append(node('span', 'missing', `待匹配 · ${skill}`)));
    }).catch(error => { if (generation === drawerScoreGeneration) $('#match-reason').textContent = errorMessage(error); });
  }
  function readJobForm(form) { return { title: form.elements.title.value.trim(), company: form.elements.company.value.trim(), url: form.elements.url.value.trim(), description: form.elements.description.value.trim(), resumeId: form.elements.resumeId.value || null }; }
  function wireEvents() {
    $$('[data-page]').forEach(item => item.addEventListener('click', () => switchPage(item.dataset.page)));
    $('.brand').addEventListener('click', event => { event.preventDefault(); switchPage('overview'); });
    $$('[data-action=add-job]').forEach(item => item.addEventListener('click', openNewJob));
    $$('[data-close]').forEach(item => item.addEventListener('click', () => document.getElementById(item.dataset.close).close()));
    $('#job-search').addEventListener('input', renderJobs); $('#job-filter').addEventListener('change', renderJobs);
    $('#bulk-import-open').addEventListener('click', () => { $('#bulk-import-form').reset(); $('#bulk-dialog').showModal(); });
    $('#close-drawer').addEventListener('click', closeDrawer); $('#drawer-backdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', event => {
      if (!selectedJobId) return;
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); }
      if (event.key === 'Tab') { const inputs = $$('button:not(:disabled),input,select,textarea', $('#job-drawer')).filter(item => !item.hidden); const first = inputs[0], last = inputs[inputs.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    });
    $('#profile-form').addEventListener('submit', event => { event.preventDefault(); action($('#save-profile'), async () => { const form = event.currentTarget; const profile = {}; profileFields.forEach(key => { profile[key] = form.elements[key].value.trim(); }); profile.skills = splitList(form.elements.skills.value); profile.preferredLocations = splitList(form.elements.preferredLocations.value); profile.workModes = $$('input[name=workModes]:checked', form).map(input => input.value); updateState(await api.saveProfile(profile)); toast('个人档案已保存到此电脑'); }); });
    $('#new-job-form').addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget; action($('button[type=submit]', form), async () => { const before = new Set(state.jobs.map(job => job.id)); updateState(await api.saveJob(readJobForm(form))); $('#job-dialog').close(); switchPage('jobs'); toast('职位已加入申请队列'); const added = state.jobs.find(job => !before.has(job.id)); if (added) openDrawer(added.id); }); });
    $('#bulk-import-form').addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget; action($('button[type=submit]', form), async () => { const result = await api.importJobs(form.elements.urls.value); updateState(result.state); $('#bulk-dialog').close(); switchPage('jobs'); toast(`已导入 ${result.added} 个职位${result.duplicates ? `，跳过 ${result.duplicates} 个重复链接` : ''}`); }); });
    $('#edit-job-form').addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget; const id = selectedJobId; action($('button[type=submit]', form), async () => { updateState(await api.saveJob({ ...readJobForm(form), id, notes: form.elements.notes.value.trim(), status: form.elements.status.value })); toast('职位修改已保存'); }); });
    $('#delete-job').addEventListener('click', event => { const id = selectedJobId; const job = state.jobs.find(item => item.id === id); action(event.currentTarget, async () => { if (!window.confirm(`删除“${job.title}”？\n这会移除职位和申请备注，不会删除简历。`)) return; const next = await api.deleteJob(id); closeDrawer(); updateState(next); toast('已删除职位'); }); });
    $('#import-resume').addEventListener('click', event => action(event.currentTarget, async () => { const previous = state.resumes.length; updateState(await api.importResume()); if (state.resumes.length > previous) toast('简历副本已保存到此电脑'); }));
    $('#open-application').addEventListener('click', event => openApplication(selectedJobId, event.currentTarget));
    $('#fill-application').addEventListener('click', event => { const id = selectedJobId; action(event.currentTarget, async () => { try { const result = await api.fillApplication(id); if (selectedJobId === id) feedback(`已填写 ${result.filledCount} 项常用信息；${result.sensitiveCount} 项敏感问题留给本人回答；跳过 ${result.skippedCount} 项。${result.message ? ` ${result.message}` : ''} 请在申请窗口检查。`); } catch (error) { if (selectedJobId === id) feedback(errorMessage(error), true); throw error; } }); });
    $('#attach-resume').addEventListener('click', event => { const id = selectedJobId; action(event.currentTarget, async () => { try { const job = state.jobs.find(item => item.id === id); if (!job.resumeId) throw new Error('请先在下方选择一份简历并保存，再附到申请页面。'); const result = await api.attachResume(id); if (selectedJobId === id) feedback(result.message || (result.attached ? '简历已附到申请页面，请检查上传结果。' : '暂时无法自动附上简历，请在申请窗口手动选择文件。'), !result.attached); } catch (error) { if (selectedJobId === id) feedback(errorMessage(error), true); throw error; } }); });
    $('#start-at-login').addEventListener('change', event => { const input = event.currentTarget; action(input, async () => { try { updateState(await api.saveSettings({ ...state.settings, startAtLogin: input.checked })); toast('启动设置已保存'); } catch (error) { input.checked = state.settings.startAtLogin; throw error; } }); });
    $('#open-data-folder').addEventListener('click', event => action(event.currentTarget, () => api.openDataFolder()));
    $('#export-backup').addEventListener('click', event => action(event.currentTarget, async () => { const result = await api.exportBackup(); if (!result.canceled) toast('备份已导出，请妥善保存'); }));
    $('#import-backup').addEventListener('click', event => action(event.currentTarget, async () => { updateState(await api.importBackup(), { updateProfile: true }); toast('已完成备份恢复操作'); }));
    if (api.onApplicationEvent) api.onApplicationEvent(event => {
      if (event.type === 'closed') applicationJobIds.delete(event.jobId);
      if (event.type === 'navigation') applicationJobIds.add(event.jobId);
      if (event.jobId !== selectedJobId) return;
      if (event.type === 'error') feedback(event.message || '申请页面暂时无法打开，请检查网络或链接。', true);
      if (event.type === 'closed') feedback('申请窗口已关闭。可以重新打开继续申请；完成提交后请手动更新职位状态。');
      if (event.type === 'navigation' && event.url) $('#open-application').title = event.url;
    });
  }
  async function init() {
    try {
      if (!api) throw new Error('未检测到桌面服务。请通过安装后的 JobPilot 应用打开工作台。');
      state = await api.getState();
      wireEvents(); fillProfile(); render();
      $('#today-label').textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
      $('#loading-state').hidden = true;
      const info = await api.getAppInfo();
      $('#sidebar-version').textContent = `JobPilot Desktop · v${info.version}`;
      $('#app-version').textContent = `版本 ${info.version} · Windows 桌面应用`;
      $('#data-path').textContent = info.dataPath;
      if (info.recoveryMessage) toast(info.recoveryMessage, true);
    } catch (error) {
      const loading = $('#loading-state'); loading.hidden = false; loading.classList.add('error');
      $('p', loading).textContent = `工作台暂时无法加载\n${errorMessage(error)}`;
      loading.append(button('重新加载', 'button secondary', () => window.location.reload()));
    }
  }
  init();
})();
