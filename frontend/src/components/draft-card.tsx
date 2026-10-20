import { useState } from "react";
import { useNavigate } from "react-router";
import { FileCheck2, FilePenLine } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import type { Draft } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";

export function DraftCard() {
  const { session } = useWorkspace();
  const d = session.draft;
  return (
    <section className="panel draft-panel" aria-label="报障草稿">
      <div className="panel-title">
        <h2>
          <FilePenLine size={17} />
          报障草稿
        </h2>
        <Badge variant="secondary">需确认</Badge>
      </div>
      {d ? (
        <DraftEditor key={`${d.draft_id}:${d.revision}`} draft={d} />
      ) : (
        <div className="empty-state compact">
          <FileCheck2 size={28} />
          <p>当前没有待确认草稿</p>
          <span>在对话中告诉助手“帮我整理报障工单”。</span>
        </div>
      )}
    </section>
  );
}
function DraftEditor({ draft }: { draft: Draft }) {
  const { busy, editDraft, confirmDraft, cancelDraft } = useWorkspace();
  const navigate = useNavigate();
  const [payload, setPayload] = useState(draft.payload);
  const [confirming, setConfirming] = useState(false);
  const dirty = JSON.stringify(payload) !== JSON.stringify(draft.payload);
  return (
    <div className="draft-editor">
      <div className="small-meta">
        {draft.payload.site_id} · {draft.payload.area || "区域待确认"}
        <span>版本 {draft.revision}</span>
      </div>
      <p className="mono muted tiny">{draft.draft_id}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void editDraft(draft, payload);
        }}
      >
        <label className="field">
          摘要
          <Input
            value={payload.summary}
            minLength={3}
            maxLength={120}
            required
            disabled={!!busy}
            onChange={(e) => {
              setConfirming(false);
              setPayload({ ...payload, summary: e.target.value });
            }}
          />
        </label>
        <label className="field">
          故障描述
          <Textarea
            rows={4}
            value={payload.description}
            minLength={5}
            maxLength={3000}
            required
            disabled={!!busy}
            onChange={(e) => {
              setConfirming(false);
              setPayload({ ...payload, description: e.target.value });
            }}
          />
        </label>
        <label className="field">
          影响范围
          <Input
            value={payload.impact}
            maxLength={300}
            disabled={!!busy}
            onChange={(e) => {
              setConfirming(false);
              setPayload({ ...payload, impact: e.target.value });
            }}
          />
        </label>
        {payload.device_ids.length > 0 && (
          <p className="muted tiny">
            关联设备：{payload.device_ids.join("、")}
          </p>
        )}
        <details className="checks">
          <summary>已确认检查（{payload.checks.length}）</summary>
          {payload.checks.length ? (
            <ul>
              {payload.checks.map((check, i) => (
                <li key={i}>{check}</li>
              ))}
            </ul>
          ) : (
            <p>尚未记录用户确认做过的检查。</p>
          )}
        </details>
        {dirty && (
          <p className="inline-warning" role="status">
            有未保存修改，请先保存再确认。
          </p>
        )}
        <div className="button-row">
          <Button type="submit" variant="outline" disabled={!dirty || !!busy}>
            保存修改
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!!busy}
            onClick={() => void cancelDraft(draft)}
          >
            取消草稿
          </Button>
        </div>
      </form>
      {confirming ? (
        <div className="confirm-box" role="group" aria-label="确认保存工单">
          <p>确认将当前草稿保存为正式工单？</p>
          <div className="button-row">
            <Button
              disabled={!!busy || dirty}
              onClick={async () => {
                const ticket = await confirmDraft(draft);
                if (ticket) navigate(`/tickets/${ticket.ticket_id}`);
              }}
            >
              确认保存工单
            </Button>
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => setConfirming(false)}
            >
              返回检查
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="w-full"
          disabled={dirty || !!busy}
          onClick={() => setConfirming(true)}
        >
          确认提交
        </Button>
      )}
    </div>
  );
}
