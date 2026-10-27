import JSZip from "jszip";

const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const xml = (value) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, 32767)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
// The same wording as the interface (public/app.js); unknown codes show as is.
const NOTE_LABELS = {
  title_role_evidence: "Job title matches the role / 职位名称与岗位相符",
  description_skill_evidence: "Description names the role's skills / 职位描述提到相关技能",
  adjacent_role_evidence: "Related role / 相关岗位",
  limited_role_evidence: "Little direct evidence / 直接依据较少",
  source_company_normalized: "Company name tidied from the site's text / 公司名已按网站原文整理",
  source_company_unresolved: "The site gives no usable company name / 网站未给出可用的公司名",
};
const notes = (codes) => (codes ?? []).map((code) => NOTE_LABELS[code] ?? code).join("; ");
function column(index) {
  let name = "";
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
function sheet(rows, widths) {
  const links = [];
  const cells = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}" ht="${r ? 32 : 34}" customHeight="1">${row
          .map((value, c) => {
            const ref = `${column(c)}${r + 1}`;
            if (r && typeof value === "string" && /^https:\/\//i.test(value)) {
              try {
                const u = new URL(value);
                if (!u.username && !u.password) links.push({ ref, url: u.href });
              } catch {}
            }
            return typeof value === "number" && Number.isFinite(value)
              ? `<c r="${ref}" s="${r ? 2 : 1}"><v>${value}</v></c>`
              : `<c r="${ref}" s="${r ? 0 : 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${cells}</sheetData><autoFilter ref="A1:${column(widths.length - 1)}${Math.max(1, rows.length)}"/>${links.length ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="link${i + 1}"/>`).join("")}</hyperlinks>` : ""}</worksheet>`,
    rels: links.length
      ? `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((l, i) => `<Relationship Id="link${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(l.url)}" TargetMode="External"/>`).join("")}</Relationships>`
      : null,
  };
}
export async function jobsToXlsx(workspace) {
  const jobs = workspace.jobs ?? [];
  const headers = [
    "Job title / 职位",
    "Company / 公司",
    "Location / 地点",
    "Type / 类型",
    "Type evidence / 类型依据",
    "Status / 投递状态",
    "Source / 来源",
    "Apply URL / 投递链接",
    "Posted / 发布时间",
    "Duration / 时长",
    "Evidence / 核验状态",
    "Fit level / 匹配层级",
    "Fit evidence / 匹配依据",
    "AI: why it fits / AI 匹配理由",
    "AI: gaps to check / AI 欠缺条件",
    "Data warning / 数据提示",
    "Raw company / 原始公司字段",
    "Record ID / 记录编号",
  ];
  // Most listings never label their own employment type. Grouping strictly by the
  // listing leaves a full-time search with an empty Full-time tab, so fall back to
  // the type the search asked for and say in the row which of the two it was.
  const statedType = (j) =>
    ["internship", "full_time", "part_time"].includes(j.employmentType) ? j.employmentType : null;
  const tabType = (j) =>
    statedType(j) ??
    (["internship", "full_time"].includes(j.targetEmploymentType) ? j.targetEmploymentType : null);
  const typeEvidence = (j) =>
    statedType(j)
      ? "Stated in listing / 招聘信息标注"
      : tabType(j)
        ? "From your search only / 仅依据搜索条件，请自行确认"
        : "Not stated / 未标注";
  const jobWidths = [44, 28, 22, 16, 34, 18, 24, 62, 24, 20, 24, 18, 32, 40, 40, 32, 38, 30];
  const fitOrder = { strong: 0, adjacent: 1, broad: 2 };
  const ordered = (list) =>
    [...list].sort((a, b) => (fitOrder[a.fitLevel] ?? 9) - (fitOrder[b.fitLevel] ?? 9));
  const values = (j) => [
    j.title,
    j.company,
    j.location,
    statedType(j) ?? j.employmentType,
    typeEvidence(j),
    j.status ?? "new",
    j.source,
    j.url,
    j.postedAt ?? j.postedText,
    j.duration ?? j.internshipDuration,
    j.verification,
    j.fitLevel ?? "",
    notes(j.fitReasons),
    (j.matchReasons ?? []).join("; "),
    (j.missingRequirements ?? []).join("; "),
    notes(j.dataWarnings),
    j.rawCompany ?? j.company,
    j.id,
  ];
  const jobRows = (list) => [headers, ...ordered(list).map(values)];
  const reviewReasonLabels = {
    critical_field_missing:
      "critical_field_missing — Critical job data is unreadable / 关键职位字段无法读取",
  };
  const reviewRows = (list) => [
    [...headers, "Review reason / 复核原因"],
    ...ordered(list).map((j) => [
      ...values(j),
      (j.reviewReasons ?? []).map((reason) => reviewReasonLabels[reason] ?? reason).join("; "),
    ]),
  ];
  const recommended = jobs.filter((j) => j.reviewStatus !== "needs_review");
  const needsReview = jobs.filter((j) => j.reviewStatus === "needs_review");
  const sheets = [
    {
      name: "Internships",
      rows: jobRows(recommended.filter((j) => tabType(j) === "internship")),
      widths: jobWidths,
    },
    {
      name: "Full-time",
      rows: jobRows(recommended.filter((j) => tabType(j) === "full_time")),
      widths: jobWidths,
    },
    { name: "Needs review", rows: reviewRows(needsReview), widths: [...jobWidths, 52] },
    {
      name: "Search coverage",
      rows: [
        [
          "Search task / 搜索组合",
          "Pages / 已读页数",
          "Jobs / 去重职位数",
          "Coverage / 是否完成",
          "Stop reason / 停止原因",
          "Resume URL / 继续位置",
        ],
        ...[
          ...new Set([
            ...(workspace.searchPlan ?? []).map((t) => t.id),
            ...Object.keys(workspace.sourceCheckpoints ?? {}),
          ]),
        ].map((task) => {
          const s = workspace.sourceCheckpoints?.[task] ?? {};
          const failure = workspace.lastSourceAdapterRun?.failedTasks?.find(
            (f) => f.taskId === task,
          );
          return [
            task,
            s.pagesRead ?? 0,
            s.uniqueJobs ?? 0,
            s.complete
              ? "Last page reached / 已到末页"
              : "Incomplete or unverified / 未完成或未核实",
            failure?.code ?? s.stopReason ?? "not_verified",
            s.nextUrl ?? workspace.searchPlan?.find((t) => t.id === task)?.searchUrl,
          ];
        }),
      ],
      widths: [55, 18, 22, 35, 30, 70],
    },
    {
      name: "Type to confirm",
      rows: jobRows(recommended.filter((j) => !tabType(j))),
      widths: jobWidths,
    },
  ];
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0"?><styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173B40"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  sheets.forEach((s, i) => {
    const output = sheet(s.rows, s.widths);
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, output.xml);
    if (output.rels) zip.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, output.rels);
  });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
