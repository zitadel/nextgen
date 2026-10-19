// An operation's or a webhook's OpenAPI description is long-form CommonMark,
// written for the page's body. A page's description is a line of plain text:
// the meta and Open Graph description, the line under the title on the Open
// Graph image, the page's entry in llms.txt. This is the first sentence of the
// description's first paragraph, without its Markdown, cut at a word if it is
// longer than search results and the Open Graph image have room for.

const maxLength = 160;

const codeSpan = /(`+)(.+?)\1(?!`)/g;

// A sentence ends at a full stop, question or exclamation mark that is
// followed by a space and something other than a lower-case letter: a capital,
// a quote ('"Active" here means'), a code span, a digit. Abbreviations end in
// a full stop but not a sentence.
const sentenceEnd = /(?<!\b(?:[Ee]\.g|[Ii]\.e|[Cc]f|[Vv]s))[.!?](?= +[^a-z ])/;

export function shortDescription(markdown: string) {
  const [paragraph = ""] = markdown.trim().split(/\n[ \t]*\n/);
  const text = paragraph.replace(/\s+/g, " ").trim();
  // The search skips code spans, whose text is literal (`GET /users. Then`),
  // and takes one as the start of a sentence: "revision. `GET /idps` lists".
  const masked = text.replace(codeSpan, (span) => "X".repeat(span.length));
  const end = sentenceEnd.exec(masked);
  const sentence = end ? text.slice(0, end.index + 1) : text;

  let plain = "";
  let last = 0;
  for (const match of sentence.matchAll(codeSpan)) {
    plain += prose(sentence.slice(last, match.index)) + (match[2] ?? "").trim();
    last = match.index + match[0].length;
  }
  plain += prose(sentence.slice(last));
  plain = plain.replace(/\s+/g, " ").trim();

  if (plain.length <= maxLength) return plain;
  return `${plain
    .slice(0, maxLength)
    .replace(/\s+\S*$/, "")
    .replace(/[,;:]$/, "")}…`;
}

// Markdown outside a code span: images and links keep their text, emphasis its
// content, an escaped character itself.
function prose(markdown: string) {
  return markdown
    .replace(/!?\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(?<![\w*])([*_])(?=\S)(.+?)(?<=\S)\1(?![\w*])/g, "$2")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1");
}
