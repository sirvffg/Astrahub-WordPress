// 使用 Hub 完整拓扑快照，不逐节点拼接不同时刻的数据。
import { computed, onScopeDispose, ref } from "vue";
import { fetchGraphTopology, type GraphNodeFriendLink, type GraphTopologyResponse } from "../api/graph";

export interface GraphCanvasNode {
  id: string;
  kind: "self" | "registered" | "unregistered";
  nodeId?: string;
  siteId?: string;
  title: string;
  galaxyName?: string;
  subtitle?: string;
  url?: string;
  rssUrl?: string;
  description?: string;
  avatar?: string;
  raw?: GraphNodeFriendLink;
}
export interface GraphCanvasEdge { id: string; source: string; target: string }
const emptyProgress = () => ({ expanded: 0, pending: 0, inflight: 0, total: 0, capped: false });

export function buildGraphSnapshot(topology: GraphTopologyResponse, siteId: string) {
  const nodes = new Map<string, GraphCanvasNode>();
  const identity = siteId.trim();
  let selfId = topology.siteNodeIds?.[identity] || "";
  for (const item of topology.nodes) {
    const summary = item.summary;
    if (!summary?.nodeId) throw new Error("关系图节点缺少标识");
    if (!selfId && [summary.primarySite, ...(summary.activeSites || [])].some(site => site?.siteId === identity)) {
      selfId = summary.nodeId;
    }
    nodes.set(summary.nodeId, {
      id: summary.nodeId, nodeId: summary.nodeId, kind: "registered",
      siteId: summary.primarySite?.siteId, title: summary.name, galaxyName: summary.name,
      subtitle: summary.primarySite?.url, url: summary.primarySite?.url, avatar: summary.avatar
    });
  }
  const self = nodes.get(selfId);
  if (!identity || !self) throw new Error("当前站点尚未建立主星节点，请先在接入配置完成首次同步");
  self.kind = "self";
  const edges = new Map<string, GraphCanvasEdge>();
  for (const group of topology.nodeLinks) {
    if (!nodes.has(group.sourceNodeId) || !Array.isArray(group.friendLinks)) {
      throw new Error("关系图连线数据不完整，请刷新重试");
    }
    for (const link of group.friendLinks) {
      const registered = Boolean(link.targetRegistered && link.targetNodeId);
      const url = String(link.url || "").trim();
      if (!registered && !url) throw new Error("关系图友链缺少地址");
      const id = registered ? link.targetNodeId! : `url:${url.toLowerCase().replace(/\/+$/, "")}`;
      if (!nodes.has(id)) {
        nodes.set(id, {
          id, kind: registered ? "registered" : "unregistered",
          nodeId: registered ? link.targetNodeId : undefined, siteId: link.targetSiteId,
          title: link.title || link.targetNodeName || url, galaxyName: link.targetNodeName,
          subtitle: url, url, rssUrl: link.rssUrl, description: link.description,
          avatar: registered ? link.targetAvatar || link.logo : link.logo, raw: link
        });
      }
      const [a, b] = [group.sourceNodeId, id].sort();
      const key = `friend|${a}|${b}`;
      edges.set(key, { id: key, source: group.sourceNodeId, target: id });
    }
  }
  return { nodes, edges, selfId };
}

export function useRelationGraph() {
  const loading = ref(false);
  const error = ref("");
  const nodes = ref(new Map<string, GraphCanvasNode>());
  const edges = ref(new Map<string, GraphCanvasEdge>());
  const focusedId = ref("");
  const focusedNode = computed(() => nodes.value.get(focusedId.value) ?? null);
  const progress = ref(emptyProgress());
  let controller: AbortController | undefined;
  let generation = 0;
  let currentSiteId = "";

  function cancel() {
    generation++;
    controller?.abort();
    controller = undefined;
    loading.value = false;
    progress.value = { ...progress.value, pending: 0, inflight: 0 };
  }
  onScopeDispose(cancel);

  async function reset(siteId: string) {
    cancel();
    const requestGeneration = generation;
    const requestController = new AbortController();
    controller = requestController;
    if (siteId !== currentSiteId) {
      nodes.value = new Map();
      edges.value = new Map();
      focusedId.value = "";
      currentSiteId = siteId;
    }
    error.value = "";
    if (!siteId.trim()) return;
    loading.value = true;
    progress.value = { ...emptyProgress(), inflight: 1, total: nodes.value.size };
    try {
      const topology = await fetchGraphTopology(requestController.signal);
      if (requestGeneration !== generation) return;
      const snapshot = buildGraphSnapshot(topology, siteId);
      nodes.value = snapshot.nodes;
      edges.value = snapshot.edges;
      if (!snapshot.nodes.has(focusedId.value)) focusedId.value = snapshot.selfId;
      progress.value = { ...emptyProgress(), total: snapshot.nodes.size, expanded: topology.nodeLinks.length };
    } catch (cause) {
      if (requestGeneration !== generation || requestController.signal.aborted) return;
      error.value = `${nodes.value.size ? "刷新失败，当前显示上次成功加载的数据：" : ""}${cause instanceof Error ? cause.message : String(cause)}`;
    } finally {
      if (requestGeneration === generation) {
        loading.value = false;
        progress.value = { ...progress.value, inflight: 0 };
        controller = undefined;
      }
    }
  }

  function focusOn(id: string) { if (nodes.value.has(id)) focusedId.value = id; }
  return { loading, error, nodes, edges, focusedId, focusedNode, progress, reset, cancel, focusOn };
}
