'use strict';

// These functions are injected into an application page by Electron. Keep all
// helpers inside each function: executeJavaScript serializes the function body.
function autofill(profile) {
  const result = { filledCount: 0, sensitiveCount: 0, skippedCount: 0 };
  const visible = (element) => {
    if (!element || !element.isConnected || !Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0)) return false;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.hasAttribute('inert') || ancestor.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(ancestor);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return true;
  };
  const normalize = (value) => String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const labelText = (element) => {
    const labels = Array.from(element.labels || [], (label) => {
      const copy = label.cloneNode(true);
      for (const control of copy.querySelectorAll('input, textarea, select, button, script, style')) control.remove();
      return copy.textContent || '';
    });
    const references = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    labels.push(...references.map((id) => document.getElementById(id)?.textContent || ''));
    labels.push(element.getAttribute('aria-label') || '');
    return labels.filter((label) => label.trim());
  };
  const contextText = (element) => {
    const fieldset = element.closest('fieldset');
    const legend = fieldset && Array.from(fieldset.children).find((child) => child.tagName === 'LEGEND');
    const group = element.closest('[role="group"], [role="radiogroup"]');
    const groupLabel = group ? [group.getAttribute('aria-label') || '', ...(group.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent || '')].join(' ') : '';
    return [legend?.textContent || '', groupLabel].join(' ');
  };
  const solvedCaptcha = Array.from(document.querySelectorAll('[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]'))
    .some((element) => String(element.value || '').trim());
  const captchaVisible = !solvedCaptcha && Array.from(document.querySelectorAll('iframe, [data-sitekey], .g-recaptcha, .h-captcha, .cf-turnstile, h1, h2, h3, p, label'))
    .some((element) => visible(element) && (element.matches('[data-sitekey], .g-recaptcha, .h-captcha, .cf-turnstile')
      || (element.tagName === 'IFRAME' && /recaptcha|hcaptcha|challenges\.cloudflare|captcha|turnstile/i.test(`${element.getAttribute('src') || ''} ${element.getAttribute('title') || ''}`))
      || /verify (?:that )?you (?:are|re) human|i am not a robot|i'm not a robot|complete the captcha|请完成.{0,8}验证码|人机验证|请验证您是真人/i.test(element.textContent || '')));
  if (captchaVisible) return { ...result, blocked: true, message: '检测到验证码或人机验证，请先在页面中手动完成，再点击填写。' };
  const loginVisible = Array.from(document.querySelectorAll('input[type="password"]')).some(visible)
    || Array.from(document.querySelectorAll('h1, h2, [role="heading"]')).some((element) => visible(element) && /^(?:sign in|log in|login|登录|登入)(?:\s+to (?:apply|continue)|以继续|后继续)?[.!。！]?$/i.test((element.textContent || '').trim()));
  if (loginVisible) return { ...result, blocked: true, message: '检测到登录或密码页面，请先手动完成登录，再点击填写。' };

  const sensitive = /\b(?:visa|sponsor(?:ship|ed)?|authori[sz]ation|authori[sz]ed to work|eligible to work|work permit|citizen(?:ship)?|residency|permanent resident|nationality|gender|sex|sexual|race|racial|ethnicity|ethnic|disabilit(?:y|ies)|disabled|veteran|military|salary|compensation|remuneration|desired pay|pay expectation|ssn|social security|tax id|national insurance|passport|date of birth|birth date|signature|sign here|electronic signature|consent|criminal|background check)\b|签证|担保|工作许可|工作授权|工作资格|合法工作|国籍|公民|性别|民族|种族|残疾|退伍|服役|薪资|薪酬|工资|社保|社会安全|身份证|护照|出生日期|签名|签署|授权同意|犯罪|背景调查/i;
  const unsuitable = /\b(?:company|employer|manager|supervisor|reference|referee|emergency|username|user name|account name)\b|公司|雇主|主管|推荐人|紧急联系人|用户名/i;
  const aliases = {
    fullName: ['name', 'full name', 'fullname', 'legal name', 'full legal name', 'applicant name', 'candidate name', '姓名'],
    firstName: ['first name', 'firstname', 'fname', 'given name', 'givenname', '名'],
    lastName: ['last name', 'lastname', 'lname', 'surname', 'family name', 'familyname', '姓'],
    email: ['email', 'e mail', 'email address', 'e mail address', 'emailaddress', '邮箱', '电子邮箱', '电子邮件'],
    phone: ['phone', 'phone number', 'phonenumber', 'telephone', 'telephone number', 'mobile', 'mobile number', 'contact number', '电话', '电话号码', '手机', '手机号', '手机号码'],
    location: ['location', 'current location', '所在地', '居住地', '现居地'],
    school: ['school', 'school name', 'university', 'university name', 'college', 'college name', 'institution', 'institution name', '学校', '学校名称', '毕业院校'],
    degree: ['degree', 'degree type', 'education degree', '学位', '学历'],
    major: ['major', 'field of study', 'discipline', '专业', '所学专业'],
    linkedin: ['linkedin', 'linked in', 'linkedin url', 'linkedin profile', 'linkedin profile url', 'linkedinurl', '领英', '领英链接'],
    github: ['github', 'git hub', 'github url', 'github profile', 'github profile url', 'githuburl', 'github 链接'],
  };
  const autocompleteKeys = { name: 'fullName', 'given-name': 'firstName', 'family-name': 'lastName', email: 'email', tel: 'phone', organization: null };
  const cleanDescriptor = (text) => normalize(text)
    .replace(/^(?:please (?:enter|provide) |your |请输入|请填写)/, '')
    .replace(/ (?:required|optional)$/, '').replace(/(?:必填|选填)$/, '').trim();
  const candidates = [];
  const elements = Array.from(document.querySelectorAll('input, textarea, select'));
  for (const element of elements) {
    if (!visible(element) || element.matches(':disabled') || element.readOnly || element.closest('[aria-disabled="true"]')) {
      result.skippedCount += 1;
      continue;
    }
    const labels = labelText(element);
    const descriptors = [...labels, element.name, element.id, element.getAttribute('placeholder') || ''];
    const context = contextText(element);
    const text = normalize([...descriptors, context, element.getAttribute('autocomplete') || ''].join(' '));
    if (sensitive.test(text)) {
      element.style.outline = '2px solid #f59e0b';
      result.sensitiveCount += 1;
      continue;
    }
    if ((element.tagName === 'INPUT' && !['text', 'email', 'tel', 'url', 'search'].includes(element.type))
      || element.multiple || String(element.value || '').trim() || unsuitable.test(text)) {
      result.skippedCount += 1;
      continue;
    }
    const keys = new Set();
    // Contradictory labels/attributes are ambiguous, even if autocomplete gives
    // a strong hint. Multiple copies of the same profile field are also skipped.
    for (const descriptor of descriptors) {
      const normalized = cleanDescriptor(descriptor);
      for (const [key, values] of Object.entries(aliases)) if (values.includes(normalized)) keys.add(key);
      if (/\bfirst (?:and |or )?last name\b|\bfirst name (?:and |or )?last name\b/.test(normalized)) {
        keys.add('firstName');
        keys.add('lastName');
      }
    }
    const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase().trim().split(/\s+/).at(-1);
    if (autocompleteKeys[autocomplete]) keys.add(autocompleteKeys[autocomplete]);
    if (!keys.size && element.tagName === 'INPUT' && element.type === 'email' && !labels.length) keys.add('email');
    if (keys.size !== 1) { result.skippedCount += 1; continue; }
    const key = [...keys][0];
    const value = profile && typeof profile[key] === 'string' ? profile[key].trim() : '';
    if (!value) { result.skippedCount += 1; continue; }
    candidates.push({ element, key, value });
  }
  const keyCounts = new Map();
  for (const candidate of candidates) keyCounts.set(candidate.key, (keyCounts.get(candidate.key) || 0) + 1);
  for (const { element, key, value } of candidates) {
    if (keyCounts.get(key) !== 1) { result.skippedCount += 1; continue; }
    let targetValue = value;
    if (element.tagName === 'SELECT') {
      const options = Array.from(element.options).filter((option) => !option.disabled && !option.parentElement?.disabled
        && option.value && (option.value === value || option.textContent.trim() === value));
      if (options.length !== 1) { result.skippedCount += 1; continue; }
      targetValue = options[0].value;
    }
    // Use the native setter so frameworks such as React receive a real update.
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
      : element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter || !element.isConnected || !visible(element) || element.matches(':disabled') || element.readOnly || element.closest('[aria-disabled="true"]') || String(element.value || '').trim()) {
      result.skippedCount += 1;
      continue;
    }
    setter.call(element, targetValue);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
    if (element.value !== targetValue) { result.skippedCount += 1; continue; }
    element.style.outline = '2px solid #22c55e';
    result.filledCount += 1;
  }
  return result;
}

