<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { graphAvatarProxyUrl } from "../api/client";
interface WorldChatSettings { credentials: { siteId: string; apiKey: string }; connection: { hubBaseUrl: string } }
import type { HubRealtimeEvent } from "../composables/useFriendInvitationRealtime";
import { useAstraHubSessionState } from "../composables/useAstraHubSessionState";
import {
  createFriendInvitation
} from "../api/friend";
import {
  fetchWorldChatConsent,
  fetchWorldChatBootstrap,
  deleteWorldChatSticker,
  fetchWorldChatMember,
  fetchWorldChatMemberRecentPosts,
  fetchWorldChatMembers,
  fetchWorldChatMentionCandidates,
  fetchWorldChatMessages,
  fetchWorldChatStickers,
  fetchWorldChatUnread,
  hasWorldChatAccess,
  markWorldChatRead,
  reportWorldChatMessage,
  saveWorldChatConsent,
  retractWorldChatMessage,
  sendWorldChatMessage,
  uploadWorldChatSticker,
  worldChatStickerFileUrl,
  type WorldChatEncryptedPayload,
  type WorldChatConsentState,
  type WorldChatMentionCandidate,
  type WorldChatMentionTarget,
  type WorldChatMemberDetail,
  type WorldChatMemberSummary,
  type WorldChatMessage,
  type WorldChatReplySummary,
  type WorldChatRecentPost,
  type WorldChatSticker
} from "../composables/useWorldChat";

const props = defineProps<{
  settings: WorldChatSettings;
  realtimeEvent: HubRealtimeEvent<unknown> | null;
}>();

let disposed = false;
const bufferedRealtime: HubRealtimeEvent<unknown>[] = [];

const chatSession = useAstraHubSessionState("world-chat", props.settings.credentials.siteId, () => ({
  messages: ref<WorldChatMessage[]>([]),
  currentMember: ref<WorldChatMemberDetail | null>(null),
  deliveryStates: ref<Record<string, OptimisticDelivery>>({}),
  members: ref<WorldChatMemberSummary[]>([]),
  selectedMember: ref<WorldChatMemberDetail | null>(null),
  recentPosts: ref<WorldChatRecentPost[]>([]),
  stickers: ref<WorldChatSticker[]>([]),
  consentState: ref<WorldChatConsentState | null>(null),
  visibleRecentPostCount: ref(4),
  inputText: ref(""),
  searchQuery: ref(""),
  memberDrawerCollapsed: ref(false),
  hasMoreBefore: ref(false),
  memberTotal: ref(0),
  maxMessageBytes: ref(4096),
  pendingNewMessages: ref(0),
  pendingMentionCount: ref(0),
  latestMentionMessageId: ref(""),
  historyAnchorMessageId: ref(""),
  historyUnreadCount: ref(0),
  historyPromptVisible: ref(false),
  historyAnchorLocated: ref(false),
  replyDraftMessage: ref<WorldChatMessage | null>(null),
  mutedUntil: ref(""),
  mutedReason: ref(""),
  initialized: ref(false),
  scrollOffsetFromBottom: ref(0)
}));
const {
  messages, currentMember, deliveryStates, members, selectedMember, recentPosts, stickers, consentState,
  visibleRecentPostCount, inputText, searchQuery, memberDrawerCollapsed,
  hasMoreBefore, memberTotal, maxMessageBytes, pendingNewMessages,
  pendingMentionCount, latestMentionMessageId, historyAnchorMessageId,
  historyUnreadCount, historyPromptVisible, historyAnchorLocated,
  replyDraftMessage, mutedUntil, mutedReason, initialized, scrollOffsetFromBottom
} = chatSession;
const consentLoading = ref(false);
const consentSubmitting = ref(false);
const consentScrolledToEnd = ref(false);
const searchExpanded = ref(false);
const emojiPickerOpen = ref(false);
const mentionPickerOpen = ref(false);
const activeEmojiGroup = ref("常用");
const customStickerTab = "__custom_stickers";
const stickerEditing = ref(false);
const loading = ref(false);
const loadingMembers = ref(false);
const loadingMore = ref(false);
const loadingMentions = ref(false);
const uploadingSticker = ref(false);
const inviting = ref(false);
const reportingMessageId = ref("");
const retractingMessageId = ref("");
const loadingHistoryAnchor = ref(false);
const loadingMemberDetail = ref(false);
const highlightedMessageId = ref("");
const secondaryMediaReady = ref(false);
let deferredMediaTimer: number | undefined;
const currentTime = ref(Date.now());
const mentionCandidates = ref<WorldChatMentionCandidate[]>([]);
const mentionCandidateTotal = ref(0);
const mentionCandidateQuery = ref("");
const draftMentions = ref<WorldChatMentionTarget[]>([]);
const mentionContextMenu = ref<{ x: number; y: number; target: WorldChatMentionTarget } | null>(null);
const quoteContextMenu = ref<{ x: number; y: number; message: WorldChatMessage } | null>(null);
const toast = ref<{ message: string; type: "success" | "error" | "info" } | null>(null);
const shellRef = ref<HTMLElement | null>(null);
const chatScrollRef = ref<HTMLElement | null>(null);
const messageInputRef = ref<HTMLTextAreaElement | null>(null);
const composerRef = ref<HTMLElement | null>(null);
const emojiButtonRef = ref<HTMLButtonElement | null>(null);
const stickerInputRef = ref<HTMLInputElement | null>(null);
const emojiPanelStyle = ref<Record<string, string>>({
  "--emoji-arrow-center": "14px"
});

type DisplayableWorldChatMessage = WorldChatMessage | WorldChatReplySummary;
type DeliveryState = "sending" | "failed";
type OptimisticDelivery = {
  state: DeliveryState;
  encrypted: WorldChatEncryptedPayload;
  mentions: WorldChatMentionTarget[];
  replyToMessageId: string;
};

const canAccess = computed(() => hasWorldChatAccess(props.settings.credentials.siteId, Boolean(props.settings.credentials.apiKey)));
const consentAccepted = computed(() => Boolean(consentState.value?.accepted));
const consentPolicyTitle = computed(() => consentState.value?.title || "星际通讯功能使用协议及个人信息保护告知书");
const consentPolicyMarkdown = computed(() => consentState.value?.contentMarkdown || "");
const consentPolicyHtml = computed(() => renderConsentMarkdown(consentPolicyMarkdown.value));
const currentSiteId = computed(() => String(props.settings.credentials.siteId || "").trim());
const checkinLevels = [
  { days: 730, title: "永恒远航者" },
  { days: 360, title: "银河守望者" },
  { days: 180, title: "星域领航员" },
  { days: 90, title: "深空航行者" },
  { days: 30, title: "星海巡航者" },
  { days: 7, title: "星链观测者" }
] as const;
type CheckinLevel = (typeof checkinLevels)[number];
const checkinLevelCache = new Map<number, CheckinLevel | null>();
const checkinFrames = import.meta.glob<string>("../assets/world-chat-checkin/*.webp", {
  eager: true, query: "?url", import: "default"
});
const isSelectedAssistant = computed(() => isAssistantMember(selectedMember.value));
const muteEndTime = computed(() => {
  const value = mutedUntil.value.trim();
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    return null;
  }
  return date;
});
const isMuted = computed(() => muteEndTime.value !== null);
const muteText = computed(() => {
  const date = muteEndTime.value;
  if (!date) {
    return "";
  }
  const reason = mutedReason.value.trim();
  return `已被禁言至 ${formatDateTime(date)}${reason ? `，原因：${reason}` : ""}`;
});

const filteredMembers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) {
    return members.value;
  }
  return members.value.filter((member) => {
    return `${member.name} ${member.url}`.toLowerCase().includes(query);
  });
});

const memberBySiteId = computed(() => {
  const index = new Map<string, WorldChatMemberSummary>();
  for (const member of members.value) {
    if (member.siteId) {
      index.set(member.siteId, member);
    }
  }
  return index;
});

const visibleRecentPosts = computed(() => recentPosts.value.slice(0, visibleRecentPostCount.value));
const emojiGroups = [
  { name: "常用", items: ["😀", "😃", "😄", "😁", "😆", "🤣", "😂", "🙂", "😉", "😊", "😍", "😘", "😎", "🤔", "😭", "🥰", "👍", "👏", "🙏", "💪", "❤️", "💙", "✨", "⭐", "🌟", "🚀", "🌙", "🌈", "🍀", "🎉", "🎁", "🔥", "☕", "🍵", "🍰", "🍔", "📚", "💌", "🎧", "💻", "📱", "📝", "🌌", "🌍", "🌠", "☁️", "🎯", "💎"] },
  { name: "开心", items: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "😌", "😎", "🥳", "😺", "😸", "😹", "😻", "🙌", "👏", "🎉", "🎊", "✨", "🌟", "💫", "🌈", "🍀", "🎁", "🍰", "🍭", "🎂", "🎈"] },
  { name: "情绪", items: ["🤔", "😐", "😑", "😶", "🙄", "😏", "😣", "😥", "😮", "🤐", "😯", "😪", "😫", "🥱", "😴", "😌", "😕", "😟", "🙁", "☹️", "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😢", "😭", "😱", "😖", "😞", "😓", "😩", "😤", "😡", "🤯", "😬", "😵", "😷", "🤒", "🤕", "🤧", "💀", "👻", "😈", "👿", "🙈"] },
  { name: "手势", items: ["👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👋", "🤝", "🙏", "💪", "👏", "🙌", "👐", "🤲", "✍️", "👊", "✊", "🤛", "🤜", "👀", "👂", "👃", "👄", "💬", "💭", "💌", "📣", "📢", "🔔", "✅", "❌", "❗", "❓", "💯", "🔝", "⭕", "❎"] },
  { name: "星链", items: ["🚀", "🌌", "🌍", "🌎", "🌏", "🌙", "☀️", "⭐", "🌟", "✨", "💫", "☄️", "🌠", "🔥", "⚡", "🔭", "📡", "🧭", "🗺️", "👨", "👩", "🤖", "🛠️", "⚙️", "🔗", "🕸️", "📍", "📌", "🎯", "🔮", "💎", "🌀", "🌊", "⛅", "☁️", "🌧️", "🌤️", "🌋", "🏔️", "🏕️", "🏝️", "🏜️", "🌁", "🌃", "🌉", "🌅", "🌄", "🌆"] },
  { name: "生活", items: ["☕", "🍵", "🍺", "🍻", "🍷", "🍰", "🍪", "🍩", "🍫", "🍬", "🍭", "🍎", "🍓", "🍉", "🍊", "🍋", "🍌", "🍇", "🍒", "🍑", "🍍", "🍔", "🍟", "🍕", "🍜", "🍣", "🍱", "🍙", "🍞", "🍗", "🍖", "🍤", "🍳", "📚", "📖", "📝", "💻", "⌨️", "🖱️", "📱", "📷", "🎧", "🎮", "🎲", "🎬", "🎨", "🎵", "🌸", "🌻", "🌲", "🐾"] },
  { name: "动物", items: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐔", "🐧", "🐦", "🐤", "🐣", "🦆", "🦅", "🦉", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜", "🕷️", "🐢", "🐍", "🦎", "🐙", "🦑", "🦀", "🐠", "🐟", "🐳", "🐬", "🦈"] },
  { name: "符号", items: ["❤️", "💙", "💚", "💛", "💜", "🖤", "💔", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "✨", "⭐", "🌟", "💫", "🔥", "⚡", "☀️", "🌙", "☁️", "☂️", "☔", "❄️", "☃️", "⭕", "❌", "❎", "✅", "✔️", "➕", "➖", "➗", "💯", "🔔", "🔕", "🔒", "🔓", "🔑", "📌", "📍", "🚩", "🏳️", "🎵", "🎶"] }
];
const activeEmojiItems = computed(() => emojiGroups.find((group) => group.name === activeEmojiGroup.value)?.items || emojiGroups[0].items);
let currentTimeTimer: number | undefined;
let memberDetailRequestSequence = 0;

