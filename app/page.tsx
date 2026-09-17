"use client";

import { useMemo, useState } from "react";

type View = "home" | "profile" | "jobs" | "apply" | "settings";
const nav: { id: View; label: string; icon: string }[] = [
  { id: "home", label: "工作台", icon: "首" }, { id: "profile", label: "个人档案", icon: "人" },
  { id: "jobs", label: "职位评分", icon: "职" }, { id: "apply", label: "申请助手", icon: "申" },
  { id: "settings", label: "偏好设置", icon: "设" },
];
const skills = ["Java", "Python", "C++", "TypeScript", "React", "Spring Boot", "MySQL", "Linux", "Docker"];
const defaults = { name: "Tiancan Ni", email: "tni104@syr.edu", phone: "待补充", location: "Syracuse, New York", school: "Syracuse University", degree: "B.S. Computer Science · 2027", linkedin: "待补充", github: "待补充" };
const labels: Record<string, string> = { name: "姓名", email: "邮箱", phone: "电话", location: "当前所在地", school: "学校", degree: "学位与毕业时间", linkedin: "LinkedIn", github: "GitHub" };
const answerFields = [["Full name / 姓名", "name"], ["Email / 邮箱", "email"], ["Phone / 电话", "phone"], ["Current location / 当前所在地", "location"], ["School / 学校", "school"], ["Degree / 学位", "degree"], ["LinkedIn", "linkedin"], ["GitHub", "github"]] as const;
const sampleJobs = [
  { company: "Stripe", role: "Software Engineer Intern", place: "New York · Hybrid", stars: 5, score: 91 },
  { company: "Datadog", role: "Backend Engineering Intern", place: "Boston · Onsite", stars: 4, score: 86 },
  { company: "杭州海康威视", role: "Java 开发实习生", place: "杭州 · Onsite", stars: 4, score: 82 },
];

function loadProfile() {
  if (typeof window === "undefined") return defaults;

  try {
    const saved = window.localStorage.getItem("jobpilot-profile");
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  } catch {
    return defaults;
  }
}