function findResumeInput() {
  const visible = (element) => {
    if (!element || !element.isConnected || !Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0)) return false;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.hasAttribute('inert') || ancestor.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(ancestor);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    }
    return true;
  };
  const captchaSolved = Array.from(document.querySelectorAll('[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]')).some((element) => String(element.value || '').trim());
  const captchaVisible = !captchaSolved && Array.from(document.querySelectorAll('iframe, [data-sitekey], .g-recaptcha, .h-captcha, .cf-turnstile, h1, h2, h3, p, label'))
    .some((element) => visible(element) && (element.matches('[data-sitekey], .g-recaptcha, .h-captcha, .cf-turnstile')
      || (element.tagName === 'IFRAME' && /recaptcha|hcaptcha|challenges\.cloudflare|captcha|turnstile/i.test(`${element.getAttribute('src') || ''} ${element.getAttribute('title') || ''}`))
      || /verify (?:that )?you (?:are|re) human|i am not a robot|i'm not a robot|complete the captcha|请完成.{0,8}验证码|人机验证|请验证您是真人/i.test(element.textContent || '')));
  if (captchaVisible) return { message: '检测到验证码，请先在页面中手动完成验证。' };
  if (Array.from(document.querySelectorAll('input[type="password"]')).some(visible)
    || Array.from(document.querySelectorAll('h1, h2, [role="heading"]')).some((element) => visible(element) && /^(?:sign in|log in|login|登录|登入)(?:\s+to (?:apply|continue)|以继续|后继续)?[.!。！]?$/i.test((element.textContent || '').trim()))) {
    return { message: '检测到登录或密码页面，请先手动完成登录。' };
  }
  const candidates = Array.from(document.querySelectorAll('input[type="file"]')).filter((element) => {
    if (!visible(element) || element.matches(':disabled') || element.closest('[aria-disabled="true"]') || element.multiple || element.files?.length || element.value) return false;
    const references = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const labels = [element.getAttribute('aria-label'), ...Array.from(element.labels || [], (label) => label.textContent), ...references.map((id) => document.getElementById(id)?.textContent)].filter(Boolean).join(' ');
    const text = [element.name, element.id, labels].filter(Boolean).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
    if (!/\br[eé]sum[eé]\b|\bcv\b|curriculum vitae|简历/i.test(text)) return false;
    if (/cover letter|coverletter|motivation|photo|image|picture|passport|identity|transcript|certificate|求职信|推荐信|照片|图片|身份证|证件|护照|成绩单|证书/i.test(text) || /\bid\b/i.test(labels)) return false;
    const accept = (element.getAttribute('accept') || '').split(',').map((type) => type.trim().toLowerCase()).filter(Boolean);
    if (accept.length && accept.every((type) => /^image\//.test(type) || /^\.(?:png|jpe?g|gif|webp|bmp|svg|heic)$/.test(type))) return false;
    return true;
  });
  if (!candidates.length) return { message: '未找到可安全识别的空白简历上传框，请在申请页面手动选择简历。隐藏、已有文件或其他附件栏不会被修改。' };
  if (candidates.length !== 1) return { message: '页面有多个简历上传框，无法确定目标，请在申请页面手动选择简历。' };
  let token;
  do { token = `jp${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`; }
  while (document.querySelector(`[data-jobpilot-resume-target="${token}"]`));
  candidates[0].setAttribute('data-jobpilot-resume-target', token);
  return { selector: `[data-jobpilot-resume-target="${token}"]`, message: '已找到简历上传框，准备选择文件；请在页面确认上传结果。' };
}

module.exports = { autofill, findResumeInput };