function showToast(message: string, type: "success" | "error" | "info" = "info") {
  toast.value = { message, type };
  window.setTimeout(() => {
    toast.value = null;
  }, 2400);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(value: string) {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderConsentMarkdown(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let listOpen = false;
  let skippedDocumentTitle = false;

  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line === "---") {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length, 4);
      if (level === 1 && !skippedDocumentTitle) {
        skippedDocumentTitle = true;
        continue;
      }
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  closeList();
  return html.join("");
}

function upsertMessages(nextMessages: WorldChatMessage[]) {
  const merged = messages.value.filter((message) => message.messageId && message.status !== "deleted");
  for (const message of nextMessages) {
    if (!message.messageId || message.status === "deleted") {
      continue;
    }
    const index = merged.findIndex((item) => item.messageId === message.messageId
      || (message.clientMessageId && item.clientMessageId === message.clientMessageId));
    if (index >= 0) {
      merged[index] = message;
    } else {
      merged.push(message);
    }
    if (message.clientMessageId && !message.messageId.startsWith("local:")) {
      delete deliveryStates.value[message.clientMessageId];
    }
  }
  messages.value = merged.sort((a, b) => {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function applyMessageUpdate(message: WorldChatMessage) {
  if (message.status === "deleted") {
    messages.value = messages.value.map((item) => (item.messageId === message.messageId ? message : item));
    return;
  }
  upsertMessages([message]);
}

function clearWorldChatData() {
  messages.value = [];
  currentMember.value = null;
  deliveryStates.value = {};
  members.value = [];
  selectedMember.value = null;
  recentPosts.value = [];
  stickers.value = [];
  mentionCandidates.value = [];
  memberTotal.value = 0;
  pendingNewMessages.value = 0;
  pendingMentionCount.value = 0;
  latestMentionMessageId.value = "";
  historyAnchorMessageId.value = "";
  historyUnreadCount.value = 0;
  historyPromptVisible.value = false;
  historyAnchorLocated.value = false;
  loadingHistoryAnchor.value = false;
  hasMoreBefore.value = false;
  mutedUntil.value = "";
  mutedReason.value = "";
  replyDraftMessage.value = null;
  draftMentions.value = [];
}

async function loadConsentGate() {
  if (!canAccess.value) {
    consentState.value = null;
    clearWorldChatData();
    return;
  }
  consentLoading.value = true;
  consentScrolledToEnd.value = false;
  try {
    const state = await fetchWorldChatConsent();
    consentState.value = state;
    initialized.value = true;
    if (state.accepted) {
      await loadBootstrap();
      return;
    }
    clearWorldChatData();
  } catch (error) {
    clearWorldChatData();
    showToast(error instanceof Error ? error.message : "通讯协议加载失败", "error");
  } finally {
    consentLoading.value = false;
  }
}

async function submitConsent(accepted: boolean) {
  const version = String(consentState.value?.version || "").trim();
  if (!version || consentSubmitting.value) {
    return;
  }
  consentSubmitting.value = true;
  try {
    const response = await saveWorldChatConsent(version, accepted);
    consentState.value = response.state;
    if (response.state.accepted) {
      showToast("已开启星际通讯", "success");
      await loadBootstrap();
      return;
    }
    clearWorldChatData();
    showToast("已暂停星际通讯连接", "info");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "通讯协议确认失败", "error");
  } finally {
    consentSubmitting.value = false;
  }
}

function handleConsentScroll(event: Event) {
  const el = event.currentTarget as HTMLElement | null;
  if (!el) {
    return;
  }
  consentScrolledToEnd.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
}

async function loadBootstrap() {
  if (disposed || loading.value) return;
  if (!canAccess.value || !consentAccepted.value) {
    messages.value = [];
    members.value = [];
    return;
  }
  loading.value = true;
  try {
    const bootstrap = await fetchWorldChatBootstrap();
    if (disposed) return;
    const unreadSnapshot = bootstrap.unread || null;
    const unreadCount = Number(unreadSnapshot?.unreadCount || 0);
    const lastReadMessageId = String(unreadSnapshot?.lastReadMessageId || "").trim();
    historyAnchorMessageId.value = unreadCount > 0 ? lastReadMessageId : "";
    historyUnreadCount.value = historyAnchorMessageId.value ? unreadCount : 0;
    historyPromptVisible.value = Boolean(historyAnchorMessageId.value);
    historyAnchorLocated.value = false;
    pendingMentionCount.value = Number(unreadSnapshot?.mentionCount || 0);
    latestMentionMessageId.value = String(unreadSnapshot?.latestMentionMessageId || "");
    const remoteMessages = Array.isArray(bootstrap.latest) ? bootstrap.latest.filter((message) => message.status !== "deleted") : [];
    const remoteClientIds = new Set(remoteMessages.map((message) => message.clientMessageId).filter(Boolean));
    const localMessages = messages.value.filter((message) => message.messageId.startsWith("local:")
      && deliveryState(message)
      && !remoteClientIds.has(message.clientMessageId));
    messages.value = remoteMessages;
    for (const clientMessageId of remoteClientIds) {
      delete deliveryStates.value[clientMessageId];
    }
    upsertMessages(localMessages);
    currentMember.value = bootstrap.member || null;
    maxMessageBytes.value = Number(bootstrap.limits?.maxMessageBytes || 4096);
    hasMoreBefore.value = messages.value.length >= Number(bootstrap.limits?.messagePageSize || 30);
    mutedUntil.value = String(bootstrap.muted?.mutedUntil || "");
    mutedReason.value = String(bootstrap.muted?.reason || "");
    stickers.value = Array.isArray(bootstrap.stickers?.items) ? bootstrap.stickers.items : [];
    memberTotal.value = Number(bootstrap.members?.total || 0);
    members.value = [];
    upsertMembers(Array.isArray(bootstrap.members?.items) ? bootstrap.members.items : []);
    loading.value = false;
    await nextTick();
    scrollToBottom();
    scheduleDeferredMedia();
    void markWorldChatRead().catch(() => undefined);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "星际通讯加载失败", "error");
  } finally {
    loading.value = false;
    if (!disposed) {
      for (const event of bufferedRealtime.splice(0)) void handleChatRealtime(event);
    }
  }
}

function scheduleDeferredMedia() {
  if (secondaryMediaReady.value || deferredMediaTimer !== undefined) {
    return;
  }
  deferredMediaTimer = window.setTimeout(() => {
    deferredMediaTimer = undefined;
    secondaryMediaReady.value = true;
  }, 0);
}

async function loadStickers() {
  if (!canAccess.value || !consentAccepted.value) {
    stickers.value = [];
    return;
  }
  try {
    const response = await fetchWorldChatStickers();
    stickers.value = Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    showToast(error instanceof Error ? error.message : "未读状态加载失败", "error");
  }
}

async function loadMembers(reset = false) {
  if (!canAccess.value || !consentAccepted.value || loadingMembers.value) {
    return;
  }
  loadingMembers.value = true;
  try {
    const offset = reset ? 0 : members.value.length;
    const response = await fetchWorldChatMembers(offset, 30);
    memberTotal.value = Number(response.total || 0);
    if (reset) {
      members.value = [];
    }
    upsertMembers(Array.isArray(response.items) ? response.items : []);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "成员列表加载失败", "error");
  } finally {
    loadingMembers.value = false;
  }
}

function upsertMembers(nextMembers: WorldChatMemberSummary[]) {
  const ordered = [...members.value];
  const indexBySiteId = new Map<string, number>();
  ordered.forEach((member, index) => {
    if (member.siteId) indexBySiteId.set(member.siteId, index);
  });
  for (const member of nextMembers) {
    if (!member.siteId) continue;
    const index = indexBySiteId.get(member.siteId);
    if (index === undefined) {
      indexBySiteId.set(member.siteId, ordered.length);
      ordered.push(member);
    } else {
      ordered[index] = { ...ordered[index], ...member };
    }
  }
  members.value = ordered;
}

async function loadEarlierMessages() {
  if (!consentAccepted.value || !messages.value.length || loadingMore.value) {
    return;
  }
  loadingMore.value = true;
  const el = chatScrollRef.value;
  const previousScrollHeight = el?.scrollHeight || 0;
  const previousScrollTop = el?.scrollTop || 0;
  try {
    const firstMessage = messages.value[0];
    const response = await fetchWorldChatMessages({
      beforeMessageId: firstMessage.messageId,
      limit: 30
    });
    hasMoreBefore.value = Boolean(response.hasMoreBefore);
    upsertMessages(Array.isArray(response.items) ? response.items : []);
    await nextTick();
    if (el) {
      el.scrollTop = el.scrollHeight - previousScrollHeight + previousScrollTop;
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : "历史消息加载失败", "error");
  } finally {
    loadingMore.value = false;
  }
}

function optimisticSender(): WorldChatMemberSummary {
  return currentMember.value || memberBySiteId.value.get(currentSiteId.value) || {
    siteId: currentSiteId.value,
    name: "本站",
    url: ""
  };
}

function deliveryState(message: WorldChatMessage): DeliveryState | "" {
  return deliveryStates.value[message.clientMessageId]?.state || "";
}

function createOptimisticMessage(
  encrypted: WorldChatEncryptedPayload,
  clientMessageId: string,
  mentions: WorldChatMentionTarget[],
  replyMessage: WorldChatMessage | null
): WorldChatMessage {
  const now = new Date().toISOString();
  return {
    messageId: `local:${clientMessageId}`,
    clientMessageId,
    sender: optimisticSender(),
    encrypted,
    replyToMessageId: replyMessage?.messageId || "",
    replyTo: replyMessage ? {
      messageId: replyMessage.messageId,
      sender: replyMessage.sender,
      encrypted: replyMessage.encrypted,
      status: replyMessage.status,
      createdAt: replyMessage.createdAt,
      deletedAt: replyMessage.deletedAt
    } : undefined,
    mentions,
    status: "normal",
    createdAt: now,
    updatedAt: now
  };
}

async function deliverOptimisticMessage(message: WorldChatMessage) {
  const delivery = deliveryStates.value[message.clientMessageId];
  if (!delivery || delivery.state === "sending") {
    return;
  }
  delivery.state = "sending";
  try {
    const response = await sendWorldChatMessage(
      delivery.encrypted,
      message.clientMessageId,
      delivery.mentions,
      delivery.replyToMessageId
    );
    upsertMessages([response.message]);
  } catch (error) {
    const current = deliveryStates.value[message.clientMessageId];
    if (current) {
      current.state = "failed";
    }
    const failure = error instanceof Error ? error.message : "消息发送失败";
    showToast(failure.includes("rate limit") || failure.includes("429") ? "发送太快了，请稍后再试。" : failure, "error");
  }
}

async function retryMessage(message: WorldChatMessage) {
  if (deliveryState(message) !== "failed") {
    return;
  }
  await deliverOptimisticMessage(message);
}

async function sendMessage() {
  if (!consentAccepted.value) {
    showToast("请先同意星际通讯使用协议", "error");
    return;
  }
  const text = inputText.value.trim();
  if (isMuted.value) {
    showToast(muteText.value, "error");
    return;
  }
  if (!text) {
    return;
  }
  const encrypted = buildPlainTransportFrame(text);
  if (encrypted.ciphertext.length > maxMessageBytes.value) {
    showToast(`消息内容不能超过 ${maxMessageBytes.value} 字节`, "error");
    return;
  }
  const clientMessageId = `wc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const mentions = activeMentionTargets(text);
  const replyMessage = replyDraftMessage.value;
  const optimistic = createOptimisticMessage(encrypted, clientMessageId, mentions, replyMessage);
  deliveryStates.value[clientMessageId] = {
    state: "failed",
    encrypted,
    mentions,
    replyToMessageId: replyMessage?.messageId || ""
  };
  upsertMessages([optimistic]);
  inputText.value = "";
  draftMentions.value = [];
  replyDraftMessage.value = null;
  mentionPickerOpen.value = false;
  await nextTick();
  scrollToBottom();
  await focusMessageInput();
  void deliverOptimisticMessage(optimistic);
}

async function sendSticker(sticker: WorldChatSticker) {
  if (!consentAccepted.value) {
    showToast("请先同意星际通讯使用协议", "error");
    return;
  }
  if (isMuted.value) {
    showToast(muteText.value, "error");
    return;
  }
  if (!sticker.stickerId) {
    return;
  }
  const encrypted = buildPlainTransportFrame(stickerPayloadText(sticker.stickerId));
  const clientMessageId = `wc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const optimistic = createOptimisticMessage(encrypted, clientMessageId, [], null);
  deliveryStates.value[clientMessageId] = {
    state: "failed",
    encrypted,
    mentions: [],
    replyToMessageId: ""
  };
  upsertMessages([optimistic]);
  emojiPickerOpen.value = false;
  await nextTick();
  scrollToBottom();
  await focusMessageInput();
  void deliverOptimisticMessage(optimistic);
}

function openStickerUpload() {
  if (stickers.value.length >= 10) {
    showToast("每个站点最多上传 10 张表情", "error");
    return;
  }
  stickerInputRef.value?.click();
}

async function handleStickerUpload(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file || uploadingSticker.value) {
    return;
  }
  if (!consentAccepted.value) {
    showToast("请先同意星际通讯使用协议", "error");
    return;
  }
  input.value = "";
  if (file.size > 300 * 1024) {
    showToast("表情包原图不能超过 300KB", "error");
    return;
  }
  if (!["image/png", "image/jpeg", "image/gif"].includes(file.type)) {
    showToast("仅支持 PNG、JPG、GIF 格式", "error");
    return;
  }
  uploadingSticker.value = true;
  try {
    const response = await uploadWorldChatSticker(file.name, file.type, await fileToBase64(file));
    stickers.value = [response.sticker, ...stickers.value.filter((item) => item.stickerId !== response.sticker.stickerId)];
    showToast("表情包已上传", "success");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "表情包上传失败", "error");
  } finally {
    uploadingSticker.value = false;
  }
}

async function removeSticker(sticker: WorldChatSticker) {
  if (!consentAccepted.value || !sticker.stickerId || uploadingSticker.value) {
    return;
  }
  uploadingSticker.value = true;
  try {
    await deleteWorldChatSticker(sticker.stickerId);
    stickers.value = stickers.value.filter((item) => item.stickerId !== sticker.stickerId);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "表情包删除失败", "error");
  } finally {
    uploadingSticker.value = false;
  }
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.onerror = () => reject(new Error("表情包读取失败"));
    reader.readAsDataURL(file);
  });
}

async function focusMessageInput() {
  await nextTick();
  window.requestAnimationFrame(() => {
    messageInputRef.value?.focus();
  });
}

async function openMember(siteId: string) {
  if (!consentAccepted.value || !siteId) {
    return;
  }
  if (siteId === "system_xiaoxing") {
    memberDetailRequestSequence += 1;
    loadingMemberDetail.value = false;
    selectedMember.value = assistantMemberDetail(assistantMemberSummary());
    visibleRecentPostCount.value = 4;
    recentPosts.value = [];
    return;
  }
  const requestSequence = ++memberDetailRequestSequence;
  const summary = memberBySiteId.value.get(siteId);
  selectedMember.value = summary
    ? { ...summary }
    : { siteId, name: "正在加载成员资料", url: "" };
  visibleRecentPostCount.value = 4;
  recentPosts.value = [];
  loadingMemberDetail.value = true;
  try {
    const [member, posts] = await Promise.all([
      fetchWorldChatMember(siteId),
      fetchWorldChatMemberRecentPosts(siteId, 20)
    ]);
    if (requestSequence !== memberDetailRequestSequence || selectedMember.value?.siteId !== siteId) {
      return;
    }
    selectedMember.value = member;
    recentPosts.value = Array.isArray(posts.items) ? posts.items : [];
  } catch (error) {
    if (requestSequence === memberDetailRequestSequence) {
      showToast(error instanceof Error ? error.message : "成员资料加载失败", "error");
    }
  } finally {
    if (requestSequence === memberDetailRequestSequence) {
      loadingMemberDetail.value = false;
    }
  }
}

function closeMember() {
  memberDetailRequestSequence += 1;
  loadingMemberDetail.value = false;
  selectedMember.value = null;
  recentPosts.value = [];
}

function assistantMemberSummary(): WorldChatMemberSummary | null {
  const listedMember = memberBySiteId.value.get("system_xiaoxing");
  if (listedMember) {
    return listedMember;
  }
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const sender = messages.value[index]?.sender;
    if (isAssistantMember(sender)) {
      return sender;
    }
  }
  return null;
}

function assistantMemberDetail(source: WorldChatMemberSummary | null): WorldChatMemberDetail {
  const now = new Date().toISOString();
  return {
    siteId: "system_xiaoxing",
    name: "AstrahBot",
    url: "",
    category: "系统助手",
    description: "AstrahBot 是驻留在 AstraHub 公共频道的系统向导。它不代表任何用户站点，也不会主动建立关系；只在公共频道回应 @AstrahBot 提问，帮助理解星球生态、接入流程、RSS 同步、内容发现、关系网络与频道使用方式。涉及实时状态时，会通过 Hub 当前数据给出合理回答。",
    avatarUrl: String(source?.avatarUrl || "").trim(),
    joinedAt: source?.joinedAt || now,
    updatedAt: source?.updatedAt || now,
    influenceScore: 0,
    trustScore: 0,
    friendLinkCount: 0,
    relationStatus: "assistant"
  };
}

async function inviteSelectedMember() {
  if (!consentAccepted.value) {
    return;
  }
  const targetSiteId = selectedMember.value?.siteId || "";
  if (!targetSiteId || targetSiteId === currentSiteId.value || inviting.value) {
    return;
  }
  inviting.value = true;
  try {
    await createFriendInvitation(targetSiteId, "来自星际通讯的友链邀请", "");
    showToast("友链邀请已发送", "success");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "友链邀请发送失败", "error");
  } finally {
    inviting.value = false;
  }
}

