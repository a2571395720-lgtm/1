'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { autofill, findResumeInput } = require('../autofill.cjs');

function page(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: 'outside-only', url: 'https://jobs.example.test/apply' });
  // jsdom has no layout engine. All elements have a box unless the fixture
  // explicitly models zero geometry; production visibility also checks styles.
  dom.window.HTMLElement.prototype.getClientRects = function getClientRects() {
    return this.hasAttribute('data-no-layout') ? [] : [{ width: 100, height: 30 }];
  };
  return {
    dom,
    document: dom.window.document,
    fill: (profile) => JSON.parse(JSON.stringify(dom.window.eval(`(${autofill.toString()})(${JSON.stringify(profile)})`))),
    resume: () => JSON.parse(JSON.stringify(dom.window.eval(`(${findResumeInput.toString()})()`))),
  };
}

test('serialized autofill fills visible empty fields, emits native events, and preserves existing values', () => {
  const view = page('<label for="person">Full name</label><input id="person"><input name="email" value="keep@example.test"><label>Phone<input id="phone" type="tel"></label><label>Location<textarea id="location"></textarea></label>');
  const events = [];
  view.document.addEventListener('input', (event) => events.push(`input:${event.target.id}`));
  view.document.addEventListener('change', (event) => events.push(`change:${event.target.id}`));
  const result = view.fill({ fullName: 'Alex Chen', email: 'new@example.test', phone: '123456789', location: 'Shanghai' });
  assert.equal(result.filledCount, 3);
  assert.equal(view.document.querySelector('#person').value, 'Alex Chen');
  assert.equal(view.document.querySelector('[name="email"]').value, 'keep@example.test');
  assert.equal(view.document.querySelector('#location').value, 'Shanghai');
  assert.deepEqual(events, ['input:person', 'change:person', 'input:phone', 'change:phone', 'input:location', 'change:location']);
  assert.match(view.document.querySelector('#person').style.outline, /22c55e|34, 197, 94/);
  view.dom.window.close();
});

test('does not guess first and last names from a full name', () => {
  const view = page('<input autocomplete="given-name"><input autocomplete="family-name">');
  assert.equal(view.fill({ fullName: 'Alex Chen' }).filledCount, 0);
  assert.equal(view.fill({ firstName: 'Alex', lastName: 'Chen' }).filledCount, 2);
  assert.deepEqual(Array.from(view.document.querySelectorAll('input'), (input) => input.value), ['Alex', 'Chen']);
  view.dom.window.close();
});

test('skips duplicate mappings, contradictory labels, and company or username fields', () => {
  const view = page('<label>Name<input id="a"></label><label>Name<input id="b"></label><label>First name / Last name<input id="c"></label><label>Company name<input name="name" id="d"></label><label>Username<input name="name" id="e"></label><label>Phone<input name="email" id="f"></label>');
  assert.equal(view.fill({ fullName: 'Alex Chen', firstName: 'Alex', lastName: 'Chen', email: 'alex@example.test', phone: '123' }).filledCount, 0);
  assert.ok(Array.from(view.document.querySelectorAll('input')).every((input) => input.value === ''));
  view.dom.window.close();
});

test('never fills sensitive fields even when a name hint is present', () => {
  const view = page('<label>Signature: full name<input name="name"></label><label>签证担保<input name="email"></label><fieldset><legend>Work authorization</legend><label>Name<input name="name"></label></fieldset><label>Social security number<input name="phone"></label><label>Expected salary<input name="location"></label><label>Gender<select name="degree"><option value=""></option><option>Male</option></select></label><label>姓名<input id="safe"></label>');
  const result = view.fill({ fullName: 'Alex Chen', email: 'alex@example.test', phone: '123', location: 'NY', degree: 'Male' });
  assert.equal(result.sensitiveCount, 6);
  assert.equal(result.filledCount, 1);
  assert.equal(view.document.querySelector('#safe').value, 'Alex Chen');
  const sensitiveElements = Array.from(view.document.querySelectorAll('input, select')).filter((element) => element.id !== 'safe');
  assert.ok(sensitiveElements.every((element) => element.value === ''));
  assert.ok(sensitiveElements.every((element) => /f59e0b|245, 158, 11/.test(element.style.outline)));
  view.dom.window.close();
});

test('skips hidden, readonly, disabled, and unsupported controls including ancestors', () => {
  const view = page('<div hidden><input name="name"></div><div style="display:none"><input name="email"></div><div style="visibility:hidden"><input name="phone"></div><div style="opacity:0"><input name="school"></div><div aria-hidden="true"><input name="degree"></div><fieldset disabled><input name="major"></fieldset><input name="linkedin" readonly><input name="github" data-no-layout><input name="name" type="hidden"><input name="name" type="checkbox"><input name="name" type="radio"><input name="name" type="file"><input name="name" type="submit"><input name="name" type="button"><input name="location" aria-disabled="true"><div inert><input name="email"></div>');
  const result = view.fill({ fullName: 'Alex', email: 'alex@example.test', phone: '123', school: 'School', degree: 'BS', major: 'CS', linkedin: 'https://linkedin.com/in/alex', github: 'https://github.com/alex', location: 'NY' });
  assert.equal(result.filledCount, 0);
  assert.equal(view.document.querySelector('input[type="checkbox"]').checked, false);
  assert.equal(view.document.querySelector('input[type="radio"]').checked, false);
  view.dom.window.close();
});

