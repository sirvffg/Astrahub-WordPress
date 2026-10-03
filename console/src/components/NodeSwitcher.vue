<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../api/client";

interface NodeStatus { url: string; status: string; latencyMs: number; lastError?: string }
interface Snapshot { currentNode: string; nodes: NodeStatus[] }
const emit = defineEmits<{ (event: "selected", url: string): void }>();
const snapshot = ref<Snapshot | null>(null);
const open = ref(false);
const busy = ref(false);
const error = ref("");
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const failedAvatars = ref(new Set<string>());
let disposed = false;
const presentations: Record<string, { name: string; avatar: string }> = {
  "https://astra.zzrbk.xyz": { name: "Beibing", avatar: "https://blog.zzrbk.xyz/upload/w700d1q75cms.jpg" },
  "https://astra.rinty.cn": { name: "Rinty雨屋", avatar: "https://rinty.xyz/upload/897409385.jpg" },
  "https://astra.fryfries13.cn": { name: "Fry酥条", avatar: "https://blog.fryfries13.cn/upload/Logo-%E9%BB%84%E8%89%B2%E5%B0%8F%E9%97%AA%E7%94%B5-PASW.png" },
  "https://astra.lygalaxy.cn": { name: "冷月笙寒的小窝", avatar: "https://q1.qlogo.cn/g?b=qq&nk=2648181326&s=640" },
  "https://astra.aobp.cn": { name: "Serenity's Blog", avatar: "https://www.aobp.cn/upload/logo.webp" }
};
const name = (url: string) => presentations[url]?.name || url.replace(/^https?:\/\//, "");
const avatar = (url: string) => failedAvatars.value.has(url) ? "" : presentations[url]?.avatar || "";
const currentStatus = computed(() => snapshot.value?.nodes.find(node => node.url === current.value)?.status || "unchecked");
function latencyStyle(node: NodeStatus) {
  if (node.status !== "healthy") return { "--node-accent": "#94a3b8", "--node-border": "#e2e8f0", "--node-surface": "#f8fafc" };
  const latency = Math.min(1200, Math.max(80, Number(node.latencyMs) || 80));
  const hue = Math.round(132 - ((latency - 80) / 1120) * 62);
  return { "--node-accent": `hsl(${hue} 68% 34%)`, "--node-border": `hsl(${hue} 52% 79%)`, "--node-surface": `hsl(${hue} 70% 96%)` };
}
const current = computed(() => snapshot.value?.currentNode || "");
function status(node: NodeStatus) {
  if (node.status === "healthy") return node.latencyMs >= 0 ? `可用 · ${node.latencyMs} ms` : "可用";
  return node.status === "checking" ? "检测中" : node.status === "unchecked" ? "尚未检测" : "不可用";
}
async function request(action: "load" | "refresh" | "select", url = "") {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const response = action === "load" ? await api.get<Snapshot>("/node-status")
      : await api.post<Snapshot>(action === "refresh" ? "/node-status/refresh" : "/node-selection", action === "select" ? { url } : {});
    if (disposed) return;
    if (!response.success || !Array.isArray(response.data?.nodes)) throw new Error(response.message || "读取节点状态失败");
    if (action === "select" && response.data.currentNode !== url) throw new Error("服务端未确认切换到该节点，请重新检测");
    snapshot.value = response.data;
    if (response.data.currentNode) emit("selected", response.data.currentNode);
    if (action === "select") close();
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : "节点操作失败";
  } finally { busy.value = false; }
}
function select(node: NodeStatus) {
  if (node.status !== "healthy" || node.url === current.value || busy.value) return;
  void request("select", node.url);
}
function close() { open.value = false; trigger.value?.focus(); }
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false;
}
function escape(event: KeyboardEvent) {
  if (event.key === "Escape" && open.value) close();
}
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape);
  void request("load");
});
onBeforeUnmount(() => {
  disposed = true;
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("keydown", escape);
});
</script>