async function reportMessage(message: WorldChatMessage) {
  if (!canReportMessage(message)) {
    return;
  }
  reportingMessageId.value = message.messageId;
  try {
    await reportWorldChatMessage(message.messageId, "inappropriate");
    showToast("举报已提交", "success");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "举报失败", "error");
  } finally {
    reportingMessageId.value = "";
  }
}

async function retractMessage(message: WorldChatMessage) {
  if (!consentAccepted.value || !message.messageId || !isOwnMessage(message) || retractingMessageId.value) {
    return;
  }
  retractingMessageId.value = message.messageId;
  try {
    const response = await retractWorldChatMessage(message.messageId);
    applyMessageUpdate(response.message);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "消息撤回失败", "error");
  } finally {
    retractingMessageId.value = "";
  }
}

function scrollToBottom() {
  const el = chatScrollRef.value;
  if (!el) {
    return;
  }
  el.scrollTop = el.scrollHeight;
  pendingNewMessages.value = 0;
}

async function refreshMentionPrompt() {
  if (!canAccess.value || !consentAccepted.value) {
    pendingMentionCount.value = 0;
    latestMentionMessageId.value = "";
    return;
  }
  try {
    const response = await fetchWorldChatUnread();
    pendingMentionCount.value = Number(response.mentionCount || 0);
    latestMentionMessageId.value = String(response.latestMentionMessageId || "");
  } catch {
    pendingMentionCount.value = 0;
    latestMentionMessageId.value = "";
  }
}

async function jumpToLatestMention() {
  if (!consentAccepted.value) {
    return;
  }
  const messageId = latestMentionMessageId.value.trim();
  if (!messageId) {
    return;
  }
  await ensureMessageLoaded(messageId);
  await nextTick();
  focusMessage(messageId);
  await markWorldChatRead();
  pendingMentionCount.value = 0;
  latestMentionMessageId.value = "";
}

async function jumpToHistoryAnchor() {
  if (!consentAccepted.value || !historyAnchorMessageId.value || loadingHistoryAnchor.value) {
    return;
  }
  const messageId = historyAnchorMessageId.value;
  loadingHistoryAnchor.value = true;
  try {
    const loaded = await ensureMessageLoaded(messageId);
    if (!loaded) {
      showToast("上次阅读位置已不在当前历史记录中", "info");
      historyPromptVisible.value = false;
      return;
    }
    await nextTick();
    historyAnchorLocated.value = true;
    historyPromptVisible.value = false;
    focusMessage(messageId);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "历史位置加载失败", "error");
    historyPromptVisible.value = false;
  } finally {
    loadingHistoryAnchor.value = false;
  }
}

async function ensureMessageLoaded(messageId: string) {
  if (!consentAccepted.value) {
    return false;
  }
  for (let attempts = 0; attempts < 20; attempts += 1) {
    if (messages.value.some((message) => message.messageId === messageId)) {
      return true;
    }
    if (!hasMoreBefore.value || messages.value.length === 0) {
      await refreshLatestMessages();
      return messages.value.some((message) => message.messageId === messageId);
    }
    await loadEarlierMessages();
    await nextTick();
  }
  return messages.value.some((message) => message.messageId === messageId);
}

function focusMessage(messageId: string) {
  const container = chatScrollRef.value;
  const target = container?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`) as HTMLElement | null;
  if (!container || !target) {
    return;
  }
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  highlightedMessageId.value = messageId;
  window.setTimeout(() => {
    if (highlightedMessageId.value === messageId) {
      highlightedMessageId.value = "";
    }
  }, 2400);
}

function handleNoticeClick() {
  if (pendingMentionCount.value > 0 && latestMentionMessageId.value) {
    void jumpToLatestMention();
    return;
  }
  scrollToBottom();
}

function toggleMemberDrawer() {
  memberDrawerCollapsed.value = !memberDrawerCollapsed.value;
  if (memberDrawerCollapsed.value) {
    searchExpanded.value = false;
    searchQuery.value = "";
  }
}

async function insertEmoji(emoji: string) {
  inputText.value += emoji;
  emojiPickerOpen.value = false;
  await nextTick();
  messageInputRef.value?.focus();
}

function activeMentionTargets(text: string) {
  const normalizedText = ` ${text.trim()} `;
  const seen = new Set<string>();
  const items: WorldChatMentionTarget[] = [];
  for (const mention of draftMentions.value) {
    const name = String(mention.name || "").trim();
    if (!mention.kind || !mention.id || !name || !normalizedText.includes(`@${name} `)) {
      continue;
    }
    const key = `${mention.kind}:${mention.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({ kind: mention.kind, id: mention.id, name });
  }
  return items;
}

function currentMentionToken() {
  const text = inputText.value;
  const cursor = messageInputRef.value?.selectionStart ?? text.length;
  const beforeCursor = text.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([^\s@]{0,30})$/);
  if (!match) {
    return null;
  }
  return {
    start: beforeCursor.length - match[2].length - 1,
    end: cursor,
    query: match[2]
  };
}

async function handleInputMention() {
  if (!consentAccepted.value) {
    mentionPickerOpen.value = false;
    return;
  }
  const token = currentMentionToken();
  if (!token) {
    mentionPickerOpen.value = false;
    mentionCandidateQuery.value = "";
    mentionCandidateTotal.value = 0;
    return;
  }
  await loadMentionCandidates(token.query, true);
}

async function loadMentionCandidates(query: string, reset = false) {
  if (!consentAccepted.value || loadingMentions.value) {
    return;
  }
  if (reset) {
    mentionCandidateQuery.value = query;
    mentionCandidates.value = [];
    mentionCandidateTotal.value = 0;
  }
  loadingMentions.value = true;
  try {
    const response = await fetchWorldChatMentionCandidates(query, reset ? 0 : mentionCandidates.value.length, 20);
    mentionCandidateTotal.value = Number(response.total || 0);
    const nextItems = Array.isArray(response.items) ? response.items : [];
    mentionCandidates.value = reset ? nextItems : [...mentionCandidates.value, ...nextItems];
    mentionPickerOpen.value = mentionCandidates.value.length > 0;
  } catch (error) {
    mentionPickerOpen.value = false;
    showToast(error instanceof Error ? error.message : "@ 候选列表加载失败", "error");
  } finally {
    loadingMentions.value = false;
  }
}

function handleMentionScroll(event: Event) {
  const el = event.currentTarget as HTMLElement | null;
  if (!el || loadingMentions.value || mentionCandidates.value.length >= mentionCandidateTotal.value) {
    return;
  }
  if (el.scrollHeight - el.scrollTop - el.clientHeight <= 36) {
    void loadMentionCandidates(mentionCandidateQuery.value, false);
  }
}

async function insertMention(target: WorldChatMentionTarget) {
	const name = String(target.name || "").trim();
	if (!target.kind || !target.id || !name) {
		return;
	}
	const token = currentMentionToken();
	const text = inputText.value;
	let caret = text.length;
	if (token) {
		const inserted = `@${name} `;
		inputText.value = `${text.slice(0, token.start)}${inserted}${text.slice(token.end)}`;
		caret = token.start + inserted.length;
	} else {
		const prefix = text.endsWith(" ") || text === "" ? "" : " ";
		const inserted = `${prefix}@${name} `;
		inputText.value = `${text}${inserted}`;
		caret = text.length + inserted.length;
	}
	draftMentions.value = [...draftMentions.value, { kind: target.kind, id: target.id, name }];
	mentionPickerOpen.value = false;
	mentionContextMenu.value = null;
	await focusMessageInputAt(caret);
}

async function focusMessageInputAt(position: number) {
	await nextTick();
	window.requestAnimationFrame(() => {
		const input = messageInputRef.value;
		if (!input) {
			return;
		}
		input.focus();
		input.setSelectionRange(position, position);
	});
}

function openMentionContext(event: MouseEvent, member?: WorldChatMemberSummary | null) {
  const siteId = String(member?.siteId || "").trim();
  if (!siteId) {
    return;
  }
  const target: WorldChatMentionTarget = isAssistantMember(member)
    ? { kind: "sitebot", id: "xiaoxing", name: "AstrahBot" }
    : { kind: "site", id: siteId, name: memberName(member) };
  const point = contextMenuPoint(event);
  mentionContextMenu.value = {
    x: point.x,
    y: point.y,
    target
  };
  emojiPickerOpen.value = false;
  mentionPickerOpen.value = false;
  quoteContextMenu.value = null;
}

function openQuoteContext(event: MouseEvent, message: WorldChatMessage) {
  if (!message.messageId || message.status === "deleted") {
    return;
  }
  const point = contextMenuPoint(event);
  quoteContextMenu.value = {
    x: point.x,
    y: point.y,
    message
  };
  mentionContextMenu.value = null;
  emojiPickerOpen.value = false;
  mentionPickerOpen.value = false;
}

function contextMenuPoint(event: MouseEvent) {
  const shell = shellRef.value;
  const rect = shell?.getBoundingClientRect();
  const margin = 8;
  const menuWidth = 56;
  const menuHeight = 34;
  if (!rect) {
    return {
      x: Math.max(event.clientX, margin),
      y: Math.max(event.clientY, margin)
    };
  }
  const rawX = event.clientX - rect.left;
  const rawY = event.clientY - rect.top;
  const x = Math.min(Math.max(rawX, margin), rect.width - menuWidth - margin);
  const y = Math.min(Math.max(rawY, margin), rect.height - menuHeight - margin);
  return { x, y };
}

async function quoteMessage(message: WorldChatMessage) {
  replyDraftMessage.value = message;
  quoteContextMenu.value = null;
  await nextTick();
  messageInputRef.value?.focus();
}

function cancelReplyDraft() {
  replyDraftMessage.value = null;
}

function updateEmojiPanelPosition() {
  const composer = composerRef.value;
  const button = emojiButtonRef.value;
  if (!composer || !button) {
    return;
  }
  const composerRect = composer.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const panelLeft = 20;
  const buttonCenterX = buttonRect.left + buttonRect.width / 2 - composerRect.left;
  emojiPanelStyle.value = {
    "--emoji-arrow-center": `${buttonCenterX - panelLeft}px`
  };
}

async function toggleEmojiPicker() {
  emojiPickerOpen.value = !emojiPickerOpen.value;
  if (!emojiPickerOpen.value) {
    stickerEditing.value = false;
    return;
  }
  await nextTick();
  updateEmojiPanelPosition();
}

function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  if (mentionContextMenu.value && !target?.closest(".sc-mention-context")) {
    mentionContextMenu.value = null;
  }
  if (quoteContextMenu.value && !target?.closest(".sc-quote-context")) {
    quoteContextMenu.value = null;
  }
  if (mentionPickerOpen.value && !target?.closest(".sc-mention-panel") && !target?.closest(".sc-input-card")) {
    mentionPickerOpen.value = false;
  }
  if (!emojiPickerOpen.value) {
    return;
  }
  if (target?.closest(".sc-emoji-panel") || target?.closest(".sc-emoji-button")) {
    return;
  }
  emojiPickerOpen.value = false;
}

function handleDocumentScrollBlock(event: Event) {
  if (!mentionContextMenu.value && !quoteContextMenu.value) {
    return;
  }
  event.preventDefault();
}

function isChatAtBottom() {
  const el = chatScrollRef.value;
  if (!el) {
    return false;
  }
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
}

function handleChatScroll() {
  const el = chatScrollRef.value;
  if (el) {
    scrollOffsetFromBottom.value = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
  }
  if (el && el.scrollTop <= 24 && hasMoreBefore.value && !loadingMore.value) {
    void loadEarlierMessages();
  }
  if (isChatAtBottom()) {
    pendingNewMessages.value = 0;
  }
}

async function jumpToLatest() {
  await nextTick();
  scrollToBottom();
}

function handleMemberScroll(event: Event) {
  const el = event.currentTarget as HTMLElement | null;
  if (!el || loadingMembers.value || members.value.length >= memberTotal.value) {
    return;
  }
  if (el.scrollHeight - el.scrollTop - el.clientHeight <= 48) {
    void loadMembers(false);
  }
}

function handleRecentPostsScroll(event: Event) {
  const el = event.currentTarget as HTMLElement | null;
  if (!el || visibleRecentPostCount.value >= recentPosts.value.length) {
    return;
  }
  if (el.scrollHeight - el.scrollTop - el.clientHeight <= 32) {
    visibleRecentPostCount.value = Math.min(visibleRecentPostCount.value + 4, recentPosts.value.length);
  }
}

function handleRecentPostsWheel(event: WheelEvent) {
  if (event.deltaY <= 0 || visibleRecentPostCount.value >= recentPosts.value.length) {
    return;
  }
  visibleRecentPostCount.value = Math.min(visibleRecentPostCount.value + 4, recentPosts.value.length);
}

function isOwnMessage(message: WorldChatMessage) {
  return String(message.sender?.siteId || "").trim() === currentSiteId.value;
}

function isAssistantMessage(message: WorldChatMessage) {
  return isAssistantMember(message.sender);
}

function canReportMessage(message: WorldChatMessage) {
  return consentAccepted.value && Boolean(message.messageId) && !reportingMessageId.value && !isOwnMessage(message) && !isAssistantMessage(message) && message.status !== "deleted";
}

function canRetractMessage(message: WorldChatMessage) {
  if (message.messageId.startsWith("local:")) {
    return false;
  }
  const createdAt = new Date(message.createdAt).getTime();
  return Number.isFinite(createdAt) && currentTime.value - createdAt <= 3 * 60 * 1000;
}

function memberName(member?: WorldChatMemberSummary | null) {
  return String(member?.name || member?.url || "未命名星系").trim();
}

function avatarText(member?: WorldChatMemberSummary | null) {
  const name = memberName(member);
  return name.slice(0, 1).toUpperCase();
}

