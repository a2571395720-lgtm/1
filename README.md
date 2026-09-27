# JobPilot 桌面版

下载到电脑并安装即可使用的求职工作台（当前支持 Windows 10 / 11，x64）。自带运行环境，无需安装 Node.js、配置 API Key 或打开终端。档案、简历和职位队列保存在电脑上；浏览招聘网站时需要联网。

## 下载与安装

1. 打开 [Releases 下载页](https://github.com/a2571395720-lgtm/1/releases)。
2. 下载 `JobPilot-Setup-1.0.0-x64.exe`，双击安装并选择安装位置。
3. 从桌面或开始菜单打开 **JobPilot**。安装到当前用户，不需要管理员权限。

本项目的安装器尚无商业代码签名，Windows 可能显示“未知发布者”。仅使用本仓库发布的安装包，可用发布页的 SHA-256 校验文件核对下载内容；不要关闭系统安全防护。

## 开始一次申请

1. 在「个人档案」填写真实姓名、联系方式、学校和技能并保存。初始档案为空。
2. 在「简历材料」导入 PDF、DOC 或 DOCX（单个文件最多 20 MB）。软件保存独立副本，原文件移动后仍可使用。
3. 在「申请队列」添加职位，或每行一个链接批量导入。重复链接会跳过。
4. 在职位详情中粘贴岗位描述、选择简历。技能匹配度使用你保存的技能计算，不调用 AI，也不预测录取结果。
5. 点击「打开申请页面」，在内置申请窗口中登录。确认页面后点击「填写普通信息」或「附加简历」。
6. 检查招聘网站的答案和附件，自行回答敏感问题、完成最终提交，再手动更新队列状态。

支持职位搜索、状态筛选、备注、重复链接检测、多简历管理和开机启动。仅打开页面或填表不会被标记为投递成功。

自动填表只处理可识别的普通空白字段，不覆盖已有内容。登录、验证码、签证、工作授权、身份、薪资、人口统计和电子签名由本人操作。不同招聘网站的自定义控件、隐藏上传框和内嵌页面可能需要手动处理；软件不会自动批量投递。附加简历只代表文件进入上传框，是否接收成功以招聘网站提示为准。

## 数据、升级与备份

默认数据目录是 `%APPDATA%\JobPilot`，可在设置中打开。档案和职位保存在 `state.json`，简历保存在 `resumes`，同时维护恢复副本。

设置中的「导出备份」会保存档案、职位、偏好和简历文件。恢复备份会替换当前数据，恢复前请先备份。备份不包含招聘网站的登录 Cookie。升级和卸载默认保留个人资料；不要把简历和备份提交到公开仓库。

## 开发桌面版

```powershell
cd desktop
npm ci
npm start
```

```powershell
npm test             # 持久化、备份、字段识别和安全校验
npm run test:e2e     # 真实 Electron 界面与申请页面测试
npm run dist         # Windows x64 NSIS 安装包
```

安装包输出到 `artifacts/desktop/`。桌面开发推荐 Node.js 24.15+ LTS，最终用户不需要。桌面程序只打包 `desktop/` 中的运行文件，不携带开发者数据、测试资料或旧网页构建。

桌面主进程是 `desktop/main.cjs`，界面是 `desktop/ui/`，数据管理在 `desktop/store.cjs`。招聘网页在隔离的窗口中运行，没有 Node.js 或本地档案 API 权限。

原有 `app/` 网页源码和 `release/` 早期演示保留供参考，`extension/` 为早期浏览器扩展；安装桌面版不需要操作这些目录。

## 旧网页版开发说明

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build JobPilot and verify the rendered dashboard and application safeguards
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
