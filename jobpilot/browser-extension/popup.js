const profileFields = ["fullName", "email", "phone", "location", "school", "major", "linkedin", "github"];
const defaults = {
  fullName: "Tiancan Ni",
  email: "tni104@syr.edu",
  phone: "",
  location: "Syracuse, New York",
  school: "Syracuse University",
  major: "Computer Science",
  linkedin: "https://linkedin.com/in/tiancanni",
  github: "https://github.com/tiancanni"
};

function collectProfile() {
  return Object.fromEntries(profileFields.map((id) => [id, document.getElementById(id).value.trim()]));
}

async function saveProfile() {
  const profile = collectProfile();
  await chrome.storage.local.set({ jobpilotProfile: profile });
  return profile;
}

function show(message, isError = false) {
  const result = document.getElementById("result");
  result.textContent = message;
  result.style.color = isError ? "#9a3f34" : "#42634d";
}

chrome.storage.local.get("jobpilotProfile").then(({ jobpilotProfile }) => {
  const profile = { ...defaults, ...(jobpilotProfile || {}) };
  profileFields.forEach((id) => { document.getElementById(id).value = profile[id] || ""; });
});

document.getElementById("save").addEventListener("click", async () => {
  await saveProfile();
  show("档案已保存在浏览器本机");
});

document.getElementById("fill").addEventListener("click", async () => {
  try {
    await saveProfile();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("请先打开招聘申请页面");
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const summary = results?.[0]?.result;
    if (!summary) throw new Error("当前页面无法读取，请刷新后重试");
    const skipped = summary.sensitiveCount ? `；${summary.sensitiveCount} 个敏感字段待你确认` : "";
    show(`已填写 ${summary.filledCount} 项${skipped}`);
  } catch (error) {
    show(error.message || "填写失败，请刷新页面后重试", true);
  }
});

