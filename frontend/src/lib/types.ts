export interface Site {
  site_id: string;
  name: string;
  city: string;
  site_type: string;
}
export interface Overview {
  sites: Site[];
  device_count: number;
  scenarios: Record<string, string>;
  knowledge: { chunks: number; indexed: boolean };
}
export interface Device {
  device_id: string;
  site_id: string;
  area: string;
  name: string;
  device_type: string;
  vendor: string;
  model: string;
  firmware_version: string;
}
export interface DeviceStatus {
  device_id: string;
  scenario_id: string;
  online_state: "online" | "offline" | "unknown";
  observed_at: string;
  is_simulated: boolean;
  metrics: Record<string, string | number | boolean | null>;
  alarms: string[];
}
export interface DeviceLink {
  link_id: string;
  src_device_id: string;
  dst_device_id: string;
  src_port: string | null;
  dst_port: string | null;
  relation: "uplink" | "managed_by";
}
export interface DeviceDetail {
  device: Device;
  status: DeviceStatus | null;
  neighbors: DeviceLink[];
}
export interface DraftPayload {
  site_id: string;
  area: string;
  summary: string;
  description: string;
  impact: string;
  device_ids: string[];
  checks: string[];
}
export interface Draft {
  draft_id: string;
  session_id: string;
  revision: number;
  payload: DraftPayload;
  state: "pending" | "cancelled" | "submitted";
  created_at: string;
  updated_at: string;
}
export interface Ticket {
  ticket_id: string;
  draft_id: string;
  draft_revision: number;
  session_id: string;
  payload: DraftPayload;
  status: string;
  created_at: string;
}
export interface Source {
  chunk_id: string;
  text: string;
  title: string;
  source_url: string;
  section: string;
  source_type: string;
}
export interface ToolTrace {
  tool: string;
  args: Record<string, unknown>;
  result: {
    status: string;
    data: unknown;
    error: { code: string; message: string } | null;
  };
}
export interface Message {
  role: "user" | "assistant" | "system";
  reply: string;
  citations?: Source[];
  retrieved?: Source[];
  trace?: ToolTrace[];
  error?: { code: string } | null;
}
export interface ChatReply extends Omit<Message, "role"> {
  draft: Draft | null;
  stage: string;
}
export interface Session {
  session_id: string;
  scenario_id: string;
  created_at: string;
  messages: Message[];
  draft: Draft | null;
}
export interface DevicePage {
  devices: Device[];
  total: number;
  next_offset: number | null;
}
export interface TicketPage {
  tickets: Ticket[];
  total: number;
  next_offset: number | null;
}
