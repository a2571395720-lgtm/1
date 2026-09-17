import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the JobPilot dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>JobPilot · 个人求职工作台<\/title>/i);
  assert.match(html, /从找职位到准备申请，都在一个网页完成。/);
  assert.match(html, /资料只保存在此设备/);
  assert.match(html, /Software Engineer Intern/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("keeps local profile storage and user-confirmed submission safeguards", async () => {
  const [page, layout, extension] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../extension/content.js", import.meta.url), "utf8"),
  ]);

  assert.match(page, /localStorage\.getItem\("jobpilot-profile"\)/);
  assert.match(page, /localStorage\.setItem\("jobpilot-profile"/);
  assert.match(page, /签证、身份、薪资和人口统计的问题不会自动替你回答/);
  assert.match(page, /你检查敏感问题并最终提交/);
  assert.match(layout, /title:\s*"JobPilot · 个人求职工作台"/);
  assert.doesNotMatch(extension, /\.submit\s*\(/);
});