function avatarUrl(member?: { avatarUrl?: string; updatedAt?: string } | null) {
  const raw = String(member?.avatarUrl || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  // 版本放在代理 URL 上，避免改写远端带签名的图片地址。
  const url = graphAvatarProxyUrl(raw);
  const version = String(member?.updatedAt || "").trim();
  return version ? url + "&v=" + encodeURIComponent(version) : url;
}

function checkinLevel(member?: WorldChatMemberSummary | null) {
  const days = Math.max(0, Math.floor(Number(member?.checkinDays || 0)));
  if (checkinLevelCache.has(days)) {
    return checkinLevelCache.get(days) || null;
  }
  const level = checkinLevels.find((candidate) => days >= candidate.days) || null;
  checkinLevelCache.set(days, level);
  return level;
}

function checkinFrameClass(member?: WorldChatMemberSummary | null) {
  return checkinLevel(member) ? ["has-checkin-frame"] : [];
}

function checkinFrameUrl(member?: WorldChatMemberSummary | null) {
  const level = checkinLevel(member);
  return level
    ? checkinFrames[`../assets/world-chat-checkin/checkin-${level.days}-days.webp`] || ""
    : "";
}

function checkinTitle(member?: WorldChatMemberSummary | null) {
  return checkinLevel(member)?.title || "";
}

function displayMemberName(member?: WorldChatMemberSummary | null) {
  if (isAssistantMember(member)) {
    return "AstrahBot";
  }
  const siteName = String(member?.name || member?.url || "未命名站点").trim();
  const galaxyName = String(member?.category || "").trim();
  return galaxyName ? `${siteName} · ${galaxyName}` : siteName;
}

function isAssistantMember(member?: WorldChatMemberSummary | null) {
  return String(member?.siteId || "").trim() === "system_xiaoxing";
}

function mentionCandidateSubtitle(candidate: WorldChatMentionCandidate) {
  if (candidate.kind === "sitebot") {
    return candidate.description || "系统助手";
  }
  const siteName = String(candidate.name || candidate.url || "未命名站点").trim();
  const galaxyName = String(candidate.category || "").trim();
  return galaxyName ? `${siteName} · ${galaxyName}` : siteName;
}

function displayMessageMember(message: WorldChatMessage) {
  const siteId = String(message.sender?.siteId || "").trim();
  return memberBySiteId.value.get(siteId) || message.sender;
}

function formatTime(value?: string) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDate(value?: string) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).replace(/\//g, "/");
}

