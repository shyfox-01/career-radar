import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { jobsToXlsx } from "../src/domain/xlsx.js";
test("Excel separates internships and full-time jobs and treats untrusted titles as literal text", async () => {
  const data = await jobsToXlsx({
    jobs: [
      {
        title: '=HYPERLINK("evil")',
        company: "A & B",
        employmentType: "internship",
        status: "applied",
        url: "https://example.com/job/1",
      },
      { title: "Engineer", company: "Example", employmentType: "full_time", status: "new" },
    ],
    sourceCheckpoints: {
      one: {
        pagesRead: 2,
        uniqueJobs: 40,
        complete: false,
        stopReason: "page_limit",
        nextUrl: "https://example.com/page/3",
      },
    },
  });
  const zip = await JSZip.loadAsync(data);
  const workbook = await zip.file("xl/workbook.xml").async("string");
  assert.match(workbook, /Internships/);
  assert.match(workbook, /Full-time/);
  assert.match(workbook, /Search coverage/);
  const interns = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(interns, /HYPERLINK/);
  assert.doesNotMatch(interns, /<f[ >]/);
  assert.match(interns, /applied/);
  assert.match(interns, /A &amp; B/);
  assert.match(interns, /<pane.*state="frozen"/);
  assert.match(interns, /<autoFilter/);
  const coverage = await zip.file("xl/worksheets/sheet4.xml").async("string");
  assert.match(coverage, /page_limit/);
  assert.match(coverage, /Incomplete/);
});

test("Excel keeps all eligible jobs in primary tabs and exposes fit and source-field evidence", async () => {
  const data = await jobsToXlsx({
    jobs: [
      {
        id: "good",
        title: "Data Analyst Intern",
        company: "Example Pte Ltd",
        employmentType: "internship",
        status: "new",
        url: "https://example.com/good",
        reviewStatus: "recommended",
        reviewReasons: [],
        fitLevel: "strong",
        fitReasons: ["description_skill_evidence"],
        dataWarnings: [],
      },
      {
        id: "broad",
        title: "Marketing Intern",
        company: "Example Pte Ltd",
        employmentType: "internship",
        status: "new",
        url: "https://example.com/broad",
        reviewStatus: "recommended",
        reviewReasons: [],
        fitLevel: "broad",
        fitReasons: ["limited_role_evidence"],
        dataWarnings: [],
      },
      {
        id: "dirty",
        title: "Data Science Intern",
        company: "Strides Digital",
        rawCompany: "Strides Digitalstridesdigital.com.sg",
        employmentType: "internship",
        status: "new",
        url: "https://example.com/dirty",
        reviewStatus: "recommended",
        reviewReasons: [],
        fitLevel: "strong",
        fitReasons: ["title_role_evidence"],
        dataWarnings: ["source_company_normalized"],
      },
    ],
  });
  const zip = await JSZip.loadAsync(data);
  const workbook = await zip.file("xl/workbook.xml").async("string");
  assert.match(workbook, /Needs review/);
  const recommended = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(recommended, /Data Analyst Intern/);
  assert.match(recommended, /Marketing Intern/);
  assert.match(recommended, /Strides Digitalstridesdigital.com.sg/);
  assert.match(recommended, /Fit level/);
  assert.match(recommended, /broad/);
  assert.match(recommended, /Company name tidied from the site/);
  assert.doesNotMatch(recommended, /source_company_normalized/);
  const review = await zip.file("xl/worksheets/sheet3.xml").async("string");
  assert.doesNotMatch(review, /Marketing Intern/);
});

test("Excel groups a job by the search that found it when the listing states no type", async () => {
  const data = await jobsToXlsx({
    jobs: [
      {
        id: "stated",
        title: "Data Analyst Intern",
        company: "A",
        employmentType: "internship",
        targetEmploymentType: "internship",
        url: "https://example.com/a",
      },
      {
        id: "inferred",
        title: "Data Analyst",
        company: "B",
        employmentType: "unknown",
        targetEmploymentType: "full_time",
        url: "https://example.com/b",
      },
      {
        id: "orphan",
        title: "Data Analyst",
        company: "C",
        employmentType: "unknown",
        url: "https://example.com/c",
      },
    ],
  });
  const zip = await JSZip.loadAsync(data);
  const fullTime = await zip.file("xl/worksheets/sheet2.xml").async("string");
  assert.match(fullTime, /https:\/\/example.com\/b/);
  assert.match(fullTime, /From your search only/);
  assert.doesNotMatch(fullTime, /https:\/\/example.com\/c/);
  const interns = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(interns, /Stated in listing/);
  const unconfirmed = await zip.file("xl/worksheets/sheet5.xml").async("string");
  assert.match(unconfirmed, /https:\/\/example.com\/c/);
  assert.doesNotMatch(unconfirmed, /https:\/\/example.com\/b/);
});

test("Excel shows the notes an AI wrote when it chose a job", async () => {
  const data = await jobsToXlsx({
    jobs: [
      {
        id: "ai",
        title: "Data Analyst Intern",
        company: "Example",
        employmentType: "internship",
        url: "https://example.com/ai",
        matchReasons: ["SQL matches the resume"],
        missingRequirements: ["Two years of experience"],
      },
    ],
  });
  const interns = await (await JSZip.loadAsync(data))
    .file("xl/worksheets/sheet1.xml")
    .async("string");
  assert.match(interns, /AI: why it fits/);
  assert.match(interns, /SQL matches the resume/);
  assert.match(interns, /Two years of experience/);
  assert.match(interns, /<autoFilter ref="A1:R2"\/>/);
});