function scoreJob(text: string) {
  const value = text.toLowerCase();
  const matched = skills.filter((skill) => value.includes(skill.toLowerCase()));
  const signals = ["intern", "实习", "software", "backend", "java", "full stack", "全栈"].filter((x) => value.includes(x)).length;
  const penalty = ["senior", "staff", "principal", "5+ years", "资深", "高级"].some((x) => value.includes(x)) ? 25 : 0;
  const score = Math.max(20, Math.min(96, 50 + matched.length * 6 + signals * 3 - penalty));
  return { score, stars: Math.max(1, Math.min(5, Math.ceil(score / 20))), matched };
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [profile, setProfile] = useState(loadProfile);
  const [jobText, setJobText] = useState("");
  const [result, setResult] = useState<ReturnType<typeof scoreJob> | null>(null);
  const [toast, setToast] = useState("");
  const [order, setOrder] = useState(["Remote", "Hybrid", "Onsite"]);
  const completeness = useMemo(() => Math.round(Object.values(profile).filter((x) => x && x !== "待补充").length / Object.keys(profile).length * 100), [profile]);
  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2200); }
  function save() { localStorage.setItem("jobpilot-profile", JSON.stringify(profile)); notify("资料已保存在当前设备"); }
  async function copy(value: string) { await navigator.clipboard.writeText(value); notify("已复制，可以粘贴到申请页面"); }

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">J</span><span>JobPilot</span></div><nav aria-label="主导航">{nav.map((item) => <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav><div className="sidebar-foot"><div className="local-badge"><span className="pulse" />本地模式已开启</div><p>资料只保存在此设备</p></div></aside>
    <section className="workspace">
      <header className="topbar"><div><p className="eyebrow">个人求职助手 · 网页版 V0.2</p><h1>{nav.find((x) => x.id === view)?.label}</h1></div><div className="top-actions"><button className="ghost-button" onClick={() => setView("apply")}>打开申请助手</button><button className="avatar">TN</button></div></header>
      {view === "home" && <div className="content-stack">
        <section className="hero-card"><div><span className="soft-label">无需安装扩展</span><h2>从找职位到准备申请，都在一个网页完成。</h2><p>保存个人资料，按五颗星筛选适合的工作，准备申请材料，再用逐项复制把答案填到企业招聘页面。</p><div className="hero-actions"><button className="primary-button" onClick={() => setView("jobs")}>给职位打分</button><button className="text-button" onClick={() => setView("apply")}>开始准备申请 →</button></div></div><div className="hero-score"><div className="score-ring" style={{ "--score": `${completeness * 3.6}deg` } as React.CSSProperties}><div><strong>{completeness}%</strong><span>档案完整度</span></div></div><small>完善资料后即可快速复制</small></div></section>
        <section className="metric-grid"><article><span>推荐职位</span><strong>3</strong><small>按匹配度排序</small></article><article><span>最高匹配</span><strong>5 星</strong><small>技能和地点综合评分</small></article><article><span>本月 Token</span><strong>0</strong><small>当前功能无需 AI</small></article><article><span>安装要求</span><strong>无</strong><small>浏览器打开即可</small></article></section>
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">五星推荐</p><h3>最适合你的职位</h3></div><button className="text-button" onClick={() => setView("jobs")}>分析新职位</button></div><div className="job-list">{sampleJobs.map((job) => <button className="job-row" key={job.company} onClick={() => { setView("jobs"); setJobText(`${job.role}\n${job.company}\nRequired: Java, Python, React, software engineering internship.`); }}><span className="company-logo">{job.company[0]}</span><span className="job-main"><strong>{job.role}</strong><small>{job.company} · {job.place}</small></span><span className="status great">{"★".repeat(job.stars)}{"☆".repeat(5-job.stars)}</span><span className="match"><strong>{job.score}%</strong><small>匹配</small></span><span className="chevron">›</span></button>)}</div></section>
      </div>}
      {view === "profile" && <div className="two-column"><section className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">自动复用</p><h3>个人资料卡</h3></div><span className="verified">来自你的简历</span></div><div className="field-grid">{Object.entries(profile).map(([key, value]) => <label key={key}><span>{labels[key]}</span><input value={value} onChange={(e) => setProfile({ ...profile, [key]: e.target.value })} /></label>)}</div><button className="primary-button" onClick={save}>保存到此设备</button></section><aside className="panel compact-panel"><p className="eyebrow">技能档案</p><h3>已识别技能</h3><div className="skill-cloud">{skills.map((x) => <span key={x}>{x}</span>)}</div><hr/><p className="privacy-copy"><strong>隐私保护</strong><br/>资料保存在你的浏览器本地。涉及签证、身份、薪资和人口统计的问题不会自动替你回答。</p></aside></div>}
      {view === "jobs" && <div className="two-column job-analysis-layout"><section className="panel form-panel"><p className="eyebrow">零 Token 分析</p><h3>粘贴职位描述</h3><p className="supporting">先按技能、职位级别和关键词计算五颗星匹配度。</p><textarea value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder="粘贴职位名称、公司、要求、地点和工作方式……"/><div className="inline-actions"><button className="primary-button" onClick={() => jobText.trim().length < 30 ? notify("请粘贴更完整的职位描述") : setResult(scoreJob(jobText))}>开始评分</button><button className="ghost-button" onClick={() => { setJobText(""); setResult(null); }}>清空</button></div></section><aside className="panel result-panel">{!result ? <div className="empty-state"><span>★</span><h3>等待职位信息</h3><p>评分后将显示星级、匹配技能和需要确认的风险。</p></div> : <div><p className="eyebrow">评分结果</p><div className="large-score">{result.stars}<small>/5 星</small></div><div className="star-display">{"★".repeat(result.stars)}{"☆".repeat(5-result.stars)}</div><h3>{result.score >= 80 ? "建议优先申请" : result.score >= 60 ? "值得进一步确认" : "匹配度较低"}</h3><p className="supporting">综合匹配 {result.score}%；匹配技能：{result.matched.join("、") || "暂未识别"}</p><div className="insight caution"><strong>需要你确认</strong><span>工作授权、签证支持、薪资、搬迁和最终提交必须由你本人确认。</span></div><button className="primary-button full" onClick={() => setView("apply")}>准备申请材料</button></div>}</aside></div>}
      {view === "apply" && <div className="two-column"><section className="panel form-panel"><p className="eyebrow">网页版申请助手</p><h3>逐项复制，无需安装扩展</h3><p className="supporting">打开企业申请页面后，在这里复制对应答案并粘贴。你的修改会保存到个人资料卡供下次复用。</p><div className="copy-list">{answerFields.map(([label, key]) => <div className="copy-row" key={key}><div><strong>{label}</strong><span>{profile[key]}</span></div><button className="ghost-button" onClick={() => copy(profile[key])}>复制</button></div>)}</div></section><aside className="panel compact-panel"><p className="eyebrow">安全流程</p><h3>三步完成申请</h3><ol className="step-list"><li><b>1</b><span>在招聘平台打开职位申请页</span></li><li><b>2</b><span>从左侧逐项复制并粘贴答案</span></li><li><b>3</b><span>你检查敏感问题并最终提交</span></li></ol><hr/><p className="privacy-copy">浏览器扩展仍保留为以后可选的加速工具，但不是使用本软件的必要条件。</p></aside></div>}
      {view === "settings" && <div className="two-column"><section className="panel form-panel"><p className="eyebrow">个性化排序</p><h3>工作方式优先级</h3><p className="supporting">点击即可轮换顺序，后续职位评分会按此偏好加权。</p><button className="work-order" onClick={() => setOrder([...order.slice(1), order[0]])}>{order.map((x, i) => <span key={x}><b>{i+1}</b>{x}</span>)}</button><hr/><h3>地点优先级</h3><div className="insight positive"><strong>美国</strong><span>Syracuse / New York / Remote</span></div><div className="insight positive"><strong>中国</strong><span>杭州优先，其次上海及其他机会</span></div></section><aside className="panel compact-panel"><p className="eyebrow">当前版本</p><h3>极简、低成本</h3><ul className="check-list"><li>无需注册</li><li>无需安装扩展</li><li>资料本地保存</li><li>评分不消耗 Token</li><li>保留升级小程序和软件空间</li></ul></aside></div>}
    </section>{toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}