<template>
  <div ref="root" class="ah-node-dock" :class="{ 'is-open': open }" @keydown.esc.stop="close">
    <div class="ah-node-item">
      <button ref="trigger" type="button" class="ah-node-btn"
        :class="['is-' + currentStatus, { 'is-selected': !!current, 'is-switching': busy }]"
        :aria-expanded="open" aria-controls="wp-node-list"
        :aria-label="current ? '当前节点：' + name(current) + '，选择节点' : '选择连接节点'"
        :title="current ? '当前节点：' + name(current) : '选择连接节点'" @click="open = !open">
        <img v-if="avatar(current)" class="ah-node-current-avatar" :src="avatar(current)" alt="" referrerpolicy="no-referrer" @error="failedAvatars.add(current)" />
        <span v-else class="ah-node-avatar-fallback">{{ current ? name(current).slice(0, 1) : '星' }}</span>
      </button>
      <div v-show="open" id="wp-node-list" class="ah-node-popover" role="dialog" aria-label="AstraHub 节点列表" :aria-busy="busy">
        <div class="ah-node-avatar-menu">
          <button v-for="node in snapshot?.nodes || []" :key="node.url" type="button" class="ah-node-avatar-item"
            :class="['is-' + node.status, { 'is-current': node.url === current }]" :style="latencyStyle(node)"
            :disabled="busy" :aria-disabled="node.status !== 'healthy' || node.url === current"
            :aria-label="name(node.url) + '，' + (node.url === current ? '当前节点，' : '') + status(node)" @click="select(node)">
            <span class="ah-node-avatar-shell">
              <img v-if="avatar(node.url)" :src="avatar(node.url)" alt="" referrerpolicy="no-referrer" @error="failedAvatars.add(node.url)" />
              <span v-else>{{ name(node.url).slice(0, 1) }}</span>
            </span>
            <span class="ah-node-avatar-detail" role="tooltip">
              <strong>{{ name(node.url) }}</strong>
              <small>{{ node.url.replace(/^https?:\/\//, '') }}</small>
              <em>{{ node.url === current ? '当前节点 · ' : '' }}{{ status(node) }}</em>
            </span>
          </button>
        </div>
        <p v-if="!snapshot?.nodes.length" class="ah-node-message">{{ busy ? '正在读取节点…' : '未获取到节点' }}</p>
        <p v-if="error" class="ah-node-error" role="alert">{{ error }}</p>
        <button v-if="error || (!busy && !snapshot?.nodes.length)" class="ah-node-retry" type="button" :disabled="busy" @click="request('refresh')">重新检测</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ah-node-dock {
  position: absolute;
  left: 16px;
  bottom: 26px;
  display: flex;
  align-items: center;
  z-index: 24;
}
.ah-node-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ah-node-btn {
  position: relative;
  width: 42px;
  height: 42px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #bbf7d0;
  border-radius: 50%;
  background: #fff;
  color: #16a34a;
  box-shadow: 0 3px 10px rgba(15,23,42,.08);
  cursor: pointer;
  transition: border-color .16s, background .16s, color .16s, box-shadow .16s, transform .16s;
}
.ah-node-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: #86efac;
  background: #f0fdf4;
  box-shadow: 0 6px 14px rgba(22,163,74,.14);
}
.ah-node-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(139,92,246,.18);
}
.ah-node-btn:disabled { cursor: default; }
.ah-node-btn.is-unhealthy,
.ah-node-btn.is-unchecked {
  border-color: #cbd5e1;
  background: #f8fafc;
  color: #94a3b8;
  box-shadow: 0 3px 10px rgba(15,23,42,.07);
}
.ah-node-btn.is-checking,
.ah-node-btn.is-healthy { color: #16a34a; }
.ah-node-btn.is-selected {
  border-color: #22c55e;
  background: #fff;
  color: #15803d;
  box-shadow: 0 4px 13px rgba(22,163,74,.2);
}
.ah-node-btn.is-switching { animation: ah-node-switching 1s ease-in-out infinite; }
.ah-node-current-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}
.ah-node-avatar-fallback {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f1f5f9;
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}
.ah-node-popover {
  position: absolute;
  left: calc(100% + 12px);
  top: auto;
  bottom: 0;
  width: max-content;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid rgba(148,163,184,.22);
  border-radius: 14px;
  background: rgba(255,255,255,.99);
  color: #334155;
  box-shadow: 0 18px 42px rgba(15,23,42,.14), 0 2px 8px rgba(15,23,42,.05);
  overflow: visible;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translate(5px,0);
  transition: opacity .14s, visibility .14s, transform .14s;
  z-index: 50;
}
.ah-node-popover::before {
  content: "";
  position: absolute;
  left: -6px;
  top: auto;
  bottom: 15px;
  width: 10px;
  height: 10px;
  border-left: 1px solid rgba(148,163,184,.25);
  border-bottom: 1px solid rgba(148,163,184,.25);
  background: #fff;
  transform: rotate(45deg);
  z-index: 1;
}
.ah-node-dock.is-open .ah-node-popover {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translate(0,0);
}
.ah-node-avatar-menu {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 36px;
  justify-content: start;
  align-items: center;
  gap: 8px;
  margin: 0;
  overflow: visible;
  z-index: 2;
}
.ah-node-avatar-item {
  position: relative;
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--node-accent, #64748b);
  cursor: pointer;
  transition: transform .14s, opacity .14s;
}
.ah-node-avatar-item:hover:not(:disabled) {
  transform: translateY(-2px);
}
.ah-node-avatar-item:disabled { cursor: default; }
.ah-node-avatar-item.is-unhealthy,
.ah-node-avatar-item.is-unchecked { opacity: .52; cursor: default; }
.ah-node-avatar-shell {
  width: 34px;
  height: 34px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 2px solid var(--node-border, #e2e8f0);
  border-radius: 50%;
  background: var(--node-surface, #f8fafc);
  color: var(--node-accent, #64748b);
  box-shadow: 0 2px 7px rgba(15,23,42,.1);
  font-size: 10px;
  font-weight: 800;
}
.ah-node-avatar-shell img { width: 100%; height: 100%; display: block; object-fit: cover; }
.ah-node-avatar-item.is-current .ah-node-avatar-shell {
  border-color: #22c55e;
  box-shadow: 0 0 0 2px #dcfce7, 0 3px 9px rgba(22,163,74,.2);
}
.ah-node-avatar-detail {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  width: 184px;
  box-sizing: border-box;
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border: 1px solid var(--node-border, #e2e8f0);
  border-radius: 11px;
  background: rgba(255,255,255,.99);
  color: #334155;
  box-shadow: 0 12px 28px rgba(15,23,42,.14);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translate(-50%,4px);
  transition: opacity .12s, visibility .12s, transform .12s;
  text-align: left;
  z-index: 4;
}
.ah-node-avatar-detail::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 9px;
  height: 9px;
  border-right: 1px solid var(--node-border, #e2e8f0);
  border-bottom: 1px solid var(--node-border, #e2e8f0);
  background: #fff;
  transform: translateX(-50%) rotate(45deg);
}
.ah-node-avatar-detail strong { overflow: hidden; color: #0f172a; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.ah-node-avatar-detail small { overflow: hidden; color: #94a3b8; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.ah-node-avatar-detail em { color: var(--node-accent, #64748b); font-size: 9px; font-style: normal; font-weight: 700; }
.ah-node-avatar-item:hover .ah-node-avatar-detail,
.ah-node-avatar-item:focus-visible .ah-node-avatar-detail {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%,0);
}
.ah-node-avatar-item:nth-child(-n+2) .ah-node-avatar-detail { left: 0; transform: translate(0,4px); }
.ah-node-avatar-item:nth-child(-n+2) .ah-node-avatar-detail::after { left: 18px; transform: rotate(45deg); }
.ah-node-avatar-item:nth-child(-n+2):hover .ah-node-avatar-detail,
.ah-node-avatar-item:nth-child(-n+2):focus-visible .ah-node-avatar-detail { transform: translate(0,0); }
.ah-node-avatar-item:nth-last-child(-n+2) .ah-node-avatar-detail { left: auto; right: 0; transform: translate(0,4px); }
.ah-node-avatar-item:nth-last-child(-n+2) .ah-node-avatar-detail::after { left: auto; right: 13px; transform: rotate(45deg); }
.ah-node-avatar-item:nth-last-child(-n+2):hover .ah-node-avatar-detail,
.ah-node-avatar-item:nth-last-child(-n+2):focus-visible .ah-node-avatar-detail { transform: translate(0,0); }
@keyframes ah-node-dot { 0%,100%{opacity:.35} 50%{opacity:1} }
@keyframes ah-node-switching { 0%,100%{opacity:.55} 50%{opacity:1} }


.ah-node-error,.ah-node-message{max-width:220px;font-size:12px;white-space:normal;margin:6px 0;overflow-wrap:anywhere}
.ah-node-error{color:#b91c1c}.ah-node-retry{font:inherit;font-size:12px;cursor:pointer}
.ah-node-avatar-item:focus-visible{outline:2px solid #8b5cf6;outline-offset:2px}
@media(max-width:640px){
  .ah-node-dock {
    left: 5px;
    bottom: 8px;
  }
  .ah-node-btn {
    width: 30px;
    height: 30px;
  }
  .ah-node-current-avatar,
  .ah-node-avatar-fallback {
    width: 24px;
    height: 24px;
  }
  .ah-node-popover {
    left: calc(100% + 6px);
    padding: 6px;
    border-radius: 9px;
  }
  .ah-node-popover::before {
    left: -4px;
    bottom: 10px;
    width: 7px;
    height: 7px;
  }
  .ah-node-avatar-menu {
    grid-auto-columns: 26px;
    gap: 4px;
  }
  .ah-node-avatar-item {
    width: 26px;
    height: 26px;
  }
  .ah-node-avatar-shell {
    width: 24px;
    height: 24px;
    border-width: 1px;
    font-size: 7px;
  }
  .ah-node-avatar-item.is-current .ah-node-avatar-shell {
    box-shadow: 0 0 0 1px #dcfce7, 0 2px 5px rgba(22,163,74,.18);
  }
  .ah-node-avatar-detail {
    bottom: calc(100% + 7px);
    width: 140px;
    padding: 6px 7px;
    gap: 2px;
    border-radius: 8px;
  }
  .ah-node-avatar-detail::after {
    bottom: -4px;
    width: 7px;
    height: 7px;
  }
  .ah-node-avatar-detail strong { font-size: 8px; }
  .ah-node-avatar-detail small,
  .ah-node-avatar-detail em { font-size: 7px; }
  .ah-node-avatar-item:nth-child(-n+2) .ah-node-avatar-detail::after {
    left: 13px;
  }
  .ah-node-avatar-item:nth-last-child(-n+2) .ah-node-avatar-detail::after {
    right: 9px;
  }
}
</style>
