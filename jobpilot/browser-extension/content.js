(async function runJobPilotAutofill() {
  const { jobpilotProfile = {} } = await chrome.storage.local.get("jobpilotProfile");
  const fields = [...document.querySelectorAll("input, textarea, select")].filter((el) => {
    const style = window.getComputedStyle(el);
    return !el.disabled && !el.readOnly && style.display !== "none" && style.visibility !== "hidden" && el.type !== "hidden";
  });

  const sensitivePattern = /visa|sponsor|work.?auth|citizen|gender|sex|race|ethnic|disab|veteran|salary|compensation|signature|ssn|social.?security|password|验证码|签证|工作许可|公民|性别|族裔|残障|退伍|薪资|签名|身份证/i;
  const mappings = [
    ["fullName", /full.?name|legal.?name|candidate.?name|your.?name|姓名|名字/i],
    ["email", /e-?mail|email.?address|电子邮件|邮箱/i],
    ["phone", /phone|mobile|telephone|contact.?number|电话|手机/i],
    ["location", /current.?location|city|location|address.?city|所在地|城市/i],
    ["school", /school|university|college|institution|学校|大学|院校/i],
    ["major", /major|field.?of.?study|area.?of.?study|专业|研究方向/i],
    ["linkedin", /linkedin/i],
    ["github", /github|portfolio|code.?sample|个人网站|作品集/i]
  ];

  function descriptor(el) {
    const labels = el.labels ? [...el.labels].map((label) => label.innerText).join(" ") : "";
    const labelledBy = (el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
    const nearby = el.closest("label, [role='group'], .formField, [data-automation-id]")?.innerText || "";
    return [labels, labelledBy, el.getAttribute("aria-label"), el.placeholder, el.name, el.id, el.autocomplete, nearby].filter(Boolean).join(" ").slice(0, 600);
  }

  function applyValue(el, value) {
    if (!value) return false;
    if (el.tagName === "SELECT") {
      const option = [...el.options].find((item) => item.value.toLowerCase() === value.toLowerCase() || item.text.toLowerCase().includes(value.toLowerCase()));
      if (!option) return false;
      el.value = option.value;
    } else {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      if (setter) setter.call(el, value); else el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.style.outline = "2px solid #9fbd36";
    el.style.outlineOffset = "2px";
    el.dataset.jobpilotFilled = "true";
    return true;
  }

  let filledCount = 0;
  let sensitiveCount = 0;
  const matchedFields = [];
  for (const el of fields) {
    const text = descriptor(el);
    if (!text) continue;
    if (sensitivePattern.test(text) || ["password"].includes(el.type)) {
      sensitiveCount += 1;
      el.style.outline = "2px solid #e0a247";
      el.style.outlineOffset = "2px";
      continue;
    }
    const mapping = mappings.find(([, pattern]) => pattern.test(text));
    if (!mapping) continue;
    const [key] = mapping;
    if (applyValue(el, jobpilotProfile[key])) {
      filledCount += 1;
      matchedFields.push(key);
    }
  }
  return { filledCount, sensitiveCount, matchedFields: [...new Set(matchedFields)] };
})();

