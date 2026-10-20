import { useCallback, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  ArrowRight,
  Cable,
  ChevronLeft,
  ChevronRight,
  Monitor,
  Search,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { useResource } from "@/hooks/use-resource";
import { dateTime, deviceTypes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loading, LoadError, StatusBadge } from "@/components/shared";

export function DevicesPage() {
  const { overview, session } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const { deviceId } = useParams();
  const site = params.get("site") || "";
  const kind = params.get("type") || "";
  const q = params.get("q") || "";
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const sid = session.session_id;
  const load = useCallback(
    (signal: AbortSignal) =>
      api.devices(
        sid,
        new URLSearchParams({
          site_id: site,
          device_type: kind,
          q,
          offset: String(offset),
          limit: "15",
        }),
        signal,
      ),
    [sid, site, kind, q, offset],
  );
  const result = useResource(load);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    next.delete("offset");
    setParams(next);
  }
  function page(value: number) {
    const next = new URLSearchParams(params);
    next.set("offset", String(value));
    setParams(next);
  }
  return (
    <div className={`detail-layout ${deviceId ? "has-detail" : ""}`}>
      <section className="panel asset-panel">
        <div className="panel-title">
          <h2>
            <Monitor size={17} />
            设备资产
          </h2>
          <Badge variant="secondary">{result.data?.total ?? "—"} 台</Badge>
        </div>
        <div className="filter-bar">
          <DeviceSearch
            key={q}
            query={q}
            submit={(value) => filter("q", value)}
          />
          <select
            aria-label="站点筛选"
            value={site}
            onChange={(e) => filter("site", e.target.value)}
          >
            <option value="">全部站点</option>
            {overview.sites.map((s) => (
              <option key={s.site_id} value={s.site_id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="类型筛选"
            value={kind}
            onChange={(e) => filter("type", e.target.value)}
          >
            <option value="">全部类型</option>
            {Object.entries(deviceTypes).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {result.error ? (
          <LoadError message={result.error} retry={result.reload} />
        ) : !result.data ? (
          <Loading />
        ) : (
          <>
            {!result.data.devices.length ? (
              <div className="empty-state">
                <Search size={28} />
                <h3>没有找到匹配设备</h3>
                <p>试试其他编号、型号或站点。</p>
                <Button variant="outline" onClick={() => setParams({})}>
                  清除筛选
                </Button>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>设备</th>
                      <th>所在站点</th>
                      <th>区域</th>
                      <th>型号</th>
                      <th aria-label="详情" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.devices.map((d) => (
                      <tr
                        key={d.device_id}
                        className={deviceId === d.device_id ? "selected" : ""}
                      >
                        <td>
                          <Link
                            className="device-name"
                            to={`/devices/${d.device_id}?${params}`}
                          >
                            <Monitor size={16} />
                            <span>
                              {d.device_id}
                              <small>{deviceTypes[d.device_type]}</small>
                            </span>
                          </Link>
                        </td>
                        <td>
                          {overview.sites.find((s) => s.site_id === d.site_id)
                            ?.name || d.site_id}
                        </td>
                        <td>{d.area}</td>
                        <td className="mono">{d.model}</td>
                        <td>
                          <Button asChild variant="ghost" size="icon">
                            <Link
                              aria-label={`查看 ${d.device_id}`}
                              to={`/devices/${d.device_id}?${params}`}
                            >
                              <ArrowRight size={15} />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pagination">
              <span>
                共 {result.data.total} 台 · 第 {Math.floor(offset / 15) + 1} 页
              </span>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!offset}
                  onClick={() => page(Math.max(0, offset - 15))}
                >
                  <ChevronLeft size={14} />
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={result.data.next_offset === null}
                  onClick={() => page(result.data!.next_offset!)}
                >
                  下一页
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
      {deviceId && <DeviceDetail key={`${sid}:${deviceId}`} id={deviceId} />}
    </div>
  );
}
function DeviceSearch({
  query,
  submit,
}: {
  query: string;
  submit: (value: string) => void;
}) {
  const [search, setSearch] = useState(query);
  return (
    <form
      className="search-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit(search);
      }}
    >
      <Search size={16} />
      <Input
        aria-label="搜索设备编号或型号"
        placeholder="搜索设备编号或型号"
        value={search}
        maxLength={100}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Button variant="ghost" size="sm" type="submit">
        搜索
      </Button>
    </form>
  );
}
function DeviceDetail({ id }: { id: string }) {
  const { session } = useWorkspace();
  const [params] = useSearchParams();
  const sid = session.session_id;
  const result = useResource(
    useCallback(
      (signal: AbortSignal) => api.device(sid, id, signal),
      [sid, id],
    ),
  );
  const d = result.data;
  const metrics: Record<string, string> = {
    associated_clients: "关联终端",
    uplink: "上联链路",
    poe: "PoE 供电",
    wan_link: "WAN 链路",
    wan_address_assigned: "WAN 地址分配",
  };
  return (
    <aside className="panel device-detail" aria-label="设备详情">
      <div className="panel-title">
        <h2>设备详情</h2>
        <Button asChild variant="ghost" size="icon">
          <Link to={`/devices?${params}`} aria-label="关闭设备详情">
            <X size={16} />
          </Link>
        </Button>
      </div>
      {result.error ? (
        <LoadError message={result.error} retry={result.reload} />
      ) : !d ? (
        <Loading />
      ) : (
        <div className="detail-body">
          <div className="device-hero">
            <div className="device-icon">
              <Monitor size={27} />
            </div>
            <h3>{d.device.device_id}</h3>
            <p>
              {d.device.vendor} · {d.device.model}
            </p>
            <StatusBadge value={d.status?.online_state} />
          </div>
          <div className="info-grid">
            <span>部署区域</span>
            <strong>{d.device.area}</strong>
            <span>设备类型</span>
            <strong>{deviceTypes[d.device.device_type]}</strong>
            <span>固件版本</span>
            <strong>{d.device.firmware_version}</strong>
          </div>
          <div className="section-label">
            状态快照 <Badge variant="outline">模拟</Badge>
          </div>
          {d.status ? (
            <>
              <p className="muted tiny">
                记录时间：{dateTime(d.status.observed_at)}
              </p>
              <div className="info-grid">
                {Object.entries(d.status.metrics).map(([key, value]) => (
                  <div className="info-row" key={key}>
                    <span>{metrics[key] || key}</span>
                    <strong>
                      {value === null
                        ? "未采集"
                        : value === true
                          ? "是"
                          : value === false
                            ? "否"
                            : String(value)}
                    </strong>
                  </div>
                ))}
              </div>
              {d.status.alarms.map((alarm, i) => (
                <p key={i} className="inline-warning">
                  {alarm}
                </p>
              ))}
            </>
          ) : (
            <p className="inline-warning">
              当前案例没有状态记录，不能据此判断设备正常。
            </p>
          )}
          <h4 className="section-label">
            <Cable size={15} />
            一跳连接关系
          </h4>
          {d.neighbors.length ? (
            d.neighbors.map((link) => (
              <div className="neighbor" key={link.link_id}>
                <Badge variant="secondary">
                  {link.relation === "uplink" ? "物理上联" : "控制器管理"}
                </Badge>
                <p>
                  {link.src_device_id} → {link.dst_device_id}
                </p>
                <small>
                  {link.src_port || "—"} → {link.dst_port || "—"}
                </small>
              </div>
            ))
          ) : (
            <p className="muted">没有已记录的连接关系。</p>
          )}
          <Button className="w-full mt-5" asChild>
            <Link to={`/assistant?device=${encodeURIComponent(id)}`}>
              围绕此设备排查
              <ArrowRight size={16} />
            </Link>
          </Button>
        </div>
      )}
    </aside>
  );
}