test('only selects exact option values or text and preserves nonempty selections', () => {
  const view = page('<label>Degree<select><option value="">Choose</option><option value="bsc">Bachelor of Science</option><option value="msc" disabled>Master of Science</option></select></label>');
  assert.equal(view.fill({ degree: 'Bachelor' }).filledCount, 0);
  assert.equal(view.fill({ degree: 'Master of Science' }).filledCount, 0);
  assert.equal(view.fill({ degree: 'Bachelor of Science' }).filledCount, 1);
  assert.equal(view.document.querySelector('select').value, 'bsc');
  assert.equal(view.fill({ degree: 'msc' }).filledCount, 0);
  view.dom.window.close();
});

test('rejects ambiguous exact select options', () => {
  const view = page('<label>Degree<select><option value=""></option><option value="a">BS</option><option value="b">BS</option></select></label>');
  assert.equal(view.fill({ degree: 'BS' }).filledCount, 0);
  view.dom.window.close();
});

test('CAPTCHA and login block all filling and resume selection', () => {
  for (const blocker of ['<iframe title="reCAPTCHA"></iframe>', '<div class="h-captcha" data-sitekey="example"></div>', '<p>Verify you are human</p>', '<input type="password">', '<h1>Sign in to apply</h1>']) {
    const view = page(`${blocker}<input name="email"><label>Resume<input type="file"></label>`);
    const result = view.fill({ email: 'alex@example.test' });
    assert.equal(result.blocked, true, blocker);
    assert.equal(result.filledCount, 0);
    assert.ok(result.message);
    assert.equal(view.resume().selector, undefined);
    view.dom.window.close();
  }
});

test('hidden login fields do not block normal application fields', () => {
  const view = page('<div hidden><input type="password"></div><input name="email">');
  assert.equal(view.fill({ email: 'alex@example.test' }).filledCount, 1);
  view.dom.window.close();
});

test('never clicks buttons or submits the application', () => {
  const view = page('<form><input autocomplete="email"><button type="submit">Submit application</button><button type="button">Continue</button></form>');
  let submitted = 0;
  let clicked = 0;
  view.document.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); submitted += 1; });
  view.document.addEventListener('click', () => { clicked += 1; });
  assert.equal(view.fill({ email: 'alex@example.test' }).filledCount, 1);
  assert.equal(submitted, 0);
  assert.equal(clicked, 0);
  view.dom.window.close();
});

test('finds one explicitly labelled resume input and returns a unique selector without attaching', () => {
  const view = page('<span id="resume-label">Upload your résumé</span><input type="file" id="resume-file" name="resume_id" aria-labelledby="resume-label" accept=".pdf,.doc,.docx"><label>Cover letter<input type="file" id="cover"></label>');
  const result = view.resume();
  assert.ok(result.selector);
  assert.equal(view.document.querySelectorAll(result.selector).length, 1);
  assert.equal(view.document.querySelector(result.selector).id, 'resume-file');
  assert.equal(view.document.querySelector('#resume-file').files.length, 0);
  assert.equal(view.document.querySelector('#cover').hasAttribute('data-jobpilot-resume-target'), false);
  assert.match(result.message, /准备|确认/);
  view.dom.window.close();
});

test('refuses multiple resume targets and generic file pickers', () => {
  for (const html of ['<label>Resume<input type="file"></label><label>CV<input type="file"></label>', '<input type="file" accept=".pdf">', '<label>附件<input type="file"></label>']) {
    const view = page(html);
    assert.equal(view.resume().selector, undefined);
    assert.equal(view.document.querySelector('[data-jobpilot-resume-target]'), null);
    view.dom.window.close();
  }
});

test('refuses hidden, disabled, existing, mixed-use, image, and identity file inputs', () => {
  const cases = [
    '<label hidden>Resume<input type="file"></label>',
    '<label style="display:none">Resume<input type="file"></label>',
    '<fieldset disabled><label>Resume<input type="file"></label></fieldset>',
    '<label>Resume<input type="file" aria-disabled="true"></label>',
    '<label>Resume<input type="file" multiple></label>',
    '<label>Resume or cover letter<input type="file"></label>',
    '<label>Resume photo<input type="file"></label>',
    '<label>Resume<input type="file" accept="image/*,.png"></label>',
    '<label>Resume / 身份证<input type="file"></label>',
    '<label>Resume / ID<input type="file"></label>',
  ];
  for (const html of cases) {
    const view = page(html);
    assert.equal(view.resume().selector, undefined, html);
    view.dom.window.close();
  }
  const view = page('<label>简历<input type="file"></label>');
  Object.defineProperty(view.document.querySelector('input'), 'files', { value: [{ name: 'existing.pdf' }] });
  assert.equal(view.resume().selector, undefined);
  view.dom.window.close();
});
