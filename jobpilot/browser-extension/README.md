# JobPilot 一键填写扩展（V0.1）

这是第一版最小 Chrome / Edge 扩展。它仅在用户点击时读取当前招聘页面，填写普通个人信息并高亮结果；不会填写敏感或法律问题，不会绕过验证码，也不会点击最终提交。

## 本地安装

1. 在 Chrome 打开 `chrome://extensions`，或在 Edge 打开 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `extension` 文件夹。
5. 打开招聘申请页面，点击 JobPilot 扩展，确认档案后点击“一键填写当前页面”。

## 当前支持

- 普通文本字段：姓名、邮箱、电话、城市、学校、专业、LinkedIn、GitHub / Portfolio。
- 语义识别：`label`、`aria-label`、占位符、字段名称和附近文本。
- 安全边界：敏感字段橙色标记、普通已填字段绿色标记、无自动提交。

## 下一步

- Workday 分段表单和重复经历组件。
- Greenhouse / Lever 专用字段映射。
- 从 JobPilot PWA 安全同步已确认档案。
- 填写前后差异预览和撤销快照。

