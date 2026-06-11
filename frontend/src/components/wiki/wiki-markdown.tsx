"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

/**
 * Renders Markdown into a `.wiki-prose` container (styles live in globals.css).
 *
 * - `remark-gfm` enables GitHub-flavored Markdown (tables, task lists, ~~strike~~).
 * - `rehype-sanitize` strips any unsafe HTML the author may have pasted, so the
 *   knowledge base can never execute injected scripts.
 */
export function WikiMarkdown({ content }: { content: string }) {
  const trimmed = (content || "").trim();

  if (!trimmed) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Această pagină este goală. Apasă „Editează" pentru a adăuga conținut.
      </p>
    );
  }

  return (
    <div className="wiki-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {trimmed}
      </ReactMarkdown>
    </div>
  );
}
