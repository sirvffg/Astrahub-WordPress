// 关系图谱 API：经插件 /hub/get 代理签名转发 Hub /v1/graph/*。
// 对应 Halo 端 AstraHubGraphRouter + useRelationGraph.ts 的数据流。
import { api } from "./client";

export interface GraphNodeFriendLink {
  id: string;
  sourceSiteId?: string;
  sourceSiteName?: string;
  sourceSiteUrl?: string;
  title: string;
  url: string;
  description?: string;
  logo?: string;
  rssUrl?: string;
  targetSiteId?: string;
  targetRegistered: boolean;
  targetNodeId?: string;
  targetNodeName?: string;
  targetAvatar?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
}

export interface GraphNodeSummary {
  nodeId: string;
  name: string;
  avatar?: string;
  status: string;
  primarySite?: { siteId?: string; name?: string; url?: string; avatar?: string };
  activeSites?: Array<{ siteId?: string; name?: string; url?: string; avatar?: string }>;
}

export interface GraphNodeListItem {
  summary: GraphNodeSummary;
  metrics?: Record<string, unknown>;
}

export interface GraphTopologyResponse {
  generatedAt: string;
  nodes: GraphNodeListItem[];
  nodeLinks: Array<{ sourceNodeId: string; friendLinks: GraphNodeFriendLink[] }>;
  siteNodeIds: Record<string, string>;
}

export async function fetchGraphTopology(signal?: AbortSignal): Promise<GraphTopologyResponse> {
  const response = await api.post<GraphTopologyResponse>("/hub/get", {
    path: "/v1/graph/topology", query: {}
  }, signal);
  if (!response.success) throw new Error(response.message || "加载关系图失败");
  const data = response.data;
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.nodeLinks)) {
    throw new Error("关系图数据格式异常，请刷新重试");
  }
  return data;
}

