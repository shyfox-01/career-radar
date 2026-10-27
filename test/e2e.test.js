import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { createCareerRadarServer } from "../src/server.js";

test("the local server delivers the complete browser workspace", async (context) => {
  const dataRoot = path.resolve(".career-radar-data", "tests", "e2e");
  await rm(dataRoot, { recursive: true, force: true });
  await mkdir(dataRoot, { recursive: true });
  const server = createCareerRadarServer({ dataRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataRoot, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const [page, styles, script] = await Promise.all([
    fetch(`${origin}/`).then(async (response) => ({
      status: response.status,
      body: await response.text(),
    })),
    fetch(`${origin}/styles.css`),
    fetch(`${origin}/app.js`).then(async (response) => ({
      status: response.status,
      body: await response.text(),
    })),
  ]);

  assert.equal(page.status, 200);
  assert.match(page.body, /Career Radar/);
  assert.match(page.body, /<html lang="zh-CN">/);
  assert.match(page.body, /Turn a Resume into a Focused Search Map\./);
  assert.match(page.body, /<h2>Resume Profile<\/h2>/);
  assert.match(page.body, /<h2>Local Model<\/h2>/);
  assert.match(page.body, /id="provider-list"/);
  assert.match(page.body, /No cloud AI/);
  assert.doesNotMatch(page.body, /api-config-form|Codex|Claude|Gemini/);
  assert.match(page.body, /<h2>Markets &amp; Role Families<\/h2>/);
  assert.match(page.body, /<h2>Search Sources<\/h2>/);
  assert.match(page.body, /id="source-catalog"/);
  assert.match(page.body, /DEFAULT \/ 默认/);
  assert.match(page.body, /id="queue-state"/);
  assert.match(page.body, /<h3>Company Watchlist<\/h3>/);
  assert.match(page.body, /id="company-form"/);
  assert.match(page.body, /id="company-list"/);
  assert.match(page.body, /<h2>Job List &amp; Applications<\/h2>/);
  assert.match(page.body, /Drop a file or choose one/);
  assert.match(page.body, /拖入文件或选择文件/);
  assert.match(page.body, /Generate Search Map \/ 生成搜索路线/);
  assert.match(page.body, /Find \/ Continue Jobs/);
  assert.match(page.body, /Import Previous CSV \/ 导入上次结果/);
  assert.match(page.body, /History &amp; Recovery/);
  assert.match(page.body, /Local history auto-saved \/ 本机记录已自动保存/);
  assert.match(page.body, /Download Import Audit \/ 下载导入审计/);
  assert.match(page.body, /<h2>Career Preferences<\/h2>/);
  assert.match(page.body, /id="preferences-form"/);
  assert.match(page.body, /name="graduationDate"/);
  assert.match(page.body, /name="internshipAvailableFrom"/);
  assert.match(page.body, /JOB SKILLS \/ 求职技能/);
  assert.doesNotMatch(page.body, /name="educationLevel"/);
  assert.doesNotMatch(page.body, /name="school"/);
  assert.doesNotMatch(page.body, /name="major"/);
  assert.doesNotMatch(page.body, /name="internshipEnd"/);
  assert.doesNotMatch(page.body, /name="earliestFullTimeStart"/);
  assert.doesNotMatch(page.body, /name="workAuthorizationNote"/);
  assert.match(page.body, /Save Preferences \/ 保存补充资料/);
  assert.match(page.body, /id="role-suggestions"/);
  assert.match(page.body, /Suggest Roles \/ 生成岗位建议/);
  assert.match(page.body, /Approve Selected Roles \/ 确认所选岗位/);
  assert.match(page.body, /Connect \/ 登录连接/);
  assert.match(page.body, /Excel includes jobs and a Search coverage sheet/);
  assert.match(page.body, /id="auto-continue-search"/);
  assert.match(page.body, /Add a Found Job \/ 添加已经找到的职位/);
  assert.match(page.body, /id="job-quality-summary"/);
  assert.match(page.body, /id="show-needs-review"/);
  assert.match(page.body, /class="coverage-banner source-session-help"/);
  assert.match(page.body, /id="jobs-body" class="job-ledger-list"/);
  assert.doesNotMatch(page.body, /<table>/);
  assert.match(page.body, /具体实习时长、出勤天数、开始日期和灵活安排仍需与雇主确认。/);
  assert.match(page.body, /新加坡/);
  assert.match(page.body, /中国大陆/);
  assert.match(page.body, /中国香港/);
  assert.equal(styles.status, 200);
  assert.equal(script.status, 200);
  assert.match(script.body, /请先上传简历并生成搜索路线/);
  assert.match(script.body, /已投递/);
  assert.match(script.body, /reviewStatus/);
  assert.match(script.body, /needs_review/);
  assert.match(script.body, /job-ledger-row/);
  assert.match(script.body, /job-details/);
  assert.doesNotMatch(script.body, /windowHelp/);
  assert.doesNotMatch(script.body, /ADAPTER ·/);
  assert.doesNotMatch(script.body, /Login may be required/);
});
