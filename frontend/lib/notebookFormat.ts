function normalizeLineBreaks(input: string) {
  return input.replace(/\r/g, "");
}

function collapseBlankLines(input: string) {
  return input.replace(/\n{3,}/g, "\n\n");
}

function notebookHeader(filename: string) {
  return `# ${filename} 笔记本`;
}

function pageSectionHeader(pageNum: number, pageTitle: string) {
  return `## 第 ${pageNum} 页 · ${pageTitle}`;
}

export type NotebookOutlineItem = {
  pageNum: number;
  title: string;
  heading: string;
  label: string;
};

function outlineHeading(pageNum: number, pageTitle: string) {
  return `第 ${pageNum} 页 · ${pageTitle}`;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatNotebookMarkdown(input: string, filename: string) {
  const trimmed = collapseBlankLines(normalizeLineBreaks(input)).trim();
  const header = notebookHeader(filename);
  if (!trimmed) {
    return `${header}\n\n`;
  }

  const withoutHeader = trimmed.replace(/^# .+?笔记本\s*/u, "").trim();
  const body = withoutHeader ? `${withoutHeader}\n` : "";
  return `${header}\n\n${collapseBlankLines(body).trim()}\n`.replace(/\n{3,}/g, "\n\n");
}

export function insertSelectionIntoNotebook(params: {
  markdown: string;
  filename: string;
  pageNum: number;
  pageTitle: string;
  selectedText: string;
  sourceLabel: string;
}): { markdown: string; inserted: boolean } {
  const cleanText = normalizeLineBreaks(params.selectedText).trim();
  if (!cleanText) {
    return { markdown: formatNotebookMarkdown(params.markdown, params.filename), inserted: false };
  }

  const header = notebookHeader(params.filename);
  const section = pageSectionHeader(params.pageNum, params.pageTitle);
  const quote = cleanText
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const sourceLine = `_来源：第 ${params.pageNum} 页 · ${params.sourceLabel}_`;
  const block = `${quote}\n\n${sourceLine}`;

  let markdown = formatNotebookMarkdown(params.markdown, params.filename);
  if (!markdown.startsWith(header)) {
    markdown = `${header}\n\n${markdown.trim()}\n`;
  }

  const sectionRegex = new RegExp(
    `(^${escapeRegex(section)}\\s*[\\s\\S]*?)(?=^##\\s+第\\s+\\d+\\s+页\\s+·|\\Z)`,
    "m",
  );
  const match = markdown.match(sectionRegex);

  if (!match) {
    const appended = `${markdown.trim()}\n\n${section}\n\n### 摘录\n\n${block}\n`;
    return { markdown: collapseBlankLines(appended).trimEnd() + "\n", inserted: true };
  }

  const sectionContent = match[1];
  if (sectionContent.includes(block)) {
    return { markdown, inserted: false };
  }

  let nextSectionContent = sectionContent;
  if (/^###\s+摘录\s*$/m.test(sectionContent)) {
    nextSectionContent = sectionContent.trimEnd() + `\n\n${block}\n`;
  } else {
    nextSectionContent = sectionContent.trimEnd() + `\n\n### 摘录\n\n${block}\n`;
  }

  const replaced = markdown.replace(sectionRegex, nextSectionContent);
  return { markdown: collapseBlankLines(replaced).trimEnd() + "\n", inserted: true };
}

export function inferPageTitle(params: {
  fallbackPageNum: number;
  explanationTitle?: string | null;
  extractTitle?: string | null;
}) {
  const preferred = [params.explanationTitle, params.extractTitle]
    .map((item) => (item ?? "").trim())
    .find(Boolean);
  return preferred || `第 ${params.fallbackPageNum} 页`;
}

export function extractNotebookOutline(markdown: string): NotebookOutlineItem[] {
  const lines = normalizeLineBreaks(markdown).split("\n");
  const items: NotebookOutlineItem[] = [];
  for (const line of lines) {
    const match = line.match(/^##\s+第\s+(\d+)\s+页\s+·\s+(.+)$/);
    if (!match) continue;
    const pageNum = Number(match[1]);
    const title = match[2].trim();
    const heading = outlineHeading(pageNum, title);
    items.push({
      pageNum,
      title,
      heading,
      label: `P${pageNum}`,
    });
  }
  return items;
}
