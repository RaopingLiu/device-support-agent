import { AlertCircle, ArrowUpRight, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { Source } from "@/lib/types";

export function Loading({ text = "正在加载…" }: { text?: string }) {
  return (
    <div className="empty-state" role="status">
      <LoaderCircle className="animate-spin" size={22} />
      <p>{text}</p>
    </div>
  );
}
export function LoadError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="empty-state" role="alert">
      <AlertCircle size={24} />
      <p>{message}</p>
      <Button variant="outline" onClick={retry}>
        重试
      </Button>
    </div>
  );
}
export function StatusBadge({ value }: { value?: string }) {
  const labels: Record<string, string> = {
    online: "在线",
    offline: "离线",
    unknown: "未知",
    open: "待处理",
    pending: "待确认",
  };
  return (
    <Badge variant="outline" className={`gap-1.5 status-${value || "unknown"}`}>
      <span className="status-dot" />
      {labels[value || "unknown"] || value}
    </Badge>
  );
}
export function SourceLink({
  source,
  number,
}: {
  source: Source;
  number?: number;
}) {
  let href: string | undefined;
  try {
    const url = new URL(source.source_url, window.location.origin);
    if (["http:", "https:"].includes(url.protocol)) href = url.href;
  } catch {
    /* 无效链接仅显示标题 */
  }
  return (
    <a
      href={href}
      target={href ? "_blank" : undefined}
      rel="noopener noreferrer"
      className="source-link"
    >
      {number ? `[${number}] ` : ""}
      {source.title}
      <ArrowUpRight size={13} />
    </a>
  );
}
// React 默认转义文本，只支持加粗与行内代码，不执行模型生成的 HTML。
export function MessageText({ text }: { text: string }) {
  return (
    <div className="message-body">
      {text
        .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
        .map((part, i) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={i}>{part.slice(2, -2)}</strong>
          ) : part.startsWith("`") && part.endsWith("`") ? (
            <code key={i}>{part.slice(1, -1)}</code>
          ) : (
            part
          ),
        )}
    </div>
  );
}