function domainText(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "--";
  }
  try {
    return new URL(raw).hostname;
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

function hasMemberMetrics(member?: WorldChatMemberDetail | null) {
  return Boolean(
    Number(member?.influenceScore || 0) > 0 ||
    Number(member?.trustScore || 0) > 0 ||
    Number(member?.friendLinkCount || 0) > 0
  );
}

function relationActionText(member?: WorldChatMemberDetail | null) {
  if (inviting.value) {
    return "邀请中...";
  }
  return member?.relationStatus === "mutual" ? "互相关注" : "发送邀请";
}

function relationActionDisabled(member?: WorldChatMemberDetail | null) {
  return inviting.value || !member || member.siteId === currentSiteId.value || member.relationStatus === "mutual";
}

function visitSelectedMember() {
  const url = String(selectedMember.value?.url || "").trim();
  if (!url) {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function formatDateTime(value: Date) {
  return value.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function messageText(message: WorldChatMessage) {
  if (message.status === "deleted") {
    return isOwnMessage(message) ? "你已撤回" : "对方已撤回";
  }
  return displayPayloadText(message);
}

function displayPayloadText(message: DisplayableWorldChatMessage) {
  if (message.status === "deleted") {
    return "消息已撤回";
  }
  const encrypted = message.encrypted;
  if (!encrypted || encrypted.algorithm !== "plain-text") {
    return "[回复消息]";
  }
  return decodeBase64Text(encrypted.ciphertext);
}

function messagePayload(message: DisplayableWorldChatMessage) {
  const text = displayPayloadText(message);
  try {
    return JSON.parse(text) as { type?: string; stickerId?: string };
  } catch {
    return null;
  }
}

function isStickerMessage(message: DisplayableWorldChatMessage) {
  const payload = messagePayload(message);
  return payload?.type === "sticker" && Boolean(payload.stickerId);
}

function quotePreviewText(message: DisplayableWorldChatMessage) {
  if (isStickerMessage(message)) {
    return "[表情包]";
  }
  const text = displayPayloadText(message).replace(/\s+/g, " ").trim();
  return text.length > 48 ? `${text.slice(0, 48)}...` : text;
}

function quotedMessage(message: WorldChatMessage) {
  return message.replyTo || null;
}

function quotedAuthorName(message: WorldChatMessage) {
  return quoteAuthorName(quotedMessage(message));
}

function quotedPreviewText(message: WorldChatMessage) {
  const quote = quotedMessage(message);
  return quote ? quotePreviewText(quote) : "";
}

function quoteAuthorName(message?: DisplayableWorldChatMessage | null) {
  if (!message) {
    return "回复消息";
  }
  return displayMemberName(message.sender);
}

function quoteMentionName(message?: DisplayableWorldChatMessage | null) {
  if (!message) {
    return "";
  }
  return memberName(message.sender);
}

function replyBodyText(message: WorldChatMessage) {
  const quote = quotedMessage(message);
  const mentionName = quoteMentionName(quote);
  const text = messageText(message);
  if (!mentionName || text.startsWith(`@${mentionName}`)) {
    return text;
  }
  return `@${mentionName} ${text}`;
}

function stickerMessageUrl(message: WorldChatMessage) {
  const stickerId = String(messagePayload(message)?.stickerId || "").trim();
  return stickerId ? worldChatStickerFileUrl(stickerId) : "";
}

function stickerPayloadText(stickerId: string) {
  return JSON.stringify({
    type: "sticker",
    stickerId
  });
}

function buildPlainTransportFrame(text: string): WorldChatEncryptedPayload {
  return {
    algorithm: "plain-text",
    keyAgreement: "none",
    epoch: Date.now(),
    nonce: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    ciphertext: encodeBase64Text(text),
    aad: currentSiteId.value
  };
}

function encodeBase64Text(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeBase64Text(value: string) {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "[消息解析失败]";
  }
}

function realtimeMessageFromEvent(event: HubRealtimeEvent<unknown>) {
  const data = event.data as { message?: WorldChatMessage; messageId?: string } | WorldChatMessage | undefined;
  const message = ((data as { message?: WorldChatMessage })?.message || data) as WorldChatMessage | undefined;
  if (!message?.messageId) {
    return null;
  }
  return message;
}

function applyMuteUpdateFromEvent(event: HubRealtimeEvent<unknown>) {
  const data = (event.data || {}) as {
    targetSiteId?: string;
    siteId?: string;
    muted?: boolean;
    mutedUntil?: string;
    reason?: string;
  };
  const targetSiteId = String(data.targetSiteId || data.siteId || "").trim();
  if (targetSiteId && targetSiteId !== currentSiteId.value) {
    return;
  }
  if (!data.muted) {
    mutedUntil.value = "";
    mutedReason.value = "";
    return;
  }
  mutedUntil.value = String(data.mutedUntil || "");
  mutedReason.value = String(data.reason || "");
}

async function refreshLatestMessages() {
  if (!consentAccepted.value) {
    return;
  }
  const lastMessage = [...messages.value].reverse().find((message) => !message.messageId.startsWith("local:"));
  const response = await fetchWorldChatMessages({
    afterMessageId: lastMessage?.messageId,
    limit: 30
  });
  upsertMessages(Array.isArray(response.items) ? response.items : []);
}

async function handleChatRealtime(event: HubRealtimeEvent<unknown> | null) {
    if (disposed) return;
    if (!consentAccepted.value) {
      return;
    }
    if (!event) {
      return;
    }
    if (loading.value && event.type !== "realtime_resync_required") {
      bufferedRealtime.push(event);
      return;
    }
    if (event.type === "realtime_resync_required") {
      await loadBootstrap();
      return;
    }
    if (event.type === "site_profile_updated") {
      const data = (event.data || {}) as {
        siteId?: string;
        name?: string;
        url?: string;
        nodeName?: string;
        category?: string;
        nodeAvatar?: string;
        profileUpdatedAt?: string;
      };
      const siteId = String(data.siteId || "").trim();
      const relevant = members.value.some((member) => member.siteId === siteId)
        || messages.value.some((message) => message.sender?.siteId === siteId)
        || selectedMember.value?.siteId === siteId;
      if (siteId && relevant) {
        const profile: WorldChatMemberSummary = {
          siteId,
          name: String(data.name || "").trim(),
          url: String(data.url || "").trim(),
          category: String(data.nodeName || data.category || "").trim(),
          avatarUrl: String(data.nodeAvatar || "").trim(),
          updatedAt: String(data.profileUpdatedAt || new Date().toISOString()).trim()
        };
        upsertMembers([profile]);
        if (selectedMember.value?.siteId === siteId) {
          selectedMember.value = { ...selectedMember.value, ...profile };
        }
      }
      return;
    }
    if (event.type === "world_chat_mute_updated") {
      applyMuteUpdateFromEvent(event);
      return;
    }
    if (event.type === "world_chat_member_updated") {
      const data = (event.data || {}) as { member?: WorldChatMemberSummary };
      const member = data.member;
      if (!member?.siteId) {
        return;
      }
      upsertMembers([member]);
      if (currentMember.value?.siteId === member.siteId) {
        currentMember.value = { ...currentMember.value, ...member };
      }
      if (selectedMember.value?.siteId === member.siteId) {
        selectedMember.value = { ...selectedMember.value, ...member };
      }
      messages.value = messages.value.map((message) => ({
        ...message,
        sender: message.sender?.siteId === member.siteId ? { ...message.sender, ...member } : message.sender,
        replyTo: message.replyTo && message.replyTo.sender?.siteId === member.siteId
          ? { ...message.replyTo, sender: { ...message.replyTo.sender, ...member } }
          : message.replyTo
      }));
      return;
    }
    if (event.type !== "world_chat_message_created" && event.type !== "world_chat_message_updated") {
      return;
    }
    const message = realtimeMessageFromEvent(event);
    if (!message) {
      await refreshLatestMessages();
      await nextTick();
      if (isChatAtBottom()) {
        scrollToBottom();
      }
      return;
    }
    const shouldFollow = isChatAtBottom() || isOwnMessage(message);
    applyMessageUpdate(message);
    if (event.type === "world_chat_message_created") {
      await refreshMentionPrompt();
    }
    if (!shouldFollow && event.type === "world_chat_message_created") {
      pendingNewMessages.value += 1;
    }
    await nextTick();
    if (shouldFollow) {
      scrollToBottom();
    }
}
watch(() => props.realtimeEvent, handleChatRealtime, { flush: "sync" });

watch(
  () => [props.settings.credentials.siteId, props.settings.credentials.apiKey].join("|"),
  () => {
    void loadConsentGate();
  }
);

onMounted(() => {
  currentTimeTimer = window.setInterval(() => {
    currentTime.value = Date.now();
  }, 15000);
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("wheel", handleDocumentScrollBlock, { passive: false });
  document.addEventListener("touchmove", handleDocumentScrollBlock, { passive: false });
  window.addEventListener("resize", updateEmojiPanelPosition);
  // Cached chat data survives Halo route changes, while this lightweight
  // media gate is component-local. Re-enable avatar/sticker rendering on
  // every mount even when Bootstrap can be skipped.
  scheduleDeferredMedia();
  void loadConsentGate();
});

onBeforeUnmount(() => {
  disposed = true;
  bufferedRealtime.length = 0;
  loading.value = false;
  loadingMembers.value = false;
  loadingMore.value = false;
  if (currentTimeTimer !== undefined) {
    window.clearInterval(currentTimeTimer);
  }
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("wheel", handleDocumentScrollBlock);
  document.removeEventListener("touchmove", handleDocumentScrollBlock);
  window.removeEventListener("resize", updateEmojiPanelPosition);
  if (deferredMediaTimer !== undefined) {
    window.clearTimeout(deferredMediaTimer);
    deferredMediaTimer = undefined;
  }
});
</script>

<template>
  <section ref="shellRef" class="sc-shell" :class="{ 'is-drawer-collapsed': memberDrawerCollapsed }">
    <div v-if="!canAccess" class="sc-empty">
      <strong>请先完成接入或重新登舱</strong>
      <span>星际通讯只向已接入星链的站点开放，消息会使用本站保存的站点编号和密钥签名发送到 Hub。</span>
    </div>

    <template v-else>
      <main class="sc-chat">
        <header class="sc-chat-head">
          <div>
            <strong>公共频道</strong>
          </div>
          <button class="sc-chat-refresh" type="button" :disabled="loading || consentLoading" @click="loadConsentGate">
            <span :class="{ 'is-spinning': loading || consentLoading }"></span>
            刷新
          </button>
        </header>

        <div ref="chatScrollRef" class="sc-chat-scroll" @scroll.passive="handleChatScroll">
          <div v-if="loadingMore" class="sc-load-earlier">
            {{ loadingMore ? "加载中..." : "加载历史通讯记录" }}
          </div>

          <div v-if="loading || consentLoading" class="sc-state">正在接入公共频道...</div>
          <div v-else-if="messages.length === 0" class="sc-state">暂无通讯记录</div>

          <template v-for="message in messages" :key="message.messageId">
          <div v-if="historyAnchorLocated && historyAnchorMessageId === message.messageId" class="sc-read-marker">上次阅读到这里，以下为新消息</div>
          <article
            :data-message-id="message.messageId"
            class="sc-message-row"
            :class="{ 'is-own': isOwnMessage(message), 'is-retracted': message.status === 'deleted', 'is-highlighted': highlightedMessageId === message.messageId }"
          >
            <p v-if="message.status === 'deleted'" class="sc-retract-notice">{{ messageText(message) }}</p>
            <button v-else class="sc-avatar" :class="checkinFrameClass(displayMessageMember(message))" type="button" @click="openMember(message.sender.siteId)" @contextmenu.prevent="openMentionContext($event, displayMessageMember(message))">
              <img
                v-if="secondaryMediaReady && avatarUrl(displayMessageMember(message))"
                class="sc-avatar-image"
                :src="avatarUrl(displayMessageMember(message))"
                alt=""
                loading="lazy"
                decoding="async"
                fetchpriority="low"
              />
              <span v-else class="sc-avatar-fallback">{{ avatarText(displayMessageMember(message)) }}</span>
              <img
                v-if="checkinFrameUrl(displayMessageMember(message))"
                class="sc-checkin-frame"
                :src="checkinFrameUrl(displayMessageMember(message))"
                alt=""
                aria-hidden="true"
              />
            </button>
            <div v-if="message.status !== 'deleted'" class="sc-message-body">
              <div class="sc-message-meta">
                <button type="button" @click="openMember(message.sender.siteId)" @contextmenu.prevent="openMentionContext($event, displayMessageMember(message))">{{ displayMemberName(displayMessageMember(message)) }}</button>
                <em v-if="checkinTitle(displayMessageMember(message))" class="sc-checkin-title">{{ checkinTitle(displayMessageMember(message)) }}</em>
                <span>{{ formatTime(message.createdAt) }}</span>
              </div>
              <div class="sc-message-content">
                <span v-if="deliveryState(message) === 'sending'" class="sc-delivery-state is-sending" title="发送中" aria-label="发送中"></span>
                <button
                  v-else-if="deliveryState(message) === 'failed'"
                  class="sc-delivery-state is-failed"
                  type="button"
                  title="发送失败，点击重试"
                  aria-label="发送失败，点击重试"
                  @click="retryMessage(message)"
                >!</button>
                <div v-if="isStickerMessage(message)" class="sc-sticker-bubble" @contextmenu.prevent="openQuoteContext($event, message)">
                  <img :src="stickerMessageUrl(message)" alt="" />
                </div>
                <div v-else class="sc-bubble" @contextmenu.prevent="openQuoteContext($event, message)">
                  <div v-if="quotedMessage(message)" class="sc-quote-block">
                    <strong>{{ quotedAuthorName(message) }}</strong>
                    <span>{{ quotedPreviewText(message) }}</span>
                  </div>
                  <p>{{ replyBodyText(message) }}</p>
                </div>
              </div>
              <button v-if="isOwnMessage(message) && !deliveryState(message) && message.status !== 'deleted' && canRetractMessage(message)" class="sc-report" type="button" @click="retractMessage(message)">
                {{ retractingMessageId === message.messageId ? "撤回中" : "撤回" }}
              </button>
              <span v-else-if="isOwnMessage(message) && !deliveryState(message) && message.status !== 'deleted'" class="sc-expired-retract">已超过 3 分钟，不可撤回</span>
              <button v-if="canReportMessage(message)" class="sc-report" type="button" @click="reportMessage(message)">
                {{ reportingMessageId === message.messageId ? "提交中" : "举报" }}
              </button>
            </div>
          </article>
          </template>
        </div>
        <button
          v-if="historyPromptVisible"
          class="sc-history-messages"
          type="button"
          :disabled="loadingHistoryAnchor"
          @click="jumpToHistoryAnchor"
        >
          {{ loadingHistoryAnchor ? "正在定位历史位置..." : `查看上次阅读位置 · ${historyUnreadCount} 条未读` }}
        </button>
        <button
          v-if="pendingMentionCount > 0 || pendingNewMessages > 0"
          class="sc-new-messages"
          type="button"
          @click="handleNoticeClick"
        >
          {{ pendingMentionCount > 0 ? "有人 @ 我，点击查看" : `${pendingNewMessages} 条新消息，回到底部` }}
        </button>

        <form ref="composerRef" class="sc-composer" @submit.prevent="sendMessage">
          <div class="sc-composer-tools">
            <button ref="emojiButtonRef" class="sc-emoji-button" type="button" title="选择表情" @click="toggleEmojiPicker">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" />
                <path d="M8.5 10h.01M15.5 10h.01M8.8 14.2c1.6 1.5 4.8 1.5 6.4 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          <div v-if="emojiPickerOpen" class="sc-emoji-panel" :style="emojiPanelStyle">
            <div class="sc-emoji-tabs">
              <button v-for="group in emojiGroups" :key="group.name" type="button" :class="{ active: activeEmojiGroup === group.name }" @click="activeEmojiGroup = group.name">{{ group.name }}</button>
              <button type="button" :class="{ active: activeEmojiGroup === customStickerTab }" @click="activeEmojiGroup = customStickerTab">自定义</button>
              <button v-if="activeEmojiGroup === customStickerTab" class="sc-sticker-edit" type="button" :disabled="stickers.length === 0" @click="stickerEditing = !stickerEditing">
                {{ stickerEditing ? "完成" : "编辑" }}
              </button>
            </div>
            <div v-if="activeEmojiGroup !== customStickerTab" class="sc-emoji-scroll">
              <button v-for="emoji in activeEmojiItems" :key="`${activeEmojiGroup}-${emoji}`" type="button" @click="insertEmoji(emoji)">{{ emoji }}</button>
            </div>
            <div v-if="activeEmojiGroup === customStickerTab" class="sc-sticker-grid" :class="{ 'is-editing': stickerEditing }">
              <div v-for="sticker in stickers" :key="sticker.stickerId" class="sc-sticker-item">
                <button type="button" :disabled="stickerEditing" @click="sendSticker(sticker)">
                  <img :src="worldChatStickerFileUrl(sticker.stickerId)" alt="" />
                </button>
                <button v-if="stickerEditing" class="sc-sticker-delete" type="button" @click="removeSticker(sticker)">删除</button>
              </div>
              <button v-if="stickers.length < 10" class="sc-sticker-upload" type="button" :disabled="uploadingSticker" @click="openStickerUpload">
                {{ uploadingSticker ? "…" : "+" }}
              </button>
            </div>
            <input ref="stickerInputRef" class="sc-sticker-input" type="file" accept="image/png,image/jpeg,image/gif" @change="handleStickerUpload" />
          </div>
          <div class="sc-input-card">
            <div v-if="replyDraftMessage" class="sc-reply-draft">
              <strong>{{ quoteAuthorName(replyDraftMessage) }}</strong>
              <span>{{ quotePreviewText(replyDraftMessage) }}</span>
              <button type="button" aria-label="取消回复" @click="cancelReplyDraft">×</button>
            </div>
            <div v-if="mentionPickerOpen" class="sc-mention-panel" @scroll.passive="handleMentionScroll">
              <button
                v-for="candidate in mentionCandidates"
                :key="`${candidate.kind}-${candidate.id}`"
                type="button"
                @click="insertMention(candidate)"
              >
                <span class="sc-mention-avatar">
                  <img
                    v-if="secondaryMediaReady && avatarUrl(candidate)"
                    :src="avatarUrl(candidate)"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    fetchpriority="low"
                  />
                  <span v-else>{{ candidate.kind === 'sitebot' ? '助' : String(candidate.name || '星').slice(0, 1).toUpperCase() }}</span>
                </span>
                <span>
                  <strong>{{ candidate.name }}</strong>
                  <em>{{ mentionCandidateSubtitle(candidate) }}</em>
                </span>
              </button>
            </div>
            <textarea
              id="chat-message-input"
              ref="messageInputRef"
              v-model="inputText"
              maxlength="500"
              :disabled="isMuted || !consentAccepted"
              :placeholder="isMuted ? muteText : '输入要发送到公共频道的消息...'"
              @input="handleInputMention"
              @keydown.enter.exact.prevent="sendMessage"
            ></textarea>
            <footer>
              <span>Enter 发送 / Shift + Enter 换行 · {{ inputText.length }}/500</span>
              <button class="sc-send-button" type="submit" :disabled="isMuted || !consentAccepted || !inputText.trim()" @mousedown.prevent>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4.5 11.4 19.2 4.6c.7-.3 1.4.4 1.1 1.1l-6.8 14.7c-.3.7-1.3.6-1.5-.1l-1.8-6.1-5.9-1.4c-.8-.2-.9-1.1-.2-1.4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                  <path d="m10.4 14 4.1-4.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
                <span>发送消息</span>
              </button>
            </footer>
          </div>
        </form>
      </main>

      <button class="sc-drawer-toggle" :class="{ 'is-collapsed': memberDrawerCollapsed }" type="button" @click="toggleMemberDrawer">
        <span>{{ memberDrawerCollapsed ? "展开" : "收起" }}</span>
        <em v-if="pendingNewMessages > 0">{{ pendingNewMessages > 99 ? "99+" : pendingNewMessages }}</em>
      </button>

      <aside v-if="!memberDrawerCollapsed" class="sc-drawer">
        <div class="sc-drawer-head" :class="{ 'is-searching': searchExpanded }">
          <strong>
            在线成员
            <em v-if="pendingNewMessages > 0" class="sc-head-badge">{{ pendingNewMessages > 99 ? "99+" : pendingNewMessages }}</em>
          </strong>
          <button v-if="!searchExpanded" class="sc-search-toggle" type="button" @click="searchExpanded = true">搜索</button>
          <label v-else class="sc-search">
            <input v-model="searchQuery" type="search" placeholder="搜索星系或 URL" autofocus />
            <button type="button" @click="searchExpanded = false; searchQuery = ''">取消</button>
          </label>
        </div>
        <div class="sc-member-list" @scroll.passive="handleMemberScroll">
          <button
            v-for="member in filteredMembers"
            :key="member.siteId"
            class="sc-member-card"
            type="button"
            @click="openMember(member.siteId)"
            @contextmenu.prevent="openMentionContext($event, member)"
          >
            <span class="sc-member-avatar" :class="checkinFrameClass(member)">
              <img
                v-if="secondaryMediaReady && avatarUrl(member)"
                class="sc-avatar-image"
                :src="avatarUrl(member)"
                alt=""
                loading="lazy"
                decoding="async"
                fetchpriority="low"
              />
              <span v-else class="sc-avatar-fallback">{{ avatarText(member) }}</span>
              <img v-if="checkinFrameUrl(member)" class="sc-checkin-frame" :src="checkinFrameUrl(member)" alt="" aria-hidden="true" />
            </span>
            <span>
              <strong>{{ displayMemberName(member) }}</strong>
              <em>接入 {{ formatDate(member.joinedAt) }} · 活跃 {{ formatDate(member.updatedAt) }}</em>
            </span>
          </button>
          <div v-if="loadingMembers || members.length < memberTotal" class="sc-member-more">
            <span v-if="loadingMembers" class="sc-member-more-spinner" aria-hidden="true"></span>
            <strong>{{ loadingMembers ? "加载更多成员中…" : "上滑继续加载更多成员" }}</strong>
          </div>
        </div>
      </aside>

      <div v-if="loading || consentLoading" class="sc-chat-loading">
        <span></span>
        <strong>请刷新通讯频道</strong>
      </div>

      <div v-if="!consentAccepted && !consentLoading" class="sc-consent-gate">
        <article class="sc-consent-card">
          <header>
            <span>首次使用确认</span>
            <strong>{{ consentPolicyTitle }}</strong>
          </header>
          <div class="sc-consent-body" @scroll.passive="handleConsentScroll" v-html="consentPolicyHtml"></div>
          <footer>
            <span class="sc-consent-status is-readable">{{ consentScrolledToEnd ? "已阅读到底部，可以确认开启星际通讯。" : "请阅读到底部，再点击同意。" }}</span>
            <span class="sc-consent-status">{{ consentScrolledToEnd ? "已阅读到底部，可以确认开启星际通讯。" : "请阅读到底部，再点击同意。" }}</span>
            <span>{{ consentScrolledToEnd ? "已阅读到底部，请确认选择" : "请阅读到底部，再点击同意。" }}</span>
            <div>
              <button v-if="false" type="button" class="is-secondary" :disabled="consentSubmitting || !consentState" @click="submitConsent(false)">
                我不同意
              </button>
              <button type="button" :disabled="consentSubmitting || !consentState || !consentScrolledToEnd" @click="submitConsent(true)">
                {{ consentSubmitting ? "提交中..." : "我同意" }}
              </button>
            </div>
          </footer>
        </article>
      </div>
    </template>

    <div v-if="toast" class="sc-toast" :class="`is-${toast.type}`">{{ toast.message }}</div>

    <div
      v-if="mentionContextMenu"
      class="sc-mention-context"
      :style="{ left: `${mentionContextMenu.x}px`, top: `${mentionContextMenu.y}px` }"
    >
      <button type="button" @click="insertMention(mentionContextMenu.target)">@TA</button>
    </div>

    <div
      v-if="quoteContextMenu"
      class="sc-quote-context"
      :style="{ left: `${quoteContextMenu.x}px`, top: `${quoteContextMenu.y}px` }"
    >
      <button type="button" @click="quoteMessage(quoteContextMenu.message)">回复</button>
    </div>

    <div v-if="selectedMember" class="sc-modal-root">
      <article class="sc-modal-card">
        <button class="sc-modal-close" type="button" @click="closeMember">x</button>
        <div v-if="loadingMemberDetail" class="sc-modal-loading" aria-live="polite">
          <span aria-hidden="true"></span>
          <strong>loading</strong>
        </div>
        <div v-else class="sc-modal-layout">
          <section class="sc-profile-main">
            <header class="sc-profile-head">
              <span class="sc-profile-avatar" :class="checkinFrameClass(selectedMember)">
                <img
                  v-if="secondaryMediaReady && avatarUrl(selectedMember)"
                  class="sc-avatar-image"
                  :src="avatarUrl(selectedMember)"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  fetchpriority="low"
                />
                <span v-else class="sc-avatar-fallback">{{ avatarText(selectedMember) }}</span>
                <img v-if="checkinFrameUrl(selectedMember)" class="sc-checkin-frame" :src="checkinFrameUrl(selectedMember)" alt="" aria-hidden="true" />
              </span>
              <div>
                <h3>{{ selectedMember.name || "未命名站点" }}</h3>
                <small v-if="checkinTitle(selectedMember)" class="sc-checkin-title">{{ checkinTitle(selectedMember) }}</small>
                <span>ID：{{ selectedMember.siteId }}</span>
              </div>
            </header>
            <dl class="sc-profile-facts">
              <div>
                <dt>星系</dt>
                <dd>{{ selectedMember.category || "--" }}</dd>
              </div>
              <div>
                <dt>地址</dt>
                <dd>
                  <span>{{ domainText(selectedMember.url) }}</span>
                </dd>
              </div>
              <div>
                <dt>简介</dt>
                <dd>{{ selectedMember.description || "该星系尚未填写介绍。" }}</dd>
              </div>
              <div>
                <dt>接入</dt>
                <dd>{{ formatDate(selectedMember.joinedAt) }}</dd>
              </div>
              <div>
                <dt>活跃</dt>
                <dd>{{ formatDate(selectedMember.updatedAt) }}</dd>
              </div>
              <div v-if="hasMemberMetrics(selectedMember)">
                <dt>指标</dt>
                <dd>
                  影响 {{ Number(selectedMember.influenceScore || 0).toFixed(2) }} ·
                  信任 {{ Number(selectedMember.trustScore || 0).toFixed(2) }} ·
                  友链 {{ Number(selectedMember.friendLinkCount || 0) }} 条
                </dd>
              </div>
            </dl>
            <footer v-if="!isSelectedAssistant" class="sc-modal-actions">
              <button type="button" :disabled="!selectedMember.url" @click="visitSelectedMember">访问星系</button>
              <button
                type="button"
                :disabled="relationActionDisabled(selectedMember)"
                @click="inviteSelectedMember"
              >
                {{ relationActionText(selectedMember) }}
              </button>
            </footer>
          </section>
          <aside v-if="isSelectedAssistant" class="sc-assistant-card">
            <strong>能力说明</strong>
            <span>生态说明：介绍博客星球、星系关系、关系排行和公开动态。</span>
            <span>接入协议：说明签发码、重新登舱、RSS 同步和常见接入问题。</span>
            <span>数据查询：根据当前 Hub 数据回答站点、公开记录、RSS 状态和关系网络。</span>
            <span>频道规则：只在被 @AstrahBot 时公开回复，不参与私聊和用户友链关系。</span>
            <span>安全边界：不会泄露密钥、后台权限码、后台用户或非公开管理数据。</span>
          </aside>
          <aside v-else class="sc-posts" @scroll.passive="handleRecentPostsScroll" @wheel.passive="handleRecentPostsWheel">
            <strong>RSS 最近文章</strong>
            <a v-for="post in visibleRecentPosts" :key="post.itemId || post.url" :href="post.url" target="_blank" rel="noreferrer">
              <span>{{ post.title }}</span>
              <em>{{ post.summary || "暂无文章摘要" }}</em>
            </a>
            <em v-if="recentPosts.length === 0">暂无可展示文章</em>
          </aside>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.sc-shell{position:relative;isolation:isolate;flex:1;min-height:0;display:flex;border-radius:22px;background:linear-gradient(135deg,#f8fbff 0%,#ffffff 45%,#eef6ff 100%);overflow:hidden;clip-path:inset(0 round 22px)}
.sc-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px;text-align:center;color:#64748b}
.sc-empty strong{color:#0f172a;font-size:18px}
.sc-empty span{max-width:520px;font-size:13px;line-height:1.8}
.sc-chat{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;border-radius:22px 0 0 22px;overflow:hidden}
.sc-chat-head{height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:0;background:rgba(248,250,252,.82);backdrop-filter:blur(18px);box-shadow:0 10px 26px rgba(15,23,42,.025)}
.sc-chat-head div{display:flex;flex-direction:column;gap:3px}
.sc-chat-head strong{color:#0f172a;font-size:14px;font-weight:900}
.sc-chat-head span{color:#64748b;font-size:11px;font-style:normal}
.sc-chat-refresh{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border:1px solid rgba(37,99,235,.18);border-radius:999px;background:#fff;color:#2563eb;font-size:11px;font-weight:900;cursor:pointer}
.sc-chat-refresh:disabled{cursor:not-allowed;opacity:.66}
.sc-chat-refresh span{width:12px;height:12px;border:2px solid rgba(37,99,235,.2);border-top-color:#2563eb;border-radius:999px}
.sc-chat-refresh span.is-spinning{animation:sc-spin .82s linear infinite}
.sc-chat-loading{position:absolute;inset:0;z-index:90;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(248,250,252,.78);backdrop-filter:blur(14px);color:#2563eb}
.sc-chat-loading span{width:30px;height:30px;border:3px solid rgba(37,99,235,.16);border-top-color:#2563eb;border-radius:999px;animation:sc-spin .82s linear infinite}
.sc-chat-loading strong{font-size:12px;font-weight:900}
.sc-consent-gate{position:absolute;inset:0;z-index:110;display:flex;padding:0;background:#f8fbff;backdrop-filter:blur(18px)}
.sc-consent-card{display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;border:0;border-radius:22px;background:#f8fbff;box-shadow:none}
.sc-consent-card header{display:flex;flex-direction:column;gap:8px;padding:30px 42px 16px;border-bottom:0;background:#f8fbff}
.sc-consent-card header span{color:#2563eb;font-size:0;font-weight:950;letter-spacing:.2em}
.sc-consent-card header span::before{content:"首次使用确认";font-size:12px}
.sc-consent-card header strong{color:#0f172a;font-size:24px;font-weight:950;line-height:1.35}
.sc-consent-body{flex:1;min-height:0;overflow-y:auto;padding:16px 42px 34px;scrollbar-width:none}
.sc-consent-body::-webkit-scrollbar{display:none}
.sc-consent-body h1{margin:0 0 20px;color:#0f172a;font-size:26px;line-height:1.35;font-weight:950}
.sc-consent-body h2{margin:30px 0 14px;padding:0 0 0 14px;border-left:4px solid rgba(37,99,235,.42);color:#172033;font-size:20px;line-height:1.45;font-weight:950}
.sc-consent-body h3{margin:22px 0 10px;color:#1e293b;font-size:17px;line-height:1.5;font-weight:950}
.sc-consent-body p{margin:11px 0;color:#334155;font-size:16px;line-height:2.05}
.sc-consent-body ul{margin:12px 0 16px;padding:12px 18px 12px 34px;border-radius:16px;background:rgba(255,255,255,.62);color:#334155}
.sc-consent-body li{margin:8px 0;font-size:16px;line-height:1.9}
.sc-consent-body strong{color:#0f172a;font-weight:950}
.sc-consent-body hr{display:none}
.sc-consent-card footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 42px 24px;border-top:0;background:#f8fbff}
.sc-consent-card footer>span{display:none;color:#64748b;font-size:13px;font-weight:800}
.sc-consent-card footer>.sc-consent-status{display:inline;color:#64748b;font-size:13px;font-weight:900}
.sc-consent-card footer div{display:flex;align-items:center;gap:10px}
.sc-consent-card footer button{height:42px;min-width:150px;border:1px solid rgba(37,99,235,.24);border-radius:14px;background:#2563eb;color:#fff;font-size:13px;font-weight:950;cursor:pointer;box-shadow:0 12px 28px rgba(37,99,235,.16)}
.sc-consent-card footer button.is-secondary{display:none}
.sc-consent-card footer button:not(.is-secondary){font-size:0}
.sc-consent-card footer button:not(.is-secondary)::before{content:"完成阅读并同意";font-size:13px}
.sc-consent-card footer button:disabled{cursor:not-allowed;opacity:.45}
.sc-consent-gate{background:linear-gradient(135deg,#f8fbff 0%,#ffffff 52%,#eef6ff 100%)!important}
.sc-consent-card{background:transparent!important;box-shadow:none!important}
.sc-consent-card header{gap:9px!important;flex-shrink:0;padding:34px 48px 10px!important;border:0!important;background:transparent!important}
.sc-consent-card header span{font-size:0!important}
.sc-consent-card header span::before{content:"首次使用确认"!important;font-size:13px!important;color:#2563eb!important;font-weight:950!important;letter-spacing:.18em!important}
.sc-consent-card header strong{max-width:920px!important;color:#0f172a!important;font-size:26px!important;font-weight:950!important;line-height:1.34!important;letter-spacing:-.02em!important}
.sc-consent-body{padding:12px 48px 28px!important}
.sc-consent-section{max-width:920px;margin:0 0 16px;padding:20px 24px;border:1px solid rgba(37,99,235,.08);border-radius:22px;background:rgba(255,255,255,.72);box-shadow:0 16px 38px rgba(15,23,42,.055)}
.sc-consent-section:first-child{margin-top:4px}
.sc-consent-body h1{display:none!important}
.sc-consent-body h2{margin:0 0 14px!important;padding:0!important;border:0!important;color:#0f172a!important;font-size:20px!important;line-height:1.45!important;font-weight:950!important;letter-spacing:-.01em!important}
.sc-consent-body h2::before{content:"";display:inline-block;width:8px;height:8px;margin-right:10px;border-radius:999px;background:#2563eb;box-shadow:0 0 0 6px rgba(37,99,235,.1);vertical-align:2px}
.sc-consent-body h3{margin:18px 0 9px!important;color:#1e293b!important;font-size:16px!important;line-height:1.55!important;font-weight:950!important}
.sc-consent-body p{margin:10px 0!important;color:#334155!important;font-size:15px!important;line-height:1.95!important}
.sc-consent-body ul{margin:12px 0 4px!important;padding:12px 16px 12px 36px!important;border-radius:16px!important;background:rgba(248,250,252,.9)!important;color:#334155!important}
.sc-consent-body li{margin:7px 0!important;font-size:15px!important;line-height:1.85!important}
.sc-consent-body strong{padding:0 2px;color:#0f172a!important;font-weight:950!important;background:linear-gradient(transparent 62%,rgba(147,197,253,.45) 0)}
.sc-consent-body hr{display:none!important}
.sc-consent-card footer{flex-shrink:0;padding:12px 48px 28px!important;border:0!important;background:transparent!important}
.sc-consent-card footer>span{display:none!important}
.sc-consent-card footer>.sc-consent-status.is-readable{display:inline!important;max-width:560px;color:#64748b!important;font-size:13px!important;font-weight:900!important;line-height:1.7!important}
.sc-consent-card footer button{height:42px!important;min-width:168px!important;border:1px solid rgba(37,99,235,.22)!important;border-radius:14px!important;background:#2563eb!important;color:#fff!important;font-size:0!important;font-weight:950!important;box-shadow:0 12px 28px rgba(37,99,235,.16)!important}
.sc-consent-card footer button.is-secondary{display:none!important}
.sc-consent-card footer button:not(.is-secondary)::before{content:"完成阅读并同意"!important;font-size:13px!important}
.sc-consent-card footer button:disabled{cursor:not-allowed!important;opacity:.45!important;box-shadow:none!important}
.sc-consent-body :deep(.sc-consent-section){max-width:920px;margin:0 0 16px;padding:20px 24px;border:1px solid rgba(37,99,235,.08);border-radius:22px;background:rgba(255,255,255,.72);box-shadow:0 16px 38px rgba(15,23,42,.055)}
.sc-consent-body :deep(.sc-consent-section:first-child){margin-top:4px}
.sc-consent-body :deep(h1){display:none!important}
.sc-consent-body :deep(h2){margin:0 0 14px!important;padding:0!important;border:0!important;color:#0f172a!important;font-size:20px!important;line-height:1.45!important;font-weight:950!important;letter-spacing:-.01em!important}
.sc-consent-body :deep(h2::before){content:"";display:inline-block;width:8px;height:8px;margin-right:10px;border-radius:999px;background:#2563eb;box-shadow:0 0 0 6px rgba(37,99,235,.1);vertical-align:2px}
.sc-consent-body :deep(h3){margin:18px 0 9px!important;color:#1e293b!important;font-size:16px!important;line-height:1.55!important;font-weight:950!important}
.sc-consent-body :deep(p){margin:10px 0!important;color:#334155!important;font-size:15px!important;line-height:1.95!important}
.sc-consent-body :deep(ul){margin:12px 0 4px!important;padding:12px 16px 12px 36px!important;border-radius:16px!important;background:rgba(248,250,252,.9)!important;color:#334155!important}
.sc-consent-body :deep(li){margin:7px 0!important;font-size:15px!important;line-height:1.85!important}
.sc-consent-body :deep(strong){padding:0 2px;color:#0f172a!important;font-weight:950!important;background:linear-gradient(transparent 62%,rgba(147,197,253,.45) 0)}
.sc-consent-body :deep(hr){display:none!important}
.sc-consent-body{padding:14px 56px 34px!important}
.sc-consent-body :deep(.sc-consent-section){display:contents!important}
.sc-consent-body :deep(h2){margin:26px 0 12px!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;color:#0f172a!important;font-size:21px!important}
.sc-consent-body :deep(h2::before){content:none!important;display:none!important}
.sc-consent-body :deep(h3){margin:20px 0 8px!important;color:#1e293b!important;font-size:17px!important}
.sc-consent-body :deep(p){max-width:none!important;margin:9px 0!important;color:#334155!important;font-size:15px!important;line-height:1.95!important}
.sc-consent-body :deep(ul){max-width:none!important;margin:10px 0 18px!important;padding:0 0 0 22px!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;list-style:disc outside!important}
.sc-consent-body :deep(li){display:list-item!important;margin:6px 0!important;padding-left:2px!important;color:#334155!important;font-size:15px!important;line-height:1.85!important}
.sc-consent-body :deep(li::marker){color:#2563eb;font-size:.9em}
@keyframes sc-spin{to{transform:rotate(360deg)}}
.sc-chat-scroll{flex:1;min-height:0;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:18px}
.sc-load-earlier,.sc-state{align-self:center;border:1px dashed rgba(37,99,235,.25);border-radius:999px;background:rgba(255,255,255,.72);color:#2563eb;padding:7px 14px;font-size:11px;font-weight:800}
.sc-state{border-color:rgba(148,163,184,.28);color:#64748b}
.sc-new-messages{position:absolute;left:50%;bottom:164px;z-index:8;transform:translateX(-50%);height:34px;padding:0 16px;border:1px solid rgba(37,99,235,.2);border-radius:999px;background:rgba(255,255,255,.92);color:#2563eb;box-shadow:0 14px 34px rgba(37,99,235,.16);font-size:12px;font-weight:900;cursor:pointer;backdrop-filter:blur(14px)}
.sc-new-messages:hover{background:#eff6ff}
.sc-history-messages{position:absolute;left:50%;top:70px;z-index:8;transform:translateX(-50%);height:34px;padding:0 16px;border:1px solid rgba(37,99,235,.2);border-radius:999px;background:rgba(255,255,255,.92);color:#2563eb;box-shadow:0 14px 34px rgba(37,99,235,.16);font-size:12px;font-weight:900;cursor:pointer;backdrop-filter:blur(14px)}
.sc-history-messages:hover{background:#eff6ff}
.sc-history-messages:disabled{cursor:wait;opacity:.72}
.sc-read-marker{align-self:center;margin:2px auto;padding:0;border:0;background:transparent;color:#94a3b8;font-size:11px;font-weight:900;line-height:1.6;text-align:center}
.sc-message-row{display:flex;align-items:flex-start;gap:12px}
.sc-message-row.is-own{flex-direction:row-reverse}
.sc-message-row.is-retracted{justify-content:center}
.sc-message-row.is-highlighted .sc-bubble,.sc-message-row.is-highlighted .sc-sticker-bubble{animation:scMentionFocus 2.4s ease-out;border-color:rgba(37,99,235,.38);box-shadow:0 0 0 3px rgba(37,99,235,.14),0 16px 36px rgba(37,99,235,.16)}
.sc-retract-notice{margin:2px auto;padding:0;border:0;background:transparent;color:#94a3b8;font-size:11px;font-weight:800;line-height:1.6;text-align:center}
.sc-avatar,.sc-member-avatar,.sc-profile-avatar{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:999px;border:1px solid rgba(15,23,42,.08);background:#f1f5f9;color:#2563eb;font-size:13px;font-weight:900;overflow:hidden}
.sc-avatar{width:40px;height:40px;cursor:pointer}
.sc-avatar-image{position:relative;z-index:1;width:100%;height:100%;border-radius:999px;object-fit:cover}
.sc-avatar-fallback{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:999px}
.sc-avatar.has-checkin-frame,.sc-member-avatar.has-checkin-frame,.sc-profile-avatar.has-checkin-frame{position:relative;overflow:visible;border:0;background:transparent}
.sc-checkin-frame{position:absolute!important;top:50%;left:50%;z-index:2;display:block;width:156.25%!important;height:156.25%!important;max-width:none!important;max-height:none!important;object-fit:contain!important;transform:translate(-50%,-50%);pointer-events:none}
.sc-avatar .sc-checkin-frame{width:175%!important;height:175%!important}
.sc-checkin-title{display:inline-flex;align-items:center;width:max-content;padding:2px 6px;border:1px solid rgba(99,102,241,.16);border-radius:999px;background:rgba(238,242,255,.86);color:#6366f1;font-size:9px;font-style:normal;font-weight:900;line-height:1.2;white-space:nowrap}
.sc-message-body{display:flex;flex-direction:column;align-items:flex-start;max-width:min(72%,720px)}
.sc-message-row.is-own .sc-message-body{align-items:flex-end}
.sc-message-meta{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:#94a3b8;font-size:11px}
.sc-message-meta button{border:0;background:transparent;color:#334155;font:inherit;font-weight:900;cursor:pointer}
.sc-message-row.is-own .sc-message-meta button{color:#2563eb}
.sc-message-content{display:flex;align-items:center;gap:8px;max-width:100%}
.sc-message-row:not(.is-own) .sc-message-content{flex-direction:row-reverse}
.sc-delivery-state{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:18px!important;min-width:18px!important;height:18px!important;padding:0!important;border-radius:999px!important;box-shadow:none!important}
.sc-delivery-state.is-sending{box-sizing:border-box;border:2px solid rgba(100,116,139,.28);border-top-color:#64748b;animation:sc-spin .8s linear infinite}
.sc-delivery-state.is-failed{border:0!important;background:#ef4444!important;color:#fff!important;font-size:12px!important;font-weight:950!important;line-height:1!important;cursor:pointer}
.sc-delivery-state.is-failed:hover{background:#dc2626!important;transform:scale(1.06)}
.sc-bubble{margin:0;padding:11px 14px;border:1px solid rgba(15,23,42,.06);border-radius:16px;border-top-left-radius:3px;background:rgba(255,255,255,.9);color:#334155;box-shadow:0 8px 24px rgba(15,23,42,.05);font-size:13px;line-height:1.75;white-space:pre-wrap;word-break:break-word}
.sc-bubble p{margin:0}
.sc-quote-block{display:grid;gap:2px;margin:0 0 9px;padding:0 0 0 10px;border-left:3px solid rgba(37,99,235,.48);white-space:normal}
.sc-quote-block strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155;font-size:12px;font-weight:950;line-height:1.45}
.sc-quote-block span{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:#64748b;font-size:12px;line-height:1.55}
.sc-message-row.is-own .sc-bubble{border-top-left-radius:16px;border-top-right-radius:3px;border-color:rgba(37,99,235,.18);background:#eff6ff}
.sc-sticker-bubble{display:inline-flex;align-items:center;justify-content:center;max-width:180px;max-height:180px;padding:8px;border:1px solid rgba(15,23,42,.06);border-radius:18px;border-top-left-radius:3px;background:rgba(255,255,255,.9);box-shadow:0 8px 24px rgba(15,23,42,.05)}
.sc-message-row.is-own .sc-sticker-bubble{border-top-left-radius:18px;border-top-right-radius:3px;border-color:rgba(37,99,235,.18);background:#eff6ff}
.sc-sticker-bubble img{display:block;max-width:160px;max-height:160px;object-fit:contain;border-radius:12px}
.sc-report{margin-top:4px;border:0;background:transparent;color:#94a3b8;font-size:10px;cursor:pointer}
.sc-report:hover{color:#e11d48}
.sc-expired-retract{margin-top:4px;color:#cbd5e1;font-size:10px;font-weight:800}
.sc-composer{position:relative;z-index:20;flex-shrink:0;display:flex;flex-direction:column;min-height:168px;padding:0 10px 10px;border-top:0;background:rgba(255,255,255,.78);backdrop-filter:blur(18px)}
.sc-composer-tools{display:flex;align-items:center;gap:14px;height:38px;padding:6px 20px 0}
.sc-reply-draft{position:relative;display:grid;gap:2px;margin:10px 12px 0;padding:8px 34px 8px 12px;border:1px solid rgba(37,99,235,.12);border-radius:12px;background:rgba(239,246,255,.86);color:#475569;font-size:12px;font-weight:800}
.sc-reply-draft strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155;font-size:12px;font-weight:950;line-height:1.45}
.sc-reply-draft span{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:12px;line-height:1.55}
.sc-reply-draft button{position:absolute;right:8px;top:8px;display:inline-flex;align-items:center;justify-content:center;width:18px!important;min-width:18px!important;height:18px!important;padding:0!important;border:1px solid rgba(37,99,235,.16)!important;border-radius:999px!important;background:#fff!important;color:#64748b!important;box-shadow:none!important;font-size:13px!important;font-weight:900!important;line-height:1;cursor:pointer}
.sc-reply-draft button:hover{color:#2563eb!important;background:#dbeafe!important}
.sc-input-card{position:relative;flex:1;min-height:116px;display:flex;flex-direction:column;overflow:visible;border:1px solid rgba(37,99,235,.12);border-radius:18px;background:rgba(255,255,255,.92);box-shadow:inset 0 1px 0 rgba(255,255,255,.85),0 14px 34px rgba(15,23,42,.06)}
.sc-composer textarea{flex:1;min-height:78px;resize:none;border:0;outline:none;background:transparent;color:#0f172a;padding:14px 16px 8px;font-size:14px;line-height:1.7}
.sc-composer textarea:disabled{cursor:not-allowed;color:#94a3b8}
.sc-composer textarea:disabled::placeholder{color:#be123c}
.sc-composer footer{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:8px 12px 12px;border-top:0}
.sc-composer footer span{color:#94a3b8;font-size:11px}
.sc-composer button,.sc-modal-actions button{min-width:86px;height:34px;border:1px solid rgba(37,99,235,.28);border-radius:10px;background:#2563eb;color:#fff;font-size:12px;font-weight:900;cursor:pointer}
.sc-composer-tools .sc-emoji-button{display:inline-flex;align-items:center;justify-content:center;min-width:28px!important;width:28px;height:28px!important;padding:0!important;border:0!important;border-radius:8px;background:transparent!important;color:#64748b!important}
.sc-composer-tools .sc-emoji-button svg{width:17px;height:17px}
.sc-emoji-button{min-width:64px!important;height:34px!important;border-color:rgba(15,23,42,.08)!important;background:#fff!important;color:#475569!important}
.sc-emoji-button:hover{background:#eff6ff!important;color:#2563eb!important}
.sc-emoji-panel{--emoji-arrow-center:14px;position:absolute;left:20px;right:20px;bottom:calc(100% + 12px);z-index:35;width:auto;display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid rgba(37,99,235,.12);border-radius:18px;background:rgba(255,255,255,.97);box-shadow:0 18px 44px rgba(15,23,42,.16);backdrop-filter:blur(14px)}
.sc-emoji-panel::after{content:"";position:absolute;left:var(--emoji-arrow-center);bottom:-7px;width:14px;height:14px;transform:translateX(-50%) rotate(45deg);transform-origin:center;border-right:1px solid rgba(37,99,235,.12);border-bottom:1px solid rgba(37,99,235,.12);background:rgba(255,255,255,.97)}
.sc-emoji-tabs{position:relative;z-index:1;display:flex;align-items:center;gap:6px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
.sc-emoji-tabs::-webkit-scrollbar{display:none}
.sc-emoji-tabs button{width:auto!important;min-width:auto!important;height:26px!important;padding:0 10px!important;border:1px solid rgba(37,99,235,.12)!important;border-radius:999px!important;background:#fff!important;color:#64748b!important;box-shadow:none!important;font-size:11px!important;font-weight:900!important;white-space:nowrap}
.sc-emoji-tabs button.active{background:#eff6ff!important;color:#2563eb!important;border-color:rgba(37,99,235,.22)!important}
.sc-emoji-tabs .sc-sticker-edit{margin-left:auto!important;min-width:54px!important;background:#eff6ff!important;color:#2563eb!important;border-color:rgba(37,99,235,.16)!important}
.sc-emoji-scroll{position:relative;z-index:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(34px,1fr));grid-auto-rows:34px;gap:8px;max-height:76px;overflow-y:auto;overflow-x:hidden;padding:2px 2px 4px;scrollbar-width:none}
.sc-emoji-scroll::-webkit-scrollbar{display:none}
.sc-emoji-scroll button{display:inline-flex;align-items:center;justify-content:center;justify-self:center;min-width:34px!important;width:34px;height:34px;border:1px solid rgba(15,23,42,.06)!important;border-radius:999px;background:linear-gradient(135deg,#fff,#f8fafc)!important;color:#0f172a!important;box-shadow:0 8px 18px rgba(15,23,42,.06);font-size:18px!important;line-height:1;cursor:pointer}
.sc-emoji-scroll button:hover{background:#eff6ff!important;border-color:rgba(37,99,235,.18)!important;transform:translateY(-1px)}
.sc-sticker-grid{position:relative;z-index:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));grid-auto-rows:56px;gap:8px;max-height:120px;overflow-y:auto;overflow-x:hidden;padding:2px;scrollbar-width:none}
.sc-sticker-grid::-webkit-scrollbar{display:none}
.sc-sticker-item{position:relative;min-width:0;min-height:0}
.sc-sticker-item>button:first-child{display:flex;align-items:center;justify-content:center;width:100%!important;min-width:0!important;height:56px!important;padding:5px!important;border:1px solid rgba(15,23,42,.07)!important;border-radius:16px!important;background:#fff!important;box-shadow:0 8px 18px rgba(15,23,42,.06)!important}
.sc-sticker-item>button:first-child:disabled{opacity:1;cursor:default}
.sc-sticker-item img{display:block;max-width:46px;max-height:46px;object-fit:contain;border-radius:10px}
.sc-sticker-delete{position:absolute;right:-4px;top:-4px;width:auto!important;min-width:28px!important;height:18px!important;padding:0 5px!important;border:1px solid rgba(225,29,72,.18)!important;border-radius:999px!important;background:#fff1f2!important;color:#e11d48!important;box-shadow:none!important;font-size:9px!important;font-weight:900!important}
.sc-sticker-upload{display:flex!important;align-items:center!important;justify-content:center!important;width:100%!important;min-width:0!important;height:56px!important;padding:0!important;border:1px dashed rgba(37,99,235,.38)!important;border-radius:16px!important;background:rgba(239,246,255,.52)!important;color:#2563eb!important;box-shadow:none!important;font-size:24px!important;font-weight:800!important;line-height:1!important}
.sc-sticker-upload:hover{background:#eff6ff!important;border-color:rgba(37,99,235,.58)!important}
.sc-sticker-input{display:none}
.sc-send-button{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px;flex-shrink:0;min-width:112px!important;width:112px;height:32px!important;padding:0 12px!important;border:1px solid rgba(2,132,199,.4)!important;border-radius:6px!important;background:rgba(2,132,199,.05)!important;color:#0284c7!important;box-shadow:none;font-family:"JetBrains Mono","SFMono-Regular",Consolas,monospace;font-size:12px!important;font-weight:700!important;letter-spacing:.12em;transition:background .3s ease,border-color .3s ease,box-shadow .3s ease,color .3s ease,transform .18s ease}
.sc-send-button svg{width:13px;height:13px;transition:transform .18s ease}
.sc-send-button svg.is-sending{animation:sc-send-pulse 1s ease-in-out infinite}
.sc-send-button:not(:disabled):hover{border-color:#0284c7!important;background:rgba(2,132,199,.15)!important;box-shadow:0 0 10px rgba(6,182,212,.15)}
.sc-send-button:not(:disabled):active{transform:scale(.98)}
.sc-send-button:not(:disabled):hover svg{transform:translateX(1px) translateY(-1px)}
.sc-send-button:disabled{border-color:rgba(148,163,184,.45)!important;background:transparent!important;color:#94a3b8!important;box-shadow:none}
@keyframes sc-send-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.sc-composer button:disabled,.sc-modal-actions button:disabled{opacity:.42;cursor:not-allowed}
.sc-mention-panel{position:absolute;left:12px;right:12px;bottom:calc(100% + 8px);z-index:42;display:flex;flex-direction:column;gap:8px;max-height:236px;overflow-y:auto;padding:10px;border:1px solid rgba(37,99,235,.14);border-radius:16px;background:rgba(255,255,255,.98);box-shadow:0 18px 44px rgba(15,23,42,.16);backdrop-filter:blur(14px);scrollbar-width:none}
.sc-mention-panel::-webkit-scrollbar{display:none}
.sc-mention-panel button{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:9px;width:100%!important;min-width:0!important;height:auto!important;padding:8px!important;border:1px solid rgba(15,23,42,.06)!important;border-radius:12px!important;background:#f8fafc!important;color:#0f172a!important;text-align:left!important;box-shadow:none!important}
.sc-mention-panel button:hover{border-color:rgba(37,99,235,.22)!important;background:#eff6ff!important}
.sc-mention-avatar{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:30px;height:30px;border-radius:999px;border:1px solid rgba(37,99,235,.12);background:#eef6ff;color:#2563eb;font-size:12px;font-weight:900;overflow:hidden}
.sc-mention-avatar img{width:100%;height:100%;object-fit:cover}
.sc-mention-panel button>span:last-child{min-width:0;display:flex;flex-direction:column;gap:3px}
.sc-mention-panel strong,.sc-mention-panel em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-mention-panel strong{font-size:12px;font-weight:900}
.sc-mention-panel em{color:#64748b;font-size:10px;font-style:normal;font-weight:800}
.sc-mention-context,.sc-quote-context{position:absolute;z-index:240;width:max-content;padding:4px;border:1px solid rgba(15,23,42,.08);border-radius:9px;background:#fff;box-shadow:0 16px 36px rgba(15,23,42,.16)}
.sc-mention-context button,.sc-quote-context button{display:inline-flex;align-items:center;justify-content:center;width:auto;min-width:0;height:26px;padding:0 8px;border:0;border-radius:6px;background:#eff6ff;color:#2563eb;font-size:12px;font-weight:900;white-space:nowrap;cursor:pointer}
.sc-mention-context button:hover,.sc-quote-context button:hover{background:#dbeafe}
@keyframes scMentionFocus{0%{transform:translateY(-1px);box-shadow:0 0 0 5px rgba(37,99,235,.2),0 18px 42px rgba(37,99,235,.2)}100%{transform:translateY(0);box-shadow:0 0 0 0 rgba(37,99,235,0),0 10px 26px rgba(15,23,42,.08)}}
.sc-drawer-toggle{position:relative;z-index:18;align-self:center;width:28px;height:76px;margin:auto -14px;border:1px solid rgba(37,99,235,.14);border-radius:999px;background:rgba(255,255,255,.94);color:#2563eb;box-shadow:0 12px 28px rgba(15,23,42,.1);font-size:14px;font-weight:950;cursor:pointer}
.sc-drawer-toggle span{font-size:0}
.sc-drawer-toggle span::after{content:">";font-size:16px;line-height:1}
.sc-drawer-toggle.is-collapsed span::after{content:"<"}
.sc-drawer-toggle:hover{background:#eff6ff;transform:translateY(-1px)}
.sc-drawer-toggle em,.sc-head-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 5px;border-radius:999px;background:#ef4444;color:#fff;font-size:10px;font-style:normal;font-weight:950;line-height:1}
.sc-drawer-toggle em{position:absolute;right:-6px;top:8px;writing-mode:horizontal-tb;letter-spacing:0}
.sc-head-badge{margin-left:6px;vertical-align:middle}
.sc-drawer{width:320px;display:flex;flex-direction:column;border-left:0;border-radius:0 22px 22px 0;background:rgba(248,250,252,.82);backdrop-filter:blur(18px);box-shadow:inset 18px 0 26px -30px rgba(15,23,42,.2);overflow:hidden}
.sc-drawer-head{position:relative;height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:0;border-top-right-radius:22px;background:rgba(248,250,252,.82);box-shadow:0 10px 26px rgba(15,23,42,.025)}
.sc-drawer-head strong{color:#2563eb;font-size:12px;font-weight:900}
.sc-drawer-head span{color:#64748b;font-size:11px}
.sc-search-toggle{height:30px;border:1px solid rgba(37,99,235,.18);border-radius:999px;background:#fff;color:#2563eb;padding:0 12px;font-size:11px;font-weight:900;cursor:pointer}
.sc-search{position:absolute;inset:9px 12px;display:flex;align-items:center;gap:8px;padding:0;border-radius:999px;background:#fff;box-shadow:0 10px 24px rgba(15,23,42,.08)}
.sc-search input{flex:1;width:100%;height:38px;box-sizing:border-box;border:0;background:transparent;color:#0f172a;padding:0 12px;outline:none;font-size:12px}
.sc-search button{height:28px;border:0;background:transparent;color:#64748b;padding:0 10px;font-size:11px;font-weight:900;cursor:pointer}
.sc-member-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:12px 14px 14px}
.sc-member-card{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:1px solid rgba(15,23,42,.06);border-radius:10px;background:rgba(255,255,255,.86);text-align:left;cursor:pointer}
.sc-member-card:hover{border-color:rgba(37,99,235,.24);background:#eff6ff}
.sc-member-avatar{width:32px;height:32px}
.sc-member-card span:last-child{min-width:0;display:flex;flex-direction:column;gap:4px}
.sc-member-card strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1e293b;font-size:12px}
.sc-member-card em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:10px;font-style:normal}
.sc-member-more{min-height:48px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;color:#94a3b8;flex-shrink:0}
.sc-member-more strong{font-size:11px;font-weight:800}
.sc-member-more-spinner{width:20px;height:20px;box-sizing:border-box;border:2px solid rgba(37,99,235,.16);border-top-color:#2563eb;border-radius:999px;animation:sc-spin .82s linear infinite}
.sc-more-members{height:34px;border:1px dashed rgba(37,99,235,.25);border-radius:10px;background:transparent;color:#2563eb;font-size:11px;font-weight:800;cursor:pointer}
.sc-toast{position:absolute;left:50%;bottom:170px;z-index:30;transform:translateX(-50%);padding:9px 14px;border:1px solid rgba(15,23,42,.08);border-radius:999px;background:#fff;color:#334155;box-shadow:0 18px 36px rgba(15,23,42,.14);font-size:12px;font-weight:800}
.sc-toast.is-success{color:#059669}.sc-toast.is-error{color:#e11d48}
.sc-modal-root{position:absolute;left:50%;top:50%;z-index:120;width:min(780px,calc(100% - 48px));height:430px;max-height:calc(100% - 48px);transform:translate(-50%,-50%);pointer-events:none}
.sc-modal-card{position:relative;box-sizing:border-box;height:100%;overflow-y:auto;padding:22px;border:1px solid rgba(15,23,42,.08);border-radius:18px;background:rgba(255,255,255,.96);box-shadow:0 24px 70px rgba(15,23,42,.22);pointer-events:auto}
.sc-modal-close{position:absolute;right:14px;top:14px;width:28px;height:28px;border:1px solid rgba(15,23,42,.08);border-radius:999px;background:#f8fafc;color:#64748b;cursor:pointer}
.sc-modal-loading{display:flex;height:100%;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#2563eb}
.sc-modal-loading span{width:30px;height:30px;border:3px solid rgba(37,99,235,.16);border-top-color:#2563eb;border-radius:999px;animation:sc-spin .82s linear infinite}
.sc-modal-loading strong{font-size:12px;font-weight:900}
.sc-profile-head{display:flex;align-items:center;gap:14px;padding-right:36px}
.sc-profile-avatar{width:56px;height:56px;font-size:20px}
.sc-profile-head h3{margin:0 0 4px;color:#0f172a;font-size:16px;font-weight:900}
.sc-profile-head span{color:#64748b;font-size:11px;font-weight:800}
.sc-profile-head a{color:#2563eb;font-size:12px;text-decoration:none;word-break:break-all}
.sc-profile-desc{margin:18px 0;color:#475569;font-size:13px;line-height:1.75}
.sc-profile-facts{display:flex;flex-direction:column;gap:8px;margin:18px 0 0}
.sc-profile-facts div{display:grid;grid-template-columns:58px minmax(0,1fr);gap:12px;align-items:start;padding:7px 10px;border-radius:12px;background:rgba(248,250,252,.72)}
.sc-profile-facts dt{color:#64748b;font-size:12px;font-weight:900;letter-spacing:.02em}
.sc-profile-facts dd{margin:0;color:#172033;font-size:12px;font-weight:900;line-height:1.7;word-break:break-word}
.sc-profile-facts div:nth-child(3) dd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-profile-facts a{color:#2563eb;text-decoration:none}
.sc-profile-metrics{display:none}
.sc-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0}
.sc-profile-grid div{padding:10px;border:1px solid rgba(15,23,42,.06);border-radius:12px;background:#f8fafc}
.sc-profile-grid dt{color:#64748b;font-size:11px;font-weight:800}
.sc-profile-grid dd{margin:5px 0 0;color:#0f172a;font-size:12px;word-break:break-word}
.sc-modal-layout{display:grid;height:100%;grid-template-columns:minmax(0,1fr) 280px;align-items:stretch;gap:24px;margin-top:0}
.sc-profile-main{min-width:0;display:flex;min-height:100%;flex-direction:column}
.sc-posts{display:flex;height:100%;min-height:100%;max-height:100%;overflow-y:auto;flex-direction:column;gap:12px;margin-top:0;padding:0;border:0;background:transparent}
.sc-posts strong{color:#64748b;font-size:11px;font-weight:900}
.sc-posts a{display:flex;flex-direction:column;gap:5px;padding:10px 12px;border:1px solid rgba(15,23,42,.06);border-radius:12px;background:rgba(248,250,252,.86);color:#334155;text-decoration:none;font-size:12px}
.sc-posts a:hover{border-color:rgba(37,99,235,.18);background:#eff6ff}
.sc-posts a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:900}
.sc-posts time,.sc-posts em{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:#94a3b8;font-size:10px;font-style:normal;line-height:1.6}
.sc-assistant-card{display:flex;height:100%;min-height:100%;flex-direction:column;gap:10px;padding:0}
.sc-assistant-card strong{color:#64748b;font-size:11px;font-weight:900}
.sc-assistant-card span{display:block;padding:11px 12px;border:1px solid rgba(37,99,235,.1);border-radius:12px;background:rgba(239,246,255,.72);color:#334155;font-size:12px;font-weight:800;line-height:1.65}
.sc-modal-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:auto;padding-top:22px}
.sc-modal-actions button:first-child{border-color:rgba(15,23,42,.08);background:#f8fafc;color:#475569}
.sc-chat-scroll::-webkit-scrollbar,.sc-member-list::-webkit-scrollbar,.sc-modal-card::-webkit-scrollbar,.sc-posts::-webkit-scrollbar{display:none}
.sc-chat-scroll,.sc-member-list,.sc-modal-card,.sc-posts{scrollbar-width:none}
@media (max-width:860px){.sc-drawer,.sc-drawer-toggle{display:none}.sc-message-body{max-width:82%}.sc-modal-layout{grid-template-columns:1fr}.sc-posts{max-height:240px;overflow-y:auto}}
@media (max-width:640px){
  .sc-shell{border-radius:14px;clip-path:inset(0 round 14px)}
  .sc-chat{border-radius:14px}
  .sc-chat-head{height:42px;padding:0 10px}
  .sc-chat-head div{gap:1px}
  .sc-chat-head strong{font-size:10px}
  .sc-chat-head span{font-size:8px}
  .sc-chat-refresh{gap:4px;height:24px;padding:0 8px;font-size:8px}
  .sc-chat-refresh span{width:9px;height:9px;border-width:1px}
  .sc-chat-loading{gap:7px}
  .sc-chat-loading span{width:20px;height:20px;border-width:2px}
  .sc-chat-loading strong{font-size:8px}
  .sc-chat-scroll{padding:10px 8px;gap:10px}
  .sc-load-earlier,.sc-state{padding:4px 8px;font-size:8px}
  .sc-new-messages{bottom:108px;height:25px;padding:0 9px;font-size:8px}
  .sc-history-messages{top:48px;height:25px;padding:0 9px;font-size:8px}
  .sc-read-marker,.sc-retract-notice{font-size:8px}
  .sc-message-row{gap:6px}
  .sc-avatar{width:28px;height:28px;font-size:9px}
  .sc-checkin-title{padding:1px 4px;font-size:7px}
  .sc-message-body{max-width:86%}
  .sc-message-meta{gap:4px;margin-bottom:3px;font-size:8px}
  .sc-message-content{gap:4px}
  .sc-delivery-state{width:13px!important;min-width:13px!important;height:13px!important}
  .sc-delivery-state.is-sending{border-width:1px}
  .sc-delivery-state.is-failed{font-size:8px!important}
  .sc-bubble{padding:6px 8px;border-radius:10px;border-top-left-radius:2px;font-size:9px;line-height:1.5}
  .sc-message-row.is-own .sc-bubble{border-top-left-radius:10px;border-top-right-radius:2px}
  .sc-quote-block{gap:1px;margin-bottom:5px;padding-left:6px;border-left-width:2px}
  .sc-quote-block strong,.sc-quote-block span{font-size:8px}
  .sc-sticker-bubble{max-width:118px;max-height:118px;padding:5px;border-radius:11px;border-top-left-radius:2px}
  .sc-message-row.is-own .sc-sticker-bubble{border-top-left-radius:11px;border-top-right-radius:2px}
  .sc-sticker-bubble img{max-width:108px;max-height:108px;border-radius:8px}
  .sc-report,.sc-expired-retract{margin-top:2px;font-size:7px}
  .sc-composer{min-height:110px;padding:0 6px 6px}
  .sc-composer-tools{height:28px;padding:3px 8px 0}
  .sc-composer-tools .sc-emoji-button{min-width:22px!important;width:22px;height:22px!important;border-radius:6px}
  .sc-composer-tools .sc-emoji-button svg{width:13px;height:13px}
  .sc-input-card{min-height:76px;border-radius:11px}
  .sc-composer textarea{min-height:46px;padding:8px 9px 4px;font-size:10px;line-height:1.5}
  .sc-composer footer{gap:6px;padding:4px 6px 6px}
  .sc-composer footer span{font-size:7px}
  .sc-send-button{min-width:78px!important;width:78px;height:25px!important;padding:0 7px!important;border-radius:5px!important;font-size:8px!important;letter-spacing:.06em}
  .sc-send-button svg{width:10px;height:10px}
  .sc-reply-draft{gap:1px;margin:5px 6px 0;padding:5px 24px 5px 7px;border-radius:7px;font-size:8px}
  .sc-reply-draft strong,.sc-reply-draft span{font-size:8px}
  .sc-reply-draft button{right:5px;top:5px;width:14px!important;min-width:14px!important;height:14px!important;font-size:9px!important}
  .sc-emoji-panel{left:8px;right:8px;bottom:calc(100% + 7px);gap:6px;padding:7px;border-radius:11px}
  .sc-emoji-tabs{gap:3px}
  .sc-emoji-tabs button{height:21px!important;padding:0 6px!important;font-size:8px!important}
  .sc-emoji-scroll{grid-template-columns:repeat(auto-fill,minmax(27px,1fr));grid-auto-rows:27px;gap:4px;max-height:58px}
  .sc-emoji-scroll button{min-width:27px!important;width:27px;height:27px;font-size:14px!important}
  .sc-mention-panel{left:6px;right:6px;bottom:calc(100% + 5px);gap:4px;max-height:166px;padding:6px;border-radius:10px}
  .sc-mention-panel button{gap:5px;padding:5px!important;border-radius:7px!important}
  .sc-mention-avatar{width:22px;height:22px;font-size:8px}
  .sc-mention-panel button>span:last-child{gap:1px}
  .sc-mention-panel strong{font-size:8px}
  .sc-mention-panel em{font-size:7px}
  .sc-modal-root{width:min(248px,calc(100% - 20px));height:min(250px,calc(100% - 24px));max-height:calc(100% - 24px)}
  .sc-modal-card{padding:8px;border-radius:9px}
  .sc-modal-close{right:6px;top:6px;width:19px;height:19px;font-size:9px}
  .sc-modal-layout{display:flex;height:auto;min-height:0;flex-direction:column;gap:6px}
  .sc-profile-main{min-height:0}
  .sc-modal-loading{gap:6px}
  .sc-modal-loading span{width:20px;height:20px;border-width:2px}
  .sc-modal-loading strong{font-size:8px}
  .sc-profile-head{gap:6px;padding-right:22px}
  .sc-profile-avatar{width:31px;height:31px;font-size:11px}
  .sc-profile-head h3{margin-bottom:1px;font-size:9px}
  .sc-profile-head span,.sc-profile-head a,.sc-checkin-title{font-size:7px}
  .sc-profile-facts{gap:3px;margin-top:7px}
  .sc-profile-facts div{grid-template-columns:31px minmax(0,1fr);gap:4px;padding:4px 5px;border-radius:6px}
  .sc-profile-facts dt,.sc-profile-facts dd{font-size:7px;line-height:1.35}
  .sc-modal-actions{gap:5px;padding-top:7px}
  .sc-modal-actions button{min-width:0;height:23px;border-radius:6px;font-size:7px}
  .sc-posts,.sc-assistant-card{gap:4px;max-height:68px;min-height:0}
  .sc-posts strong,.sc-assistant-card strong{font-size:7px}
  .sc-posts a,.sc-assistant-card span{gap:1px;padding:4px 5px;border-radius:6px;font-size:7px;line-height:1.25}
  .sc-posts time,.sc-posts em{font-size:6px;line-height:1.25}
  .sc-consent-card header{gap:4px!important;padding:14px 16px 5px!important}
  .sc-consent-card header span::before{font-size:9px!important}
  .sc-consent-card header strong{font-size:15px!important;line-height:1.3!important}
  .sc-consent-body{padding:6px 16px 12px!important}
  .sc-consent-body :deep(h2){margin:14px 0 6px!important;font-size:12px!important}
  .sc-consent-body :deep(h3){margin:10px 0 4px!important;font-size:10px!important}
  .sc-consent-body :deep(p){margin:5px 0!important;font-size:9px!important;line-height:1.55!important}
  .sc-consent-body :deep(ul){margin:5px 0 9px!important;padding-left:15px!important}
  .sc-consent-body :deep(li){margin:3px 0!important;font-size:9px!important;line-height:1.5!important}
  .sc-consent-card footer{padding:6px 16px 12px!important}
  .sc-consent-card footer>.sc-consent-status.is-readable{font-size:8px!important;line-height:1.4!important}
  .sc-consent-card footer button{height:29px!important;min-width:118px!important;border-radius:8px!important}
  .sc-consent-card footer button:not(.is-secondary)::before{font-size:9px!important}
}
</style>
