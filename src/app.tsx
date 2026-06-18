import { useEffect, useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import QRCodeGenerator from "qrcode";
import {
  BadgeCheck,
  Bell,
  ChevronRight,
  CircleCheck,
  Copy,
  CreditCard,
  ExternalLink,
  Gauge,
  Gift,
  HelpCircle,
  Home,
  KeyRound,
  LayoutDashboard,
  LogIn,
  LogOut,
  LockKeyhole,
  QrCode,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trash2,
  UserPlus,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { OrderStatus, ProductKind, type ProductSnapshot } from "./gen/proto/moment/common/v1/common_pb";
import type {
  ListSubscriptionScopesResponse,
  OrderSummary,
  PaymentMethod,
  Plan as PortalPlan,
  SubscriptionScopeNode,
  SubscriptionPresetSummary,
  SupportTicketMessage,
  SubscriptionSummary,
  SupportTicket,
} from "./gen/proto/moment/user/v1/portal_pb";
import {
  createUserSupportTicket,
  createUserOrder,
  deleteUserSubscriptionPreset,
  getUserOrder,
  getUserSubscription,
  getUserSubscriptionLink,
  getUserSupportTicket,
  listUserOrders,
  listUserSubscriptionScopes,
  listUserSupportTickets,
  loadUserPortalDashboard,
  loginUser,
  logoutUser,
  payUserOrderWithBalance,
  registerUser,
  replyUserSupportTicket,
  saveUserSubscriptionPreset,
  startUserOrderPayment,
  type UserPortalDashboard,
} from "./api/userPortal";
import { applyDocumentBranding, portalVariant, runtimeBranding, storeUserAccessToken, userAccessToken } from "./api/runtime";

const usageSeries = [14, 20, 18, 31, 26, 46, 62, 58, 72, 64, 84, 91];
const qrCells = Array.from({ length: 64 }, (_, index) =>
  [0, 1, 2, 8, 16, 9, 18, 5, 6, 13, 21, 27, 30, 33, 38, 42, 46, 51, 54, 57, 60, 63].includes(index) ||
  index % 7 === 0 ||
  index % 11 === 0
);
const checkoutSteps = [
  { title: "会员卡校验", detail: "有效会员才能购买订阅，年卡默认允许订阅超过会员到期 7 天。", icon: <ShieldCheck size={18} /> },
  { title: "生成订单快照", detail: "下单时锁定名称、价格、周期、流量和策略，商品后续修改不污染历史订单。", icon: <ReceiptText size={18} /> },
  { title: "余额支付生效", detail: "余额充足时立即完成支付，会员卡或订阅权益从支付时刻开通。", icon: <Wallet size={18} /> },
];

type PlanCardView = {
  canPurchase?: boolean;
  featured?: boolean;
  kind?: ProductKind;
  meta: string;
  name: string;
  price: string;
  productId?: bigint;
  activeCount?: number;
  activeLimit?: number;
  stockLimit?: number;
  stockUsed?: number;
  tone: string;
  unavailableReason?: string;
};

type ScopeChoice = {
  id: string;
  key: string;
  kind: "all" | "profile" | "preset";
  label: string;
  nodeCount: number;
  tone: "blue" | "green" | "amber" | "violet";
};

type PageGuideStep = {
  detail: string;
  label: string;
  state: "done" | "active" | "next";
};

type PageGuideView = {
  body: string;
  eyebrow: string;
  primaryIcon: ReactNode;
  primaryText: string;
  secondaryIcon: ReactNode;
  secondaryText: string;
  steps: PageGuideStep[];
  title: string;
  tone?: ScopeChoice["tone"];
};

type SubscriptionUsageView = {
  percent: number;
  remaining: string;
  total: string;
  used: string;
};

type ConnectionOverviewView = {
  body: string;
  highlights: Array<{ detail: string; label: string; value: string }>;
  primaryAction: string;
  secondaryAction: string;
  title: string;
  tone: ScopeChoice["tone"];
};

type ExternalPaymentView = {
  checkoutUrl: string;
  expiredAtUnixMs: bigint;
  provider: string;
  providerTradeNo: string;
  qrcode: string;
  urlscheme: string;
};

type PaymentMethodView = {
  checkoutFlow: string;
  description: string;
  label: string;
  methodKey: string;
  provider: string;
  tone: "blue" | "green" | "amber" | "violet";
};

const fallbackPaymentMethods: PaymentMethodView[] = [
  { methodKey: "balance", provider: "balance", label: "余额支付", description: "余额充足时即时开通权益", checkoutFlow: "balance", tone: "green" },
  { methodKey: "stripe", provider: "stripe", label: "Stripe", description: "银行卡 / Apple Pay", checkoutFlow: "redirect", tone: "blue" },
  { methodKey: "custom", provider: "custom", label: "外部支付", description: "跳转到配置的收银台", checkoutFlow: "redirect", tone: "violet" },
];

type UserRoute = "dashboard" | "auth" | "subscriptions" | "membership" | "plans" | "checkout" | "wallet" | "orders" | "settings" | "support";

const userNavLinks: Array<{ href: string; label: string; route: UserRoute }> = [
  { href: "/", label: "首页", route: "dashboard" },
  { href: "/subscriptions", label: "订阅", route: "subscriptions" },
  { href: "/membership", label: "会员卡", route: "membership" },
  { href: "/plans", label: "购买", route: "plans" },
  { href: "/wallet", label: "钱包", route: "wallet" },
  { href: "/orders", label: "订单", route: "orders" },
  { href: "/settings", label: "设置", route: "settings" },
  { href: "/support", label: "帮助", route: "support" },
];

const fallbackScopes: ScopeChoice[] = [
  { id: "all", key: "", kind: "all", label: "全部节点", tone: "blue", nodeCount: 18 },
  { id: "profile:reality-grpc", key: "reality-grpc", kind: "profile", label: "Reality gRPC", tone: "green", nodeCount: 7 },
  { id: "profile:hysteria2", key: "hysteria2", kind: "profile", label: "Hysteria2", tone: "amber", nodeCount: 5 },
  { id: "preset:custom", key: "custom", kind: "preset", label: "我的精选", tone: "violet", nodeCount: 9 },
];

const fallbackPlans: PlanCardView[] = [
  { name: "轻量月付", price: "$9.90", meta: "120 GB · 500 Mbps", tone: "blue", kind: ProductKind.SUBSCRIPTION, canPurchase: true },
  { name: "优质尊享", price: "$19.80", meta: "210 GB · 1 Gbps", tone: "green", kind: ProductKind.SUBSCRIPTION, featured: true, canPurchase: true },
  { name: "年费会员", price: "$59.50", meta: "会员资格 · 12 个月", tone: "amber", kind: ProductKind.MEMBERSHIP, canPurchase: true },
];

export function App() {
  const [route, setRoute] = useState<UserRoute>(() => routeFromPath(window.location.pathname));
  const [routeSubscriptionId, setRouteSubscriptionId] = useState<bigint>(() => subscriptionIdFromPath(window.location.pathname));
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [sessionRevision, setSessionRevision] = useState(0);
  const [hasToken, setHasToken] = useState(() => Boolean(userAccessToken()));
  const [checkoutPlan, setCheckoutPlan] = useState<PlanCardView | undefined>();
  const [checkoutOrder, setCheckoutOrder] = useState<OrderSummary | undefined>();
  const [checkoutStatus, setCheckoutStatus] = useState<"idle" | "creating" | "created" | "paying" | "paid" | "error">("idle");
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutProvider, setCheckoutProvider] = useState("");
  const [externalPayment, setExternalPayment] = useState<ExternalPaymentView | undefined>();
  const [linkState, setLinkState] = useState<{ status: "idle" | "loading" | "copied" | "ready" | "error"; label?: string; url?: string; error?: string }>({ status: "idle" });
  const [selectedScopeId, setSelectedScopeId] = useState("all");
  const [pendingScopeId, setPendingScopeId] = useState("");
  const [presetName, setPresetName] = useState("我的精选");
  const [editingPresetKey, setEditingPresetKey] = useState("");
  const [presetNodeFilter, setPresetNodeFilter] = useState("all");
  const [nodeSearch, setNodeSearch] = useState("");
  const [selectedNodeIds, setSelectedNodeIds] = useState<bigint[]>([]);
  const [presetNodeNames, setPresetNodeNames] = useState<Record<string, string>>({});
  const [presetSelectionCleared, setPresetSelectionCleared] = useState(false);
  const [localPresetOverrides, setLocalPresetOverrides] = useState<SubscriptionPresetSummary[]>([]);
  const [presetState, setPresetState] = useState<{ status: "idle" | "saving" | "deleting" | "saved" | "error"; message?: string }>({ status: "idle" });
  const [orderHistory, setOrderHistory] = useState<OrderSummary[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderSummary | undefined>();
  const [orderPageCursor, setOrderPageCursor] = useState("");
  const [orderPageHasMore, setOrderPageHasMore] = useState(false);
  const [orderLoadState, setOrderLoadState] = useState<{ status: "idle" | "loading" | "error"; message?: string }>({ status: "idle" });
  const [orderDetailState, setOrderDetailState] = useState<{ status: "idle" | "loading" | "ready" | "error"; message?: string }>({ status: "idle" });
  const [subscriptionDetail, setSubscriptionDetail] = useState<SubscriptionSummary | undefined>();
  const [subscriptionDetailState, setSubscriptionDetailState] = useState<{ status: "idle" | "loading" | "ready" | "error"; message?: string }>({ status: "idle" });
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [supportPageCursor, setSupportPageCursor] = useState("");
  const [supportPageHasMore, setSupportPageHasMore] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportCategory, setSupportCategory] = useState("connection");
  const [supportPriority, setSupportPriority] = useState("normal");
  const [supportPriorityTouched, setSupportPriorityTouched] = useState(false);
  const [supportState, setSupportState] = useState<{ status: "idle" | "loading" | "creating" | "error"; message?: string }>({ status: "idle" });
  const [selectedSupportTicket, setSelectedSupportTicket] = useState<SupportTicket | undefined>();
  const [supportMessages, setSupportMessages] = useState<SupportTicketMessage[]>([]);
  const [supportReply, setSupportReply] = useState("");
  const [supportDetailState, setSupportDetailState] = useState<{ status: "idle" | "loading" | "replying" | "error" | "saved"; message?: string }>({ status: "idle" });
  const { data, status, error: dashboardError } = useUserPortalDashboard(sessionRevision);
  const fallbackBranding = useMemo(() => runtimeBranding(), []);
  const branding = data?.publicConfig.branding || fallbackBranding;
  const siteName = branding.displayName || data?.publicConfig.siteDisplayName || "Moment";
  const announcement = data?.publicConfig.announcement;
  const authPolicy = data?.publicConfig.authPolicy || { registrationEnabled: true, passwordMinLength: 8, passwordRequireDigit: true, passwordRequireLetter: true };
  const featureFlags = data?.publicConfig.featureFlags || {
    balancePaymentEnabled: true,
    couponEnabled: true,
    internalPortalEnabled: false,
    inviteEnabled: true,
    membershipEnabled: true,
    membershipRequiredForPurchase: true,
    supportTicketEnabled: true,
  };
  const membershipEnabled = featureFlags.membershipEnabled;
  const supportPolicy = data?.publicConfig.support || defaultSupportPolicyView();
  const visibleNavLinks = useMemo(
    () => userNavLinks.filter((item) => (item.route !== "support" || featureFlags.supportTicketEnabled) && (item.route !== "membership" || membershipEnabled)),
    [featureFlags.supportTicketEnabled, membershipEnabled],
  );
  const primarySubscription = data?.overview?.subscriptions[0] || data?.subscriptions[0];
  const dashboardSubscriptions = useMemo(
    () => uniqueSubscriptionSummaries([...(data?.overview?.subscriptions || []), ...(data?.subscriptions || [])]),
    [data?.overview?.subscriptions, data?.subscriptions],
  );
  const routeMatchedSubscription = useMemo(
    () => dashboardSubscriptions.find((subscription) => routeSubscriptionId > 0n && subscription.id === routeSubscriptionId),
    [dashboardSubscriptions, routeSubscriptionId],
  );
  const activeSubscription = (routeSubscriptionId > 0n ? routeMatchedSubscription || subscriptionDetail : undefined) || primarySubscription;
  const activeSubscriptionId = activeSubscription?.id && activeSubscription.id > 0n ? activeSubscription.id : undefined;
  const activeSubscriptionKey = activeSubscription?.id.toString() || "";
  const initialScopes = data?.primaryScopeSubscriptionId && activeSubscriptionId === data.primaryScopeSubscriptionId ? data.primaryScopes : undefined;

  useEffect(() => {
    applyDocumentBranding(branding, "User");
  }, [branding]);
  const scopes = useSubscriptionScopes(activeSubscriptionId, sessionRevision, initialScopes);
  const backendPresets = useMemo(() => scopes.data?.presets.filter((preset) => preset.enabled) || [], [scopes.data?.presets]);
  const savedPresets = useMemo(() => mergePresetSummaries(backendPresets, localPresetOverrides), [backendPresets, localPresetOverrides]);
  const scopeChoices = useMemo(() => scopeChoicesFromView(scopes.data, savedPresets), [savedPresets, scopes.data]);
  const visibleScopes = scopeChoices.length ? scopeChoices : fallbackScopes;
  const savedEditingScopeId = presetState.status === "saved" && editingPresetKey ? `preset:${editingPresetKey}` : "";
  const effectiveSelectedScopeId = pendingScopeId || savedEditingScopeId || selectedScopeId;
  const activeScope = visibleScopes.find((scope) => scope.id === effectiveSelectedScopeId) || visibleScopes.find((scope) => scope.id === selectedScopeId) || visibleScopes[0];
  const scopeNodes = scopes.data?.nodes || [];
  const activeScopeNodes = useMemo(() => nodesForScope(scopeNodes, activeScope, savedPresets), [activeScope, savedPresets, scopeNodes]);
  const activeScopeNodeSummary = activeScopeNodes.length ? activeScopeNodes.slice(0, 6).map((node) => node.name).join(" · ") : hasToken ? "暂无可用节点" : "登录后按订阅加载节点";
  const presetPickerProfiles = useMemo(
    () => (scopes.data?.profiles || []).map((profile) => ({ ...profile, displayLabel: accessProfileDisplayName(profile.label, profile.profileKey) })),
    [scopes.data?.profiles],
  );
  const presetPickerNodes = useMemo(
    () => (presetNodeFilter === "all" ? scopeNodes : scopeNodes.filter((node) => node.profileKey === presetNodeFilter)),
    [presetNodeFilter, scopeNodes],
  );
  const normalizedNodeSearch = nodeSearch.trim().toLowerCase();
  const presetVisibleNodes = useMemo(
    () => presetPickerNodes.filter((node) => nodeMatchesSearch(node, normalizedNodeSearch)),
    [normalizedNodeSearch, presetPickerNodes],
  );
  const presetNodeGroups = useMemo(() => groupNodesForSubscription(presetVisibleNodes), [presetVisibleNodes]);
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds.map((nodeId) => nodeId.toString())), [selectedNodeIds]);
  const selectedPresetNodes = useMemo(() => {
    const nodeById = new Map(scopeNodes.map((node) => [node.nodeId.toString(), node]));
    return selectedNodeIds
      .map((nodeId) => nodeById.get(nodeId.toString()))
      .filter((node): node is SubscriptionScopeNode => Boolean(node));
  }, [scopeNodes, selectedNodeIds]);
  const scopeNodeNameById = useMemo(() => {
    const values = new Map<string, string>();
    for (const node of scopeNodes) {
      values.set(node.nodeId.toString(), node.name);
    }
    return values;
  }, [scopeNodes]);

  useEffect(() => {
    setSelectedScopeId("all");
    setPendingScopeId("");
    setEditingPresetKey("");
    setPresetName("我的精选");
    setPresetNodeFilter("all");
    setNodeSearch("");
    setSelectedNodeIds([]);
    setPresetSelectionCleared(false);
    setPresetNodeNames({});
    setPresetState({ status: "idle" });
    setLinkState({ status: "idle" });
  }, [activeSubscriptionKey]);

  useEffect(() => {
    if (presetNodeFilter === "all") {
      return;
    }
    if (!presetPickerProfiles.some((profile) => profile.profileKey === presetNodeFilter)) {
      setPresetNodeFilter("all");
    }
  }, [presetNodeFilter, presetPickerProfiles]);

  useEffect(() => {
    if (!localPresetOverrides.length || !scopes.data?.presets.length) {
      return;
    }
    const backendKeys = new Set(scopes.data.presets.map((preset) => preset.presetKey));
    setLocalPresetOverrides((current) => current.filter((preset) => !backendKeys.has(preset.presetKey)));
  }, [localPresetOverrides.length, scopes.data?.presets]);

  const presetNodeItems = useMemo(
    () => selectedNodeIds.map((nodeId, index) => {
      const key = nodeId.toString();
      return {
        displayName: (presetNodeNames[key] || scopeNodeNameById.get(key) || "").trim(),
        nodeId,
        sortOrder: index,
      };
    }),
    [presetNodeNames, scopeNodeNameById, selectedNodeIds],
  );
  const rawUsage = useMemo(() => subscriptionUsage(activeSubscription), [activeSubscription]);
  const plans = useMemo(() => {
    const items = planCards(data?.plans);
    return membershipEnabled ? items : items.filter((plan) => plan.kind !== ProductKind.MEMBERSHIP);
  }, [data?.plans, membershipEnabled]);
  const paymentMethods = useMemo(() => {
    const methods = data ? paymentMethodViews(data.paymentMethods) : fallbackPaymentMethods;
    return featureFlags.balancePaymentEnabled ? methods : methods.filter((method) => method.checkoutFlow !== "balance" && method.provider !== "balance");
  }, [data, featureFlags.balancePaymentEnabled]);
  const membershipPlans = useMemo(() => {
    if (!membershipEnabled) {
      return [];
    }
    const items = plans.filter((plan) => plan.kind === ProductKind.MEMBERSHIP);
    return items.length ? items : fallbackPlans.filter((plan) => plan.kind === ProductKind.MEMBERSHIP);
  }, [membershipEnabled, plans]);
  const visibleCheckoutSteps = useMemo(
    () => membershipEnabled ? checkoutSteps : checkoutSteps.filter((step) => step.title !== "会员卡校验"),
    [membershipEnabled],
  );
  const wallet = data?.overview?.wallet;
  const membership = data?.overview?.membership;
  const hasOverview = Boolean(data?.overview);
  const isAccountSyncing = status === "loading" && hasToken;
  const hasSession = status === "loading" ? hasToken : hasOverview;
  const hasSubscription = Boolean(activeSubscription);
  const usage = isAccountSyncing && !activeSubscription ? { used: "同步中", total: "同步中", remaining: "同步中", percent: 0 } : rawUsage;
  const activeDashboardSubscriptions = useMemo(() => dashboardSubscriptions.filter((subscription) => subscription.status === "active"), [dashboardSubscriptions]);
  const dashboardUsage = useMemo<SubscriptionUsageView>(
    () => isAccountSyncing && !dashboardSubscriptions.length ? { used: "同步中", total: "同步中", remaining: "同步中", percent: 0 } : aggregateSubscriptionUsage(activeDashboardSubscriptions),
    [activeDashboardSubscriptions, dashboardSubscriptions.length, isAccountSyncing],
  );
  const scopeNodeCountText = scopes.status === "loading" && !scopeNodes.length ? "同步中" : scopes.status === "error" ? "失败" : scopeNodes.length ? `${scopeNodes.length}` : "-";
  const activeScopeNodeCountText =
    scopes.status === "loading" && !scopeNodes.length ? "同步中" : scopes.status === "error" ? "失败" : hasSubscription ? `${activeScopeNodes.length}` : "-";
  const scopeEmptyText = scopes.status === "error" ? `节点加载失败：${scopes.error || "请刷新后重试"}` : hasSubscription ? "当前筛选下没有可选择节点。" : "登录并开通订阅后显示可选节点。";
  const presetEditorHint = scopes.status === "loading"
    ? "正在同步可用节点"
    : scopes.status === "error"
      ? "节点加载失败，请稍后刷新。"
      : scopeNodes.length
        ? "保存后生成短链接参数，后续可以继续修改。"
        : "登录并拥有订阅后可保存预设。";
  const savedPresetUnavailableCount = savedPresets.reduce((total, preset) => total + preset.unavailableNodeCount, 0);
  const memberText = membership?.active
    ? membership.badgeText || "会员生效中"
    : status === "loading"
      ? "同步中"
      : hasSession
        ? "会员待开通"
        : "访客预览";
  const subscriptionName = activeSubscription?.name || (isAccountSyncing ? "正在同步订阅" : hasOverview ? "暂无订阅" : "公开套餐预览");
  const expiryText = activeSubscription ? dateText(activeSubscription.expiredAtUnixMs) : "2027/05/20";
  const daysText = activeSubscription ? `${daysUntil(activeSubscription.expiredAtUnixMs)} 天` : "365 天";
  const statusDetail = activeSubscription ? `${expiryText} 到期` : isAccountSyncing ? "正在同步权益" : hasSession ? "暂无有效订阅" : "登录后查看权益";
  const membershipValue = membership?.active ? "有效" : isAccountSyncing ? "同步中" : hasSession ? "待开通" : "待登录";
  const membershipDetail = membership?.active ? `${dateText(membership.expiredAtUnixMs)} 到期` : isAccountSyncing ? "正在同步会员状态" : statusDetail;
  const subscriptionActionText = !hasSession
    ? "登录后生成订阅链接"
    : status === "loading"
      ? "正在同步订阅"
      : hasSubscription
        ? `复制${activeScope.label}订阅链接`
        : "开通订阅后生成链接";
  const connectionOverview = useMemo(
    () => buildConnectionOverview(dashboardSubscriptions, {
      hasSession,
      isAccountSyncing,
    }),
    [dashboardSubscriptions, hasSession, isAccountSyncing],
  );
  const connectionSummary = connectionOverview.body;
  const heroTitle = connectionOverview.title;
  const subscriptionPrimaryCopyText = linkState.status === "loading" ? "生成中..." : linkState.status === "copied" ? "已复制" : hasSubscription ? "复制订阅链接" : isAccountSyncing ? "同步中" : hasSession ? "去购买套餐" : "登录后复制";
  const subscriptionSecondaryCopyText = linkState.status === "ready" ? linkState.label || "已生成" : hasSubscription ? "二维码" : isAccountSyncing ? "请稍候" : hasSession ? "浏览套餐" : "登录后生成";
  const heroView = userRouteHero(route, {
    connectionSummary,
    heroTitle,
    primaryCopyText: route === "dashboard" ? connectionOverview.primaryAction : subscriptionPrimaryCopyText,
    secondaryCopyText: route === "dashboard" ? connectionOverview.secondaryAction : subscriptionSecondaryCopyText,
    scopeTone: route === "dashboard" ? connectionOverview.tone : activeScope.tone,
  });
  const guideView = userRouteGuide(route, {
    activeNodeCount: activeScopeNodes.length,
    activeNodeCountText: hasSubscription ? activeScopeNodeCountText : "-",
    activeScopeLabel: activeScope.label,
    activeScopeTone: activeScope.tone,
    hasSubscription,
    hasToken: hasSession,
    isAccountSyncing,
    membershipEnabled,
    membershipActive: !isAccountSyncing && Boolean(membership?.active),
    orderCount: orderHistory.length,
    savedPresetCount: savedPresets.length,
    subscriptionName,
    walletBalance: isAccountSyncing ? "同步中" : formatMoney(wallet?.balance) || "$0.00",
  });

  useEffect(() => {
    setOrderHistory(visibleOrdersForFeatureFlags(data?.orders || [], membershipEnabled));
    setOrderPageCursor(data?.ordersPage?.nextCursor || "");
    setOrderPageHasMore(Boolean(data?.ordersPage?.hasMore));
    setOrderLoadState({ status: "idle" });
    setSelectedOrder((current) => {
      if (!current) {
        return undefined;
      }
      if (!membershipEnabled && isMembershipOrder(current)) {
        return undefined;
      }
      return visibleOrdersForFeatureFlags(data?.orders || [], membershipEnabled).find((order) => order.orderNo === current.orderNo) || current;
    });
  }, [data?.orders, data?.ordersPage?.hasMore, data?.ordersPage?.nextCursor, membershipEnabled]);

  useEffect(() => {
    setSupportTickets(data?.supportTickets || []);
    setSupportPageCursor(data?.supportTicketsPage?.nextCursor || "");
    setSupportPageHasMore(Boolean(data?.supportTicketsPage?.hasMore));
    setSupportState({ status: "idle" });
    setSelectedSupportTicket((current) => {
      if (!current) {
        return undefined;
      }
      return data?.supportTickets.find((ticket) => ticket.id === current.id) || current;
    });
  }, [data?.supportTickets, data?.supportTicketsPage?.hasMore, data?.supportTicketsPage?.nextCursor]);

  useEffect(() => {
    if (!supportPolicy.categories.some((category) => category.key === supportCategory)) {
      setSupportCategory(supportPolicy.categories[0]?.key || "general");
    }
    if (!supportPriorityTouched) {
      setSupportPriority(supportPolicy.defaultPriority);
      return;
    }
    if (!supportPriorityOptions.some((option) => option.key === supportPriority)) {
      setSupportPriority(supportPolicy.defaultPriority);
      setSupportPriorityTouched(false);
    }
  }, [supportCategory, supportPolicy.categories, supportPolicy.defaultPriority, supportPriority, supportPriorityTouched]);

  useEffect(() => {
    if (pendingScopeId && selectedScopeId === pendingScopeId) {
      return;
    }
    if (!visibleScopes.some((scope) => scope.id === selectedScopeId)) {
      setSelectedScopeId("all");
    }
  }, [pendingScopeId, selectedScopeId, visibleScopes]);

  useEffect(() => {
    if (!pendingScopeId || !visibleScopes.some((scope) => scope.id === pendingScopeId)) {
      return;
    }
    setSelectedScopeId(pendingScopeId);
    setLinkState({ status: "idle" });
  }, [pendingScopeId, visibleScopes]);

  useEffect(() => {
    const targetScopeId = pendingScopeId || (presetState.status === "saved" && editingPresetKey ? `preset:${editingPresetKey}` : "");
    if (!targetScopeId || selectedScopeId === targetScopeId || !visibleScopes.some((scope) => scope.id === targetScopeId)) {
      return;
    }
    setSelectedScopeId(targetScopeId);
    setLinkState({ status: "idle" });
  }, [editingPresetKey, pendingScopeId, presetState.status, selectedScopeId, visibleScopes]);

  useEffect(() => {
    if (!pendingScopeId || !backendPresets.some((preset) => `preset:${preset.presetKey}` === pendingScopeId)) {
      return;
    }
    setPendingScopeId("");
  }, [backendPresets, pendingScopeId]);

  useEffect(() => {
    const activeMobileItem = document.querySelector(".mobile-nav .active");
    activeMobileItem?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [route]);

  useEffect(() => {
    if (!scopeNodes.length || selectedNodeIds.length || presetSelectionCleared) {
      return;
    }
    setSelectedNodeIds(scopeNodes.slice(0, 3).map((node) => node.nodeId));
  }, [presetSelectionCleared, scopeNodes, selectedNodeIds.length]);

  useEffect(() => {
    const syncRoute = () => {
      const nextRoute = routeFromPath(window.location.pathname);
      const canonicalPath = canonicalRoutePath(window.location.pathname);
      if (canonicalPath !== window.location.pathname) {
        window.history.replaceState(
          { route: nextRoute },
          "",
          `${canonicalPath}${window.location.search}${window.location.hash}`,
        );
      }
      setRoute(nextRoute);
      setRouteSubscriptionId(subscriptionIdFromPath(window.location.pathname));
    };
    syncRoute();
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (route !== "subscriptions" || routeSubscriptionId <= 0n) {
      setSubscriptionDetail(undefined);
      setSubscriptionDetailState({ status: "idle" });
      return;
    }
    if (routeMatchedSubscription) {
      setSubscriptionDetail(undefined);
      setSubscriptionDetailState({ status: "ready" });
      return;
    }
    if (!hasToken) {
      setSubscriptionDetail(undefined);
      setSubscriptionDetailState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setSubscriptionDetailState({ status: "loading" });
    getUserSubscription(routeSubscriptionId)
      .then((subscription) => {
        if (!cancelled) {
          setSubscriptionDetail(subscription);
          setSubscriptionDetailState({ status: "ready" });
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setSubscriptionDetail(undefined);
          setSubscriptionDetailState({ status: "error", message: errorMessage(reason) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasToken, route, routeMatchedSubscription, routeSubscriptionId]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    });
  }, [route]);

  const navigateToAuth = (mode: "login" | "register") => {
    setAuthMode(mode);
    setAuthOpen(false);
    setRoute("auth");
    setRouteSubscriptionId(0n);
    if (window.location.pathname !== "/auth") {
      window.history.pushState({ route: "auth", mode }, "", "/auth");
    }
  };
  const navigateTo = (nextRoute: UserRoute) => {
    if (nextRoute === "support" && !featureFlags.supportTicketEnabled) {
      nextRoute = "dashboard";
    }
    if (nextRoute === "membership" && !membershipEnabled) {
      nextRoute = "dashboard";
    }
    setRoute(nextRoute);
    const path = routePath(nextRoute);
    setRouteSubscriptionId(subscriptionIdFromPath(path));
    if (window.location.pathname !== path) {
      window.history.pushState({ route: nextRoute }, "", path);
    }
  };
  const navigateToSubscription = (subscriptionID: bigint) => {
    setRoute("subscriptions");
    setRouteSubscriptionId(subscriptionID);
    const path = `/subscriptions/${subscriptionID.toString()}`;
    if (window.location.pathname !== path) {
      window.history.pushState({ route: "subscriptions", subscriptionID: subscriptionID.toString() }, "", path);
    }
  };
  const handleRouteClick = (event: MouseEvent<HTMLAnchorElement>, nextRoute: UserRoute) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    navigateTo(nextRoute);
  };
  useEffect(() => {
    if (route === "support" && !featureFlags.supportTicketEnabled) {
      navigateTo("dashboard");
    }
    if (route === "membership" && !membershipEnabled) {
      navigateTo("dashboard");
    }
  }, [featureFlags.supportTicketEnabled, membershipEnabled, route]);
  useEffect(() => {
    if (data?.overview && !hasToken) {
      setHasToken(true);
    }
  }, [data, hasToken]);
  useEffect(() => {
    if (hasToken && status === "fallback" && isUserSessionExpiredError(dashboardError)) {
      storeUserAccessToken("");
      setHasToken(false);
    }
  }, [dashboardError, hasToken, status]);
  const refreshDashboard = () => {
    setHasToken(Boolean(userAccessToken()));
    setSessionRevision((value) => value + 1);
  };
  const handleProtectedAction = () => {
    if (!hasSession) {
      navigateToAuth("login");
      return;
    }
    if (hasSubscription) {
      void handleCopySubscriptionLink();
      return;
    }
    if (!hasSubscription) {
      navigateTo("plans");
    }
  };
  const handleHeroPrimary = () => {
    switch (route) {
      case "orders":
      case "wallet":
      case "support":
      case "membership":
      case "settings":
        refreshDashboard();
        document.getElementById(routeSectionId(route))?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      case "checkout":
      case "plans":
        document.getElementById("plans")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      case "subscriptions":
        handleProtectedAction();
        return;
      default:
        if (!hasSession) {
          navigateToAuth("login");
          return;
        }
        navigateTo(hasSubscription ? "subscriptions" : "plans");
    }
  };
  const handleHeroSecondary = () => {
    switch (route) {
      case "orders":
      case "wallet":
      case "membership":
        navigateTo("plans");
        return;
      case "plans":
      case "checkout":
        navigateTo("orders");
        return;
      case "support":
        navigateTo("subscriptions");
        return;
      case "settings":
        navigateTo("support");
        return;
      case "subscriptions":
        handleProtectedAction();
        return;
      default:
        navigateTo(hasSubscription ? "subscriptions" : "plans");
    }
  };
  const handleGuidePrimary = () => {
    switch (route) {
      case "subscriptions":
        handleProtectedAction();
        return;
      case "membership":
        if (!hasSession) {
          navigateToAuth("login");
          return;
        }
        if (membershipPlans[0]) {
          handleChoosePlan(membershipPlans[0]);
          return;
        }
        navigateTo("plans");
        return;
      case "plans":
      case "checkout":
        navigateTo("plans");
        document.getElementById("plans")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      case "wallet":
        navigateTo("orders");
        return;
      case "orders":
        refreshDashboard();
        document.getElementById("orders")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      case "settings":
        if (!hasSession) {
          navigateToAuth("login");
          return;
        }
        navigateTo(featureFlags.supportTicketEnabled ? "support" : "subscriptions");
        return;
      case "support":
        if (!hasSession) {
          navigateToAuth("login");
          return;
        }
        document.getElementById("support")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      case "auth":
        navigateToAuth("login");
        return;
      default:
        if (!hasSession) {
          navigateToAuth("login");
          return;
        }
        navigateTo(hasSubscription ? "subscriptions" : "plans");
    }
  };
  const handleGuideSecondary = () => {
    switch (route) {
      case "subscriptions":
        document.querySelector(".preset-editor-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      case "membership":
      case "wallet":
      case "orders":
        navigateTo("plans");
        return;
      case "plans":
      case "checkout":
        navigateTo("orders");
        return;
      case "settings":
      case "support":
        navigateTo("subscriptions");
        return;
      case "auth":
        navigateToAuth("register");
        return;
      default:
        navigateTo("plans");
    }
  };
  const chooseScope = (scopeID: string) => {
    const nextScope = visibleScopes.find((scope) => scope.id === scopeID);
    const shouldRefreshGeneratedLink = Boolean(
      activeSubscription && nextScope && (linkState.status === "ready" || linkState.status === "copied" || linkState.url),
    );
    setPendingScopeId("");
    setPresetState((current) => (current.status === "saved" ? { status: "idle" } : current));
    setSelectedScopeId(scopeID);
    if (shouldRefreshGeneratedLink && nextScope) {
      setLinkState({ label: nextScope.label, status: "loading", url: linkState.url });
      void loadSubscriptionLink(false, nextScope);
      return;
    }
    setLinkState({ status: "idle" });
  };
  const startEditingPreset = (presetKey: string) => {
    const preset = savedPresets.find((item) => item.presetKey === presetKey);
    if (!preset) {
      return;
    }
    setEditingPresetKey(preset.presetKey);
    setPresetName(preset.name);
    setSelectedNodeIds([...preset.nodeIds]);
    setPresetSelectionCleared(!preset.nodeIds.length);
    setPresetNodeNames(() => {
      const names: Record<string, string> = {};
      if (preset.nodeItems.length) {
        for (const item of preset.nodeItems) {
          names[item.nodeId.toString()] = item.displayName;
        }
      } else {
        for (const nodeId of preset.nodeIds) {
          const key = nodeId.toString();
          names[key] = scopeNodeNameById.get(key) || "";
        }
      }
      return names;
    });
    chooseScope(`preset:${preset.presetKey}`);
    setPresetState({ status: "idle", message: `${preset.name} 已载入编辑器` });
  };
  const startNewPreset = () => {
    const initialNodes = presetVisibleNodes.slice(0, Math.min(3, presetVisibleNodes.length));
    setEditingPresetKey("");
    setPresetName("我的精选");
    setSelectedNodeIds(initialNodes.map((node) => node.nodeId));
    setPresetSelectionCleared(!initialNodes.length);
    setPresetNodeNames(Object.fromEntries(initialNodes.map((node) => [node.nodeId.toString(), node.name])));
    setPresetState({ status: "idle" });
  };
  const selectVisiblePresetNodes = () => {
    if (!presetVisibleNodes.length) {
      return;
    }
    setSelectedNodeIds((current) => {
      const seen = new Set(current.map((value) => value.toString()));
      const next = [...current];
      for (const node of presetVisibleNodes) {
        const key = node.nodeId.toString();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        next.push(node.nodeId);
      }
      return next;
    });
    setPresetSelectionCleared(false);
    setPresetNodeNames((current) => {
      const next = { ...current };
      for (const node of presetVisibleNodes) {
        const key = node.nodeId.toString();
        next[key] = next[key] || node.name;
      }
      return next;
    });
    setPresetState({ status: "idle", message: `已勾选 ${presetVisibleNodes.length} 个当前视图节点` });
  };
  const clearPresetNodes = () => {
    setSelectedNodeIds([]);
    setPresetNodeNames({});
    setPresetSelectionCleared(true);
    setPresetState({ status: "idle", message: "已清空当前预设节点" });
  };
  const togglePresetNode = (nodeID: bigint) => {
    const key = nodeID.toString();
    const selected = selectedNodeIds.some((id) => id === nodeID);
    const node = scopeNodes.find((item) => item.nodeId === nodeID);
    const nextSelectedNodeIds = selected ? selectedNodeIds.filter((id) => id !== nodeID) : [...selectedNodeIds, nodeID];
    setSelectedNodeIds(nextSelectedNodeIds);
    setPresetSelectionCleared(!nextSelectedNodeIds.length);
    setPresetNodeNames((current) => {
      if (selected) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: current[key] || node?.name || "" };
    });
    setPresetState({ status: "idle" });
  };
  const updatePresetNodeName = (nodeID: bigint, value: string) => {
    setPresetNodeNames((current) => ({ ...current, [nodeID.toString()]: value }));
    setPresetState({ status: "idle" });
  };
  const handleSavePreset = async () => {
    if (!activeSubscription) {
      handleProtectedAction();
      return;
    }
    setPresetState({ status: "saving" });
    try {
      const result = await saveUserSubscriptionPreset(activeSubscription.id, presetName, selectedNodeIds, presetNodeItems, editingPresetKey);
      setPresetState({ status: "saved", message: `${result.preset?.name || presetName} 已保存` });
      const savedKey = result.preset?.presetKey || "";
      if (result.preset) {
        setLocalPresetOverrides((current) => [result.preset as SubscriptionPresetSummary, ...current.filter((preset) => preset.presetKey !== savedKey)]);
      }
      setEditingPresetKey(savedKey);
      setPendingScopeId(`preset:${savedKey}`);
      setSelectedScopeId(`preset:${savedKey}`);
      setSessionRevision((value) => value + 1);
    } catch (reason: unknown) {
      setPresetState({ status: "error", message: errorMessage(reason) });
    }
  };
  const handleDeletePreset = async (presetKey: string, name: string) => {
    if (!activeSubscription) {
      handleProtectedAction();
      return;
    }
    setPresetState({ status: "deleting", message: `正在删除 ${name}` });
    try {
      await deleteUserSubscriptionPreset(activeSubscription.id, presetKey);
      if (selectedScopeId === `preset:${presetKey}`) {
        setSelectedScopeId("all");
        setLinkState({ status: "idle" });
      }
      setPendingScopeId((current) => (current === `preset:${presetKey}` ? "" : current));
      if (editingPresetKey === presetKey) {
        setEditingPresetKey("");
        setPresetName("我的精选");
        setPresetNodeNames({});
      }
      setLocalPresetOverrides((current) => current.filter((preset) => preset.presetKey !== presetKey));
      setPresetState({ status: "saved", message: `${name} 已删除` });
      setSessionRevision((value) => value + 1);
    } catch (reason: unknown) {
      setPresetState({ status: "error", message: errorMessage(reason) });
    }
  };
  const handleLogout = async () => {
    await logoutUser();
    refreshDashboard();
  };
  const handleChoosePlan = (plan: PlanCardView) => {
    if (!hasSession) {
      navigateToAuth("register");
      return;
    }
    setCheckoutPlan(plan);
    setCheckoutOrder(undefined);
    setCheckoutStatus("idle");
    setCheckoutError(plan.productId ? "" : "当前套餐来自预览数据，连接 server 后才能创建订单。");
    setCheckoutProvider("");
    setExternalPayment(undefined);
    navigateTo("checkout");
  };
  const handleCreateOrder = async () => {
    if (!checkoutPlan?.productId) {
      setCheckoutStatus("error");
      setCheckoutError("当前套餐没有可下单的 productId。");
      return;
    }
    setCheckoutStatus("creating");
    setCheckoutError("");
    setExternalPayment(undefined);
    try {
      const order = await createUserOrder(checkoutPlan.productId);
      setCheckoutOrder(order);
      setCheckoutStatus("created");
    } catch (reason: unknown) {
      setCheckoutStatus("error");
      setCheckoutError(errorMessage(reason));
    }
  };
  const handlePayWithBalance = async () => {
    if (!checkoutOrder?.orderNo) {
      setCheckoutStatus("error");
      setCheckoutError("请先创建订单。");
      return;
    }
    setCheckoutStatus("paying");
    setCheckoutError("");
    setExternalPayment(undefined);
    try {
      await payUserOrderWithBalance(checkoutOrder.orderNo);
      setCheckoutStatus("paid");
      refreshDashboard();
    } catch (reason: unknown) {
      setCheckoutStatus("error");
      setCheckoutError(errorMessage(reason));
    }
  };
  const handleStartProviderPayment = async (provider: string) => {
    if (!checkoutOrder?.orderNo) {
      setCheckoutStatus("error");
      setCheckoutError("请先创建订单。");
      return;
    }
    setCheckoutProvider(provider);
    setCheckoutError("");
    setExternalPayment(undefined);
    try {
      const session = await startUserOrderPayment(checkoutOrder.orderNo, provider);
      setCheckoutStatus("created");
      setExternalPayment({
        checkoutUrl: session.checkoutUrl,
        expiredAtUnixMs: session.expiredAtUnixMs,
        provider: session.provider,
        providerTradeNo: session.providerTradeNo,
        qrcode: session.qrcode,
        urlscheme: session.urlscheme,
      });
    } catch (reason: unknown) {
      setCheckoutStatus("error");
      setCheckoutError(errorMessage(reason));
    } finally {
      setCheckoutProvider("");
    }
  };
  const loadSubscriptionLink = async (copyToClipboard: boolean, scope: ScopeChoice = activeScope) => {
    if (!activeSubscription) {
      handleProtectedAction();
      return;
    }
    setLinkState({ status: "loading" });
    try {
      const link = await getUserSubscriptionLink(
        activeSubscription.id,
        scope.kind === "profile" ? scope.key : "",
        scope.kind === "preset" ? scope.key : "",
      );
      if (copyToClipboard) {
        await copyText(link.url);
        setLinkState({ status: "copied", label: link.scopeLabel, url: link.url });
        window.setTimeout(() => setLinkState((current) => (current.status === "copied" ? { ...current, status: "ready" } : current)), 1200);
        return;
      }
      setLinkState({ status: "ready", label: link.scopeLabel, url: link.url });
    } catch (reason: unknown) {
      setLinkState({ status: "error", error: errorMessage(reason) });
    }
  };
  const handleCopySubscriptionLink = async () => loadSubscriptionLink(true);
  const handleGenerateSubscriptionLink = async () => loadSubscriptionLink(false);
  const handleLoadMoreOrders = async () => {
    if (!orderPageCursor || orderLoadState.status === "loading") {
      return;
    }
    setOrderLoadState({ status: "loading" });
    try {
      const response = await listUserOrders(orderPageCursor, 6);
      setOrderHistory((current) => [...current, ...visibleOrdersForFeatureFlags(response.orders, membershipEnabled)]);
      setOrderPageCursor(response.page?.nextCursor || "");
      setOrderPageHasMore(Boolean(response.page?.hasMore));
      setOrderLoadState({ status: "idle" });
    } catch (reason: unknown) {
      setOrderLoadState({ status: "error", message: errorMessage(reason) });
    }
  };
  const handleOpenOrderDetail = async (order: OrderSummary) => {
    setSelectedOrder(order);
    setOrderDetailState({ status: "loading" });
    try {
      const detail = await getUserOrder(order.orderNo);
      setSelectedOrder(detail);
      setOrderDetailState({ status: "ready" });
    } catch (reason: unknown) {
      setOrderDetailState({ status: "error", message: errorMessage(reason) });
    }
  };
  const handleCreateSupportTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasSession) {
      navigateToAuth("login");
      return;
    }
    const validationError = validateSupportTicketInput(supportSubject, supportMessage, supportPolicy);
    if (validationError) {
      setSupportState({ status: "error", message: validationError });
      return;
    }
    setSupportState({ status: "creating" });
    try {
      const ticket = await createUserSupportTicket(supportSubject, supportCategory, supportPriority, supportMessage);
      setSupportTickets((current) => [ticket, ...current]);
      setSelectedSupportTicket(ticket);
      setSupportMessages([]);
      setSupportDetailState({ status: "idle", message: "新工单已打开，后续回复会在这里继续。" });
      setSupportSubject("");
      setSupportMessage("");
      setSupportPriorityTouched(false);
      setSupportState({ status: "idle", message: "工单已提交，客服回复后会更新状态。" });
      setSessionRevision((value) => value + 1);
    } catch (reason: unknown) {
      setSupportState({ status: "error", message: errorMessage(reason) });
    }
  };

  const handleSelectSupportTicket = async (ticket: SupportTicket) => {
    if (!hasSession) {
      navigateToAuth("login");
      return;
    }
    setSelectedSupportTicket(ticket);
    setSupportDetailState({ status: "loading" });
    try {
      const response = await getUserSupportTicket(ticket.id);
      if (response.ticket) {
        setSelectedSupportTicket(response.ticket);
        setSupportTickets((current) => current.map((item) => (item.id === response.ticket?.id ? response.ticket : item)));
      }
      setSupportMessages(response.messages);
      setSupportDetailState({ status: "idle" });
    } catch (cause: unknown) {
      setSupportDetailState({ status: "error", message: errorMessage(cause) });
    }
  };

  const handleReplySupportTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSupportTicket) {
      return;
    }
    const validationError = validateSupportMessageInput(supportReply, supportPolicy);
    if (validationError) {
      setSupportDetailState({ status: "error", message: validationError });
      return;
    }
    setSupportDetailState({ status: "replying" });
    try {
      const response = await replyUserSupportTicket(selectedSupportTicket.id, supportReply);
      if (response.ticket) {
        setSelectedSupportTicket(response.ticket);
        setSupportTickets((current) => current.map((item) => (item.id === response.ticket?.id ? response.ticket : item)));
      }
      setSupportMessages(response.messages);
      setSupportReply("");
      setSupportDetailState({ status: "saved", message: "回复已发送。" });
    } catch (cause: unknown) {
      setSupportDetailState({ status: "error", message: errorMessage(cause) });
    }
  };
  const handleLoadMoreSupportTickets = async () => {
    if (!supportPageCursor || supportState.status === "loading") {
      return;
    }
    setSupportState({ status: "loading" });
    try {
      const response = await listUserSupportTickets(supportPageCursor, 6);
      setSupportTickets((current) => [...current, ...response.tickets]);
      setSupportPageCursor(response.page?.nextCursor || "");
      setSupportPageHasMore(Boolean(response.page?.hasMore));
      setSupportState({ status: "idle" });
    } catch (reason: unknown) {
      setSupportState({ status: "error", message: errorMessage(reason) });
    }
  };
  const showSubscriptionSection = route === "dashboard" || route === "subscriptions";
  const showMembershipSection = membershipEnabled && (route === "dashboard" || route === "membership");
  const showWalletSection = route === "dashboard" || route === "wallet";
  const showPlansSection = route === "dashboard" || route === "plans";
  const showOrdersSection = route === "dashboard" || route === "orders" || route === "wallet";
  const showCheckoutSection = route === "plans" || route === "checkout";
  const showSettingsSection = route === "settings";
  const showSupportSection = route === "dashboard" || route === "support";
  const internalPortalUnavailable = portalVariant() === "internal" && status === "fallback";

  if (internalPortalUnavailable) {
    return (
      <main className="moment-user-shell route-auth">
        <section className="auth-page">
          <a className="brand" href="/">
            {branding.userLogoUrl ? <img alt={`${siteName} logo`} className="brand-logo" src={branding.userLogoUrl} /> : (
              <span className="brand-mark">
                <Sparkles size={18} />
              </span>
            )}
            <span>{siteName}</span>
          </a>
          <article className="auth-card">
            <span className="eyebrow">Internal portal</span>
            <h1>内部入口暂未开启。</h1>
            <p>{dashboardError || "请在 admin 设置中启用内部用户端后再访问。"}</p>
            <button className="primary-action" onClick={() => setSessionRevision((value) => value + 1)} type="button">
              <RefreshCw size={17} />
              重新检查
            </button>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className={`moment-user-shell route-${route}`}>
      <header className="topbar">
        <a className="brand" href="/">
          {branding.userLogoUrl ? <img alt={`${siteName} logo`} className="brand-logo" src={branding.userLogoUrl} /> : (
            <span className="brand-mark">
              <Sparkles size={18} />
            </span>
          )}
          <span>{siteName}</span>
        </a>
        <nav className="desktop-nav">
          {visibleNavLinks.map((item) => (
            <a className={navRouteActive(route, item.route) ? "active" : ""} href={item.href} key={item.route} onClick={(event) => handleRouteClick(event, item.route)}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="topbar-actions">
          <button aria-label="通知" className="icon-button" type="button">
            <Bell size={18} />
          </button>
          {membershipEnabled ? (
            <button aria-label={hasSession ? "查看会员卡状态" : "登录后查看会员卡"} className="member-chip" onClick={() => (!hasSession ? navigateToAuth("login") : navigateTo("membership"))} type="button">
              <ShieldCheck size={16} />
              {memberText}
            </button>
          ) : null}
          {hasSession ? (
            <button className="secondary-action session-action" onClick={handleLogout} type="button">
              <LogOut size={17} />
              退出
            </button>
          ) : (
            <button className="primary-action session-action" onClick={() => navigateToAuth("login")} type="button">
              <LogIn size={17} />
              登录
            </button>
          )}
        </div>
      </header>

      {announcement?.enabled ? <AnnouncementBanner announcement={announcement} /> : null}

      <section className="hero-panel" id="dashboard">
        <div className="hero-copy">
          <span className="eyebrow">{heroView.eyebrow}</span>
          <h1>{heroView.heading}</h1>
          <p>{heroView.body}</p>
          <div className="hero-actions">
            <button className={heroView.tone ? `primary-action scope-action-tone ${heroView.tone}` : "primary-action"} key={`hero-primary-${heroView.tone || "neutral"}-${heroView.primaryText}`} onClick={handleHeroPrimary} type="button">
              {heroView.primaryIcon}
              {heroView.primaryText}
            </button>
            <button className={heroView.tone ? `secondary-action scope-action-tone ${heroView.tone}` : "secondary-action"} key={`hero-secondary-${heroView.tone || "neutral"}-${heroView.secondaryText}`} onClick={handleHeroSecondary} type="button">
              {heroView.secondaryIcon}
              {heroView.secondaryText}
            </button>
          </div>
        </div>
        <div className="status-stack">
          {membershipEnabled ? <StatusMetric icon={<CircleCheck size={18} />} label="会员" value={membershipValue} detail={membershipDetail} tone="green" /> : null}
          <StatusMetric icon={<Gauge size={18} />} label="剩余流量" value={route === "dashboard" ? dashboardUsage.remaining : usage.remaining} detail={`已用 ${route === "dashboard" ? dashboardUsage.used : usage.used} / ${route === "dashboard" ? dashboardUsage.total : usage.total}`} tone="blue" />
          <StatusMetric icon={<Zap size={18} />} label="速度" value={isAccountSyncing ? "同步中" : "1 Gbps"} detail={isAccountSyncing ? "正在同步设备信息" : "3 台设备在线"} tone="amber" />
        </div>
      </section>

      <PageGuide guide={guideView} onPrimary={handleGuidePrimary} onSecondary={handleGuideSecondary} />

      <section className="content-grid">
        {showSubscriptionSection ? (
        <article className={route === "dashboard" ? "service-panel subscription-overview-card" : "service-panel subscription-studio"} id="subscriptions">
          {route === "dashboard" ? (
            <DashboardSubscriptionOverview
              onPrimary={() => {
                if (!hasSession) {
                  navigateToAuth("login");
                  return;
                }
                navigateTo(hasSubscription ? "subscriptions" : "plans");
              }}
              onSecondary={() => navigateTo("plans")}
              overview={connectionOverview}
              usage={dashboardUsage}
            />
          ) : (
            <>
              <div className="subscription-studio-hero">
            <div>
              <span className="eyebrow">我的订阅</span>
              <h2>{subscriptionName}</h2>
              <p>
                {hasSubscription
                  ? "按订阅、接入方式或自定义节点范围生成链接。节点很多时，可以搜索、批量选择并给节点改显示名。"
                  : hasSession
                    ? "开通订阅后，这里会显示节点范围、预设和二维码。"
                    : "登录后管理你的订阅链接、节点范围和专属预设。"}
              </p>
            </div>
            <div className="subscription-status-pack">
              <span className="status-dot">{subscriptionStatusLabel(activeSubscription?.status) || (hasSession ? "暂无订阅" : "访客预览")}</span>
              <strong>{hasSubscription ? daysText : "-"}</strong>
              <small>{hasSubscription ? `${expiryText} 到期` : "暂无可用订阅"}</small>
            </div>
          </div>
          {subscriptionDetailState.status === "loading" ? <p className="link-feedback">正在读取订阅详情...</p> : null}
          {subscriptionDetailState.status === "error" ? <p className="link-feedback error">{subscriptionDetailState.message}</p> : null}

          <div className="subscription-workbench">
            <aside className="subscription-rail" aria-label="订阅列表">
              <div className="subscription-rail-heading">
                <span>订阅列表</span>
                <strong>{dashboardSubscriptions.length || 0}</strong>
              </div>
              <div className="subscription-switcher">
                {dashboardSubscriptions.length ? (
                  dashboardSubscriptions.map((subscription, index) => (
                    <button
                      className={subscription.id === activeSubscription?.id ? "active" : ""}
                      key={subscription.id.toString()}
                      onClick={() => navigateToSubscription(subscription.id)}
                      type="button"
                    >
                      <em>{String(index + 1).padStart(2, "0")}</em>
                      <span>
                        <strong>{subscription.name}</strong>
                        <small>{subscriptionStatusLabel(subscription.status)} · {dateText(subscription.expiredAtUnixMs)}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <span>{hasSession ? "正在读取订阅详情" : "登录后查看订阅详情"}</span>
                )}
              </div>

              <div className="subscription-usage-card">
                <div className="usage-ring" aria-label={`${usage.percent} percent used`}>
                  <span>{usage.percent}%</span>
                </div>
                <div>
                  <span>流量使用</span>
                  <strong>{usage.used}</strong>
                  <small>共 {usage.total} · 剩余 {usage.remaining}</small>
                </div>
              </div>

              <div className="subscription-compact-chart" aria-hidden="true">
                {usageSeries.map((point, index) => (
                  <span key={index} style={{ height: `${point}%` }} />
                ))}
              </div>

              <div className="subscription-mini-facts">
                <Fact icon={<RefreshCw size={15} />} label="重置" value={hasSubscription ? "30 天" : "-"} />
                <Fact icon={<KeyRound size={15} />} label="节点" value={scopeNodeCountText} />
                <Fact icon={<LockKeyhole size={15} />} label="预设" value={`${savedPresets.length}`} />
              </div>
            </aside>

            <section className="subscription-main" aria-label="订阅范围与节点">
              <div className="scope-toolbar">
                <div>
                  <span>订阅范围</span>
                  <strong>{activeScope.label}</strong>
                </div>
                <div className="scope-tabs" role="tablist" aria-label="订阅链接范围">
                  {visibleScopes.map((scope) => (
                    <button
                      className={scope.id === activeScope.id ? `scope-tab active ${scope.tone}` : "scope-tab"}
                      disabled={!hasSubscription}
                      key={scope.id}
                      onClick={() => chooseScope(scope.id)}
                      type="button"
                    >
                      <span>{scope.label}</span>
                      <strong>{hasSubscription ? scope.nodeCount : 0}</strong>
                    </button>
                  ))}
                </div>
              </div>

              <div className={`scope-summary ${activeScope.tone}`}>
                <div>
                  <span>当前链接会包含</span>
                  <strong>{activeScopeNodes.length} 个节点</strong>
                  <small title={activeScopeNodeSummary}>{activeScopeNodeSummary}</small>
                </div>
                <em>{activeScope.kind === "preset" ? "预设" : activeScope.kind === "profile" ? "接入方式" : "全部"}</em>
              </div>

              <div className="preset-editor-card">
                <div className="preset-editor-header">
                  <div>
                    <span>自定义预设</span>
                    <strong>{editingPresetKey ? `编辑 ${presetName || editingPresetKey}` : "选择节点并命名"}</strong>
                    <small>{presetEditorHint}</small>
                  </div>
                  <div className="preset-editor-actions">
                    <span aria-live="polite"><strong>{selectedNodeIds.length}</strong> 已选</span>
                    <button disabled={!hasSubscription || !selectedNodeIds.length || presetState.status === "saving"} onClick={handleSavePreset} type="button">
                      {presetState.status === "saving" ? "保存中..." : editingPresetKey ? "保存修改" : "保存预设"}
                    </button>
                    <button disabled={!hasSubscription || !scopeNodes.length || presetState.status === "saving"} onClick={startNewPreset} type="button">
                      新建
                    </button>
                  </div>
                </div>

                <div className="preset-control-grid">
                  <label className="preset-name-card">
                    <span>预设名称</span>
                    <input disabled={!hasSubscription} onChange={(event) => setPresetName(event.target.value)} value={presetName} />
                  </label>
                  <label className="node-search-field">
                    <span>搜索节点</span>
                    <input
                      disabled={!hasSubscription}
                      onChange={(event) => setNodeSearch(event.target.value)}
                      placeholder="输入节点、地区、协议或服务器"
                      value={nodeSearch}
                    />
                  </label>
                </div>

                <div className="preset-filter-panel">
                  <div className="preset-filter-heading">
                    <div>
                      <span>节点视图</span>
                      <strong>{presetVisibleNodes.length} 个可见 · 共 {scopeNodes.length} 个</strong>
                    </div>
                    <div className="preset-bulk-actions">
                      <button disabled={!hasSubscription || !presetVisibleNodes.length} onClick={selectVisiblePresetNodes} type="button">
                        勾选当前视图
                      </button>
                      <button disabled={!hasSubscription || !selectedNodeIds.length} onClick={clearPresetNodes} type="button">
                        清空选择
                      </button>
                    </div>
                  </div>
                  <div className="preset-filter-tabs" role="tablist" aria-label="preset node access profiles">
                    <button className={presetNodeFilter === "all" ? "active" : ""} disabled={!hasSubscription} onClick={() => setPresetNodeFilter("all")} type="button">
                      全部
                    </button>
                    {presetPickerProfiles.map((profile) => (
                      <button
                        className={presetNodeFilter === profile.profileKey ? "active" : ""}
                        disabled={!hasSubscription}
                        key={profile.profileKey}
                        onClick={() => setPresetNodeFilter(profile.profileKey)}
                        type="button"
                      >
                        {profile.displayLabel}
                        <small>{profile.nodeCount}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="node-directory" aria-label="节点选择列表">
                  {presetNodeGroups.length ? (
                    presetNodeGroups.map((group) => (
                      <div className="node-group" key={group.label}>
                        <div className="node-group-title">
                          <strong>{group.label}</strong>
                          <span>{group.nodes.length} 个节点</span>
                        </div>
                        {group.nodes.map((node) => {
                          const selected = selectedNodeIdSet.has(node.nodeId.toString());
                          return (
                            <div className={selected ? "node-row active" : "node-row"} key={node.nodeId.toString()}>
                              <button aria-pressed={selected} onClick={() => togglePresetNode(node.nodeId)} type="button">
                                <span className="node-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                                <span className="node-row-main">
                                  <strong>{node.name}</strong>
                                  <small>{profileLabelForNode(node)} · {node.regionCode || "默认区域"}</small>
                                </span>
                              </button>
                              <span className="node-row-server">{node.serverName || "默认服务"}</span>
                              {selected ? (
                                <label className="node-alias-field">
                                  <span>显示名</span>
                                  <input
                                    onChange={(event) => updatePresetNodeName(node.nodeId, event.currentTarget.value)}
                                    placeholder={node.name}
                                    value={presetNodeNames[node.nodeId.toString()] ?? node.name}
                                  />
                                </label>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ))
                  ) : (
                    <span className={scopes.status === "error" ? "node-empty error" : "node-empty"}>{scopeEmptyText}</span>
                  )}
                </div>
                {presetState.message ? <p className={presetState.status === "error" ? "link-feedback error" : "link-feedback"}>{presetState.message}</p> : null}
              </div>
            </section>

            <aside className={`subscription-link-console ${activeScope.tone}`} aria-label="订阅链接">
              <div className="link-console-heading">
                <span>当前链接</span>
                <strong>{activeScope.label}</strong>
                <small>{activeScopeNodes.length} 个节点 · {activeScope.kind === "preset" ? "自定义预设" : activeScope.kind === "profile" ? "按接入方式" : "全部可用"}</small>
              </div>
              <SubscriptionQrPreview tone={activeScope.tone} value={linkState.url || ""} />
              <div className="link-console-actions">
                <button
                  className={`copy-link scope-action-tone ${activeScope.tone}`}
                  disabled={!hasSubscription || linkState.status === "loading"}
                  key={`copy-${activeScope.id}`}
                  onClick={handleCopySubscriptionLink}
                  type="button"
                >
                  <Copy size={18} />
                  {linkState.status === "copied" ? "订阅链接已复制" : subscriptionActionText}
                </button>
                <button
                  className={`secondary-action scope-action-tone ${activeScope.tone}`}
                  disabled={!hasSubscription || linkState.status === "loading"}
                  key={`qr-${activeScope.id}`}
                  onClick={handleGenerateSubscriptionLink}
                  type="button"
                >
                  <QrCode size={17} />
                  生成二维码
                </button>
              </div>
              {linkState.status === "error" ? <p className="link-feedback error">{linkState.error}</p> : null}
              {linkState.status === "ready" && linkState.url ? <p className="link-feedback">已生成 {linkState.label || "全部节点"} 订阅链接。</p> : null}
              <div className="preset-saved compact">
                <div className="preset-section-title">
                  <span>已保存预设</span>
                  <strong>{savedPresets.length}</strong>
                </div>
                {savedPresetUnavailableCount ? <p className="preset-warning">有 {savedPresetUnavailableCount} 个节点已不可用，打开对应预设即可修复。</p> : null}
                {savedPresets.length ? (
                  <div className="preset-list" aria-label="saved subscription presets">
                    {savedPresets.map((preset) => (
                      <div className={selectedScopeId === `preset:${preset.presetKey}` ? "preset-pill active" : "preset-pill"} key={preset.presetKey}>
                        <button onClick={() => startEditingPreset(preset.presetKey)} type="button">
                          <strong>{preset.name}</strong>
                          <small>{preset.nodeCount} 节点{preset.unavailableNodeCount ? ` · ${preset.unavailableNodeCount} 不可用` : ""}</small>
                        </button>
                        <button
                          aria-label={`删除 ${preset.name}`}
                          disabled={presetState.status === "deleting"}
                          onClick={() => handleDeletePreset(preset.presetKey, preset.name)}
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="preset-empty">还没有保存的预设。</span>
                )}
              </div>
              <div className="selected-node-preview">
                <span>预设内节点</span>
                {selectedPresetNodes.length ? (
                  selectedPresetNodes.slice(0, 6).map((node) => {
                    const displayName = presetNodeNames[node.nodeId.toString()] || node.name;
                    return <small key={node.nodeId.toString()} title={displayName}>{displayName}</small>;
                  })
                ) : (
                  <small>还没有选择节点</small>
                )}
              </div>
            </aside>
          </div>
            </>
          )}
        </article>
        ) : null}

        {showMembershipSection ? (
          <MembershipPanel
            compact={route === "dashboard"}
            hasToken={hasSession}
            isAccountSyncing={isAccountSyncing}
            membership={membership}
            onChoosePlan={handleChoosePlan}
            onManage={() => navigateTo("membership")}
            plans={membershipPlans}
            siteName={siteName}
            statusDetail={statusDetail}
          />
        ) : null}

        {showWalletSection ? (
        <aside className="wallet-panel" id="wallet">
          <div className="wallet-header">
            <Wallet size={18} />
            <span>钱包</span>
          </div>
          <strong>{isAccountSyncing ? "同步中" : hasSession ? formatMoney(wallet?.balance) || "$0.00" : "登录后查看"}</strong>
          <span className="muted">可用余额</span>
          <button className="secondary-action full" onClick={() => navigateTo("plans")} type="button">
            <ShoppingBag size={17} />
            使用余额购买
          </button>
          <div className="wallet-split">
            <span><Gift size={15} /> 赠送 {isAccountSyncing ? "同步中" : formatMoney(wallet?.giftBalance) || "$0.00"}</span>
            <span>佣金 {isAccountSyncing ? "同步中" : formatMoney(wallet?.commission) || "$0.00"}</span>
          </div>
        </aside>
        ) : null}

        {showPlansSection ? (
        <article className="plans-panel" id="plans">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">购买</span>
              <h2>推荐套餐</h2>
            </div>
            <button className="ghost-link" onClick={() => navigateTo("plans")} type="button">
              查看全部
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="plan-grid">
            {plans.map((plan) => (
              <PlanCard cta={!hasSession ? "登录购买" : plan.canPurchase === false ? "暂不可买" : "选择套餐"} disabled={hasSession && plan.canPurchase === false} key={plan.name} onChoose={() => handleChoosePlan(plan)} {...plan} />
            ))}
          </div>
        </article>
        ) : null}

        {showOrdersSection ? (
        <article className="orders-panel" id="orders">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">订单</span>
              <h2>最近订单</h2>
            </div>
            <span className="order-count">{isAccountSyncing ? "同步中" : orderHistory.length ? `${orderHistory.length} 条` : hasSession ? "暂无" : "登录后查看"}</span>
          </div>
          <div className="order-list">
            {orderHistory.length ? (
              orderHistory.map((order) => (
                <button className={selectedOrder?.orderNo === order.orderNo ? "order-row active" : "order-row"} key={order.orderNo} onClick={() => handleOpenOrderDetail(order)} type="button">
                  <div>
                    <strong>{order.itemSnapshot?.name || "订单快照"}</strong>
                    <span>{order.orderNo}</span>
                  </div>
                  <div>
                    <strong>{formatMoney(order.amount)}</strong>
                    <small>{dateText(order.paidAtUnixMs || order.createdAtUnixMs)}</small>
                  </div>
                  <em className={`order-status ${orderStatusTone(order.status)}`}>{orderStatusLabel(order.status)}</em>
                </button>
              ))
            ) : (
              <div className="order-empty">
                <ReceiptText size={19} />
                <strong>{isAccountSyncing ? "正在同步订单" : hasSession ? "还没有订单" : "登录后显示你的订单"}</strong>
                <span>{isAccountSyncing ? "同步完成后会显示最近订单和商品快照。" : hasSession ? "从推荐套餐创建订单后，这里会显示快照、金额和支付状态。" : "订单只从当前账户读取，不会展示预览数据。"}</span>
              </div>
            )}
          </div>
          {orderHistory.length > 0 && orderPageHasMore ? (
            <button className="order-more" disabled={orderLoadState.status === "loading"} onClick={handleLoadMoreOrders} type="button">
              {orderLoadState.status === "loading" ? "加载中..." : "加载更多订单"}
            </button>
          ) : null}
          {orderLoadState.status === "error" ? <p className="order-error">{orderLoadState.message}</p> : null}
          {selectedOrder ? (
            <OrderDetailPanel
              detailState={orderDetailState}
              onClose={() => {
                setSelectedOrder(undefined);
                setOrderDetailState({ status: "idle" });
              }}
              order={selectedOrder}
            />
          ) : null}
        </article>
        ) : null}

        {showCheckoutSection ? (
        <article className="checkout-panel" id="checkout">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">开通流程</span>
              <h2>{membershipEnabled ? "购买会先保护会员权益，再锁定订单" : "购买会锁定订单快照，再完成开通"}</h2>
            </div>
            <button className="primary-action compact" onClick={() => navigateTo("plans")} type="button">
              <ShoppingBag size={17} />
              继续购买
            </button>
          </div>
          <div className="checkout-steps">
            {visibleCheckoutSteps.map((step, index) => (
              <div className="checkout-step" key={step.title}>
                <span className="step-index">{index + 1}</span>
                <span className="step-icon">{step.icon}</span>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </div>
            ))}
          </div>
        </article>
        ) : null}

        {showSettingsSection ? (
          <SettingsPanel
            hasToken={hasSession}
            isAccountSyncing={isAccountSyncing}
            membership={membership}
            membershipEnabled={membershipEnabled}
            onLogin={() => navigateToAuth("login")}
            onLogout={handleLogout}
            siteName={siteName}
            statusDetail={statusDetail}
          />
        ) : null}

        {showSupportSection ? (
        <article className="activity-panel" id="support">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{route === "support" ? "帮助" : "最近"}</span>
              <h2>{route === "support" ? "需要协助时从这里开始" : "账户动态"}</h2>
            </div>
          </div>
          <div className="timeline">
            {route === "support" ? (
              <SupportPanel
                category={supportCategory}
                categories={supportPolicy.categories}
                hasMore={supportPageHasMore}
                hasToken={hasSession}
                message={supportMessage}
                onCategoryChange={setSupportCategory}
                onLoadMore={handleLoadMoreSupportTickets}
                onLogin={() => navigateToAuth("login")}
                onMessageChange={setSupportMessage}
                onPriorityChange={(value) => {
                  setSupportPriority(value);
                  setSupportPriorityTouched(true);
                }}
                onSubmit={handleCreateSupportTicket}
                onReply={handleReplySupportTicket}
                onReplyChange={setSupportReply}
                onSelectTicket={handleSelectSupportTicket}
                onSubjectChange={setSupportSubject}
                priority={supportPriority}
                priorityOptions={supportPriorityOptions}
                reply={supportReply}
                selectedTicket={selectedSupportTicket}
                supportPolicy={supportPolicy}
                messages={supportMessages}
                detailState={supportDetailState}
                state={supportState}
                subject={supportSubject}
                tickets={supportTickets}
              />
            ) : (
              <>
                {isAccountSyncing ? (
                  <Activity icon={<RefreshCw size={15} />} title="正在同步账户动态" detail="订单、订阅和工单事件加载中" />
                ) : orderHistory.length ? (
                  orderHistory.slice(0, 3).map((order) => (
                    <Activity
                      detail={`${order.itemSnapshot?.name || "订单快照"} · ${formatMoney(order.amount) || "$0.00"} · ${dateText(order.paidAtUnixMs || order.createdAtUnixMs)}`}
                      icon={<ReceiptText size={15} />}
                      key={order.orderNo}
                      title={orderStatusLabel(order.status)}
                    />
                  ))
                ) : (
                  <Activity icon={hasSession ? <ReceiptText size={15} /> : <LogIn size={15} />} title={hasSession ? "暂无近期动态" : "登录后同步动态"} detail={hasSession ? "新订单、订阅和工单变化会显示在这里" : "登录后读取你的账户事件"} />
                )}
              </>
            )}
          </div>
        </article>
        ) : null}
      </section>

      <nav className="mobile-nav">
        <a className={route === "dashboard" ? "active" : ""} href="/" onClick={(event) => handleRouteClick(event, "dashboard")}><Home size={19} /> 首页</a>
        <a className={route === "subscriptions" ? "active" : ""} href="/subscriptions" onClick={(event) => handleRouteClick(event, "subscriptions")}><LayoutDashboard size={19} /> 订阅</a>
        {membershipEnabled ? <a className={route === "membership" ? "active" : ""} href="/membership" onClick={(event) => handleRouteClick(event, "membership")}><BadgeCheck size={19} /> 会员</a> : null}
        <a className={navRouteActive(route, "plans") ? "active" : ""} href="/plans" onClick={(event) => handleRouteClick(event, "plans")}><ShoppingBag size={19} /> 购买</a>
        <a className={route === "wallet" ? "active" : ""} href="/wallet" onClick={(event) => handleRouteClick(event, "wallet")}><Wallet size={19} /> 钱包</a>
        <a className={route === "orders" ? "active" : ""} href="/orders" onClick={(event) => handleRouteClick(event, "orders")}><ReceiptText size={19} /> 订单</a>
        <a className={route === "settings" ? "active" : ""} href="/settings" onClick={(event) => handleRouteClick(event, "settings")}><Settings size={19} /> 设置</a>
        {featureFlags.supportTicketEnabled ? (
          <a className={route === "support" ? "active" : ""} href="/support" onClick={(event) => handleRouteClick(event, "support")}><HelpCircle size={19} /> 帮助</a>
        ) : null}
      </nav>
      {authOpen || route === "auth" ? (
        <AuthPanel
          mode={authMode}
          authPolicy={authPolicy}
          onClose={() => {
            setAuthOpen(false);
            if (route === "auth") {
              navigateTo("dashboard");
            }
          }}
          onModeChange={setAuthMode}
          siteName={siteName}
          onSuccess={() => {
            setAuthOpen(false);
            refreshDashboard();
            if (route === "auth") {
              navigateTo("dashboard");
            }
          }}
        />
      ) : null}
      {checkoutPlan ? (
        <CheckoutPanel
          error={checkoutError}
          externalPayment={externalPayment}
          onClose={() => {
            setCheckoutPlan(undefined);
            if (route === "checkout") {
              navigateTo("plans");
            }
          }}
          onCreateOrder={handleCreateOrder}
          onPayWithBalance={handlePayWithBalance}
          onStartProviderPayment={handleStartProviderPayment}
          order={checkoutOrder}
          paymentMethods={paymentMethods}
          plan={checkoutPlan}
          providerBusy={checkoutProvider}
          status={checkoutStatus}
        />
      ) : null}
    </main>
  );
}

function StatusMetric({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return (
    <div className={`status-card ${tone}`}>
      <div className="status-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function DashboardSubscriptionOverview({
  onPrimary,
  onSecondary,
  overview,
  usage,
}: {
  onPrimary: () => void;
  onSecondary: () => void;
  overview: ConnectionOverviewView;
  usage: SubscriptionUsageView;
}) {
  return (
    <div className={`subscription-overview connection-overview ${overview.tone}`}>
      <div className="subscription-overview-copy">
        <span className="eyebrow">连接概览</span>
        <h2>{overview.title}</h2>
        <p>{overview.body}</p>
      </div>
      <div className="subscription-overview-metrics connection-overview-highlights" aria-label="连接摘要">
        {overview.highlights.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
      <div className="subscription-overview-meter" aria-label={`已用 ${usage.percent}%`}>
        <span style={{ width: `${Math.min(100, Math.max(0, usage.percent))}%` }} />
      </div>
      <div className="subscription-overview-actions">
        <button className={`copy-link scope-action-tone ${overview.tone}`} onClick={onPrimary} type="button">
          <LayoutDashboard size={18} />
          {overview.primaryAction}
        </button>
        <button className="secondary-action" onClick={onSecondary} type="button">
          <ShoppingBag size={17} />
          {overview.secondaryAction}
        </button>
      </div>
      <p className="subscription-overview-note">
        聚合统计全部生效中的订阅：已用 {usage.used} / {usage.total}。复制链接、二维码和自定义预设统一在订阅页完成。
      </p>
    </div>
  );
}

function AnnouncementBanner({ announcement }: { announcement: { enabled: boolean; title: string; body: string; tone: string } }) {
  return (
    <section className={`announcement-banner ${announcement.tone || "info"}`} role="status">
      <span className="announcement-icon"><Bell size={17} /></span>
      <div>
        <strong>{announcement.title || "公告"}</strong>
        {announcement.body ? <p>{announcement.body}</p> : null}
      </div>
    </section>
  );
}

function PageGuide({ guide, onPrimary, onSecondary }: { guide: PageGuideView; onPrimary: () => void; onSecondary: () => void }) {
  const primaryClassName = guide.tone ? `primary-action scope-action-tone ${guide.tone}` : "primary-action";
  const secondaryClassName = guide.tone ? `secondary-action scope-action-tone ${guide.tone}` : "secondary-action";
  return (
    <section className="page-guide" aria-label="当前页面操作引导">
      <div className="page-guide-copy">
        <span>{guide.eyebrow}</span>
        <strong>{guide.title}</strong>
        <p>{guide.body}</p>
      </div>
      <div className="page-guide-flow" aria-label="页面步骤">
        {guide.steps.map((step, index) => (
          <div className={`page-guide-step ${step.state}`} key={`${step.label}-${index}`}>
            <em>{String(index + 1).padStart(2, "0")}</em>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </div>
        ))}
      </div>
      <div className="page-guide-actions">
        <button className={primaryClassName} key={`guide-primary-${guide.tone || "neutral"}-${guide.primaryText}`} onClick={onPrimary} type="button">
          {guide.primaryIcon}
          {guide.primaryText}
        </button>
        <button className={secondaryClassName} key={`guide-secondary-${guide.tone || "neutral"}-${guide.secondaryText}`} onClick={onSecondary} type="button">
          {guide.secondaryIcon}
          {guide.secondaryText}
        </button>
      </div>
    </section>
  );
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="fact">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PlanCard({ name, price, meta, tone, featured, cta, disabled, onChoose, unavailableReason }: PlanCardView & { cta: string; disabled?: boolean; onChoose: () => void }) {
  const reason = unavailableReasonLabel(unavailableReason || "");
  return (
    <div className={featured ? `plan ${tone} featured` : `plan ${tone}`}>
      <span>{name}</span>
      <strong>{price}</strong>
      <small>{meta}</small>
      {disabled && reason ? <em className="plan-reason">{reason}</em> : null}
      <button aria-label={`${cta} ${name}`} disabled={disabled} onClick={onChoose} type="button">{cta}</button>
    </div>
  );
}

function MembershipPanel({
  compact = false,
  hasToken,
  isAccountSyncing,
  membership,
  onChoosePlan,
  onManage,
  plans,
  siteName,
  statusDetail,
}: {
  compact?: boolean;
  hasToken: boolean;
  isAccountSyncing: boolean;
  membership?: { active: boolean; badgeText: string; expiredAtUnixMs: bigint };
  onChoosePlan: (plan: PlanCardView) => void;
  onManage?: () => void;
  plans: PlanCardView[];
  siteName: string;
  statusDetail: string;
}) {
  const active = Boolean(membership?.active);
  const expiry = membership?.expiredAtUnixMs ? dateText(membership.expiredAtUnixMs) : "";
  return (
    <article className={compact ? "membership-panel compact" : "membership-panel"} id="membership">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">会员权益</span>
          <h2>会员卡</h2>
        </div>
        <span className={active ? "status-dot" : "status-dot muted-state"}>{active ? membership?.badgeText || "生效中" : isAccountSyncing ? "同步中" : hasToken ? "待开通" : "登录后查看"}</span>
      </div>
      <div className="membership-hero-card">
        <div>
          <span>{active ? "当前会员有效" : isAccountSyncing ? "正在同步会员状态" : "订阅购买前置权益"}</span>
          <strong>{active ? `${expiry} 到期` : isAccountSyncing ? "正在读取会员有效期" : "一张会员卡，解锁订阅购买"}</strong>
          <p>{active ? "续费只会延长有效期，不会叠加数量。购买订阅商品时，系统会按会员卡到期规则校验。" : isAccountSyncing ? "同步完成后会显示会员有效期、购买校验和可续费状态。" : `${siteName} 的规则是一人一卡。开通会员后，才能购买订阅套餐和保存专属订阅范围。`}</p>
        </div>
        <em>{active ? "生效中" : isAccountSyncing ? "同步中" : "待开通"}</em>
      </div>
      <div className="membership-facts">
        <Fact icon={<BadgeCheck size={16} />} label="持有规则" value="每人一张" />
        <Fact icon={<RefreshCw size={16} />} label="续费方式" value="延长期限" />
        <Fact icon={<ShieldCheck size={16} />} label="购买校验" value={statusDetail} />
      </div>
      {compact ? (
        <button className="secondary-action full" onClick={onManage} type="button">
          <BadgeCheck size={17} />
          查看会员卡
        </button>
      ) : (
        <div className="membership-plan-strip">
          {plans.map((plan) => (
            <PlanCard
              cta={!hasToken ? "登录开通" : plan.canPurchase === false ? "暂不可买" : active ? "续费会员" : "开通会员"}
              disabled={hasToken && plan.canPurchase === false}
              key={plan.name}
              onChoose={() => onChoosePlan(plan)}
              {...plan}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function SettingsPanel({
  hasToken,
  isAccountSyncing,
  membership,
  membershipEnabled,
  onLogin,
  onLogout,
  siteName,
  statusDetail,
}: {
  hasToken: boolean;
  isAccountSyncing: boolean;
  membership?: { active: boolean; badgeText: string; expiredAtUnixMs: bigint };
  membershipEnabled: boolean;
  onLogin: () => void;
  onLogout: () => void;
  siteName: string;
  statusDetail: string;
}) {
  const active = Boolean(membership?.active);
  const membershipDetail = active ? `${dateText(membership?.expiredAtUnixMs || 0n)} 到期` : isAccountSyncing ? "正在同步会员状态" : hasToken ? "待开通会员卡" : "登录后同步权益";
  return (
    <article className="settings-panel" id="settings">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">账号设置</span>
          <h2>账号设置</h2>
        </div>
        <span className={hasToken ? "status-dot" : "status-dot muted-state"}>{hasToken ? "已登录" : "访客"}</span>
      </div>

      <div className="settings-overview">
        <span className="settings-orb"><Settings size={24} /></span>
        <div>
          <span>{siteName} 控制台偏好</span>
          <strong>{isAccountSyncing ? "正在同步账号和订阅安全信息。" : membershipEnabled ? (hasToken ? "账号、会员和订阅安全由当前会话统一管理。" : "登录后管理账号、会员与订阅安全。") : hasToken ? "账号和订阅安全由当前会话统一管理。" : "登录后管理账号与订阅安全。"}</strong>
          <p>{isAccountSyncing ? "同步期间不会展示过期的订阅判断，数据回来后再显示真实状态。" : hasToken ? "退出会清除本端会话，不影响 admin 端或其他设备。订阅范围、订单和工单会继续保留在账号下。" : "访客可以查看公开套餐；登录后才会显示钱包、订单、订阅链接和工单记录。"}</p>
        </div>
        <button className={hasToken ? "secondary-action" : "primary-action"} onClick={hasToken ? onLogout : onLogin} type="button">
          {hasToken ? <LogOut size={17} /> : <LogIn size={17} />}
          {hasToken ? "退出当前设备" : "登录账号"}
        </button>
      </div>

      <div className="settings-grid">
        <SettingTile
          detail={hasToken ? "会话由本端独立保存，退出只影响 user-web。" : "登录后生成独立的 user 端会话。"}
          icon={<KeyRound size={18} />}
          label="会话安全"
          tone="blue"
          value={hasToken ? "本端有效" : "待登录"}
        />
        {membershipEnabled ? (
          <SettingTile
            detail={isAccountSyncing ? "正在读取会员有效期和订阅购买校验。" : active ? "续费只会延长会员有效期，不会创建第二张卡。" : statusDetail}
            icon={<BadgeCheck size={18} />}
            label="会员身份"
            tone="green"
            value={membershipDetail}
          />
        ) : null}
        <SettingTile
          detail="订阅链接按全部节点、接入方式和自定义预设生成，二维码随范围变化。"
          icon={<Copy size={18} />}
          label="订阅范围"
          tone="violet"
          value="预设化管理"
        />
        <SettingTile
          detail={hasToken ? "订单、工单和订阅状态会在对应页面即时刷新；重要操作会进入账户动态。" : "登录后可查看与你账号相关的订单、工单和订阅变化。"}
          icon={<Bell size={18} />}
          label="账户动态"
          tone="amber"
          value={isAccountSyncing ? "同步中" : hasToken ? "已开启" : "待登录"}
        />
      </div>

      <div className="settings-roadmap">
        <div>
          <strong>当前设备</strong>
          <span>{hasToken ? "user-web 使用独立本地会话，退出只会清理当前浏览器中的用户端登录状态。" : "登录后会在当前浏览器创建 user-web 会话，admin 端会话互不影响。"}</span>
        </div>
        <em>{hasToken ? "会话有效" : "访客模式"}</em>
      </div>
    </article>
  );
}

function SettingTile({ detail, icon, label, tone, value }: { detail: string; icon: ReactNode; label: string; tone: string; value: string }) {
  return (
    <div className={`setting-tile ${tone}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function CheckoutPanel({
  error,
  externalPayment,
  onClose,
  onCreateOrder,
  onPayWithBalance,
  onStartProviderPayment,
  order,
  paymentMethods,
  plan,
  providerBusy,
  status,
}: {
  error: string;
  externalPayment?: ExternalPaymentView;
  onClose: () => void;
  onCreateOrder: () => void;
  onPayWithBalance: () => void;
  onStartProviderPayment: (provider: string) => void;
  order?: OrderSummary;
  paymentMethods: PaymentMethodView[];
  plan: PlanCardView;
  providerBusy: string;
  status: "idle" | "creating" | "created" | "paying" | "paid" | "error";
}) {
  const [paymentQrDataUrl, setPaymentQrDataUrl] = useState("");
  const hasOrder = Boolean(order?.orderNo);
  const canCreate = !hasOrder && status !== "creating" && status !== "paying" && status !== "paid" && Boolean(plan.productId);
  const canPay = hasOrder && status !== "creating" && status !== "paying" && status !== "paid" && !providerBusy;
  const canStartProvider = hasOrder && status !== "creating" && status !== "paying" && status !== "paid" && !providerBusy;
  useEffect(() => {
    let canceled = false;
    const value = externalPayment?.qrcode || "";
    setPaymentQrDataUrl("");
    if (!value) {
      return () => {
        canceled = true;
      };
    }
    QRCodeGenerator.toDataURL(value, {
      color: { dark: "#0f172a", light: "#ffffff" },
      errorCorrectionLevel: "M",
      margin: 1,
      width: 168,
    })
      .then((url) => {
        if (!canceled) {
          setPaymentQrDataUrl(url);
        }
      })
      .catch(() => {
        if (!canceled) {
          setPaymentQrDataUrl("");
        }
      });
    return () => {
      canceled = true;
    };
  }, [externalPayment?.qrcode]);
  return (
    <div className="auth-overlay checkout-overlay" role="presentation">
      <section aria-label="订单支付" className="auth-panel checkout-dialog">
        <div className="auth-heading">
          <span className="auth-icon"><ShoppingBag size={19} /></span>
          <div>
            <span className="eyebrow">结算</span>
            <h2>{status === "paid" ? "权益已经开通" : "确认套餐并创建订单"}</h2>
          </div>
        </div>
        <div className="checkout-summary">
          <span>{plan.name}</span>
          <strong>{plan.price}</strong>
          <small>{plan.meta}</small>
        </div>
        <div className="checkout-progress">
          <StepState active={Boolean(order) || status === "creating" || status === "paid"} label="订单快照" />
          <StepState active={Boolean(order) || status === "paying" || Boolean(externalPayment)} label="选择支付" />
          <StepState active={status === "paid"} label="权益生效" />
        </div>
        {order ? (
          <div className="order-note">
            <span>订单号</span>
            <strong>{order.orderNo}</strong>
            <small>{formatMoney(order.amount)} · {order.itemSnapshot?.name || plan.name}</small>
          </div>
        ) : null}
        <div className="payment-methods">
          {paymentMethods.length ? paymentMethods.map((method) => {
            const balance = method.checkoutFlow === "balance";
            const busy = !balance && providerBusy === method.provider;
            const disabled = balance ? !canPay : !canStartProvider || !method.provider;
            return (
              <button
                className={`payment-method ${method.tone}`}
                disabled={disabled}
                key={method.methodKey}
                onClick={balance ? onPayWithBalance : () => onStartProviderPayment(method.provider)}
                type="button"
              >
                <span className="payment-icon">{balance ? <Wallet size={18} /> : <CreditCard size={18} />}</span>
                <span>
                  <strong>{balance && status === "paying" ? "余额支付中..." : busy ? "生成收银台..." : method.label}</strong>
                  <small>{method.description}</small>
                </span>
              </button>
            );
          }) : (
            <div className="payment-method-empty">
              <CreditCard size={18} />
              <span>当前没有可用支付方式，请稍后再试。</span>
            </div>
          )}
        </div>
        {externalPayment ? (
          <div className="external-payment-card">
            <span>{externalPayment.provider.toUpperCase()} 收银台已生成</span>
            <strong>{externalPayment.providerTradeNo}</strong>
            <small>{dateText(externalPayment.expiredAtUnixMs)} 前有效，支付成功后将由回调自动开通权益。</small>
            {externalPayment.qrcode ? (
              <div className="external-payment-qrcode">
                {paymentQrDataUrl ? <img alt="支付二维码" src={paymentQrDataUrl} /> : <QrCode size={48} />}
                <div>
                  <span>扫码支付</span>
                  <code>{externalPayment.qrcode}</code>
                </div>
              </div>
            ) : null}
            <div className="external-payment-links">
              {externalPayment.checkoutUrl ? (
                <a href={externalPayment.checkoutUrl} rel="noreferrer" target="_blank">
                  打开支付页面
                  <ExternalLink size={15} />
                </a>
              ) : null}
              {externalPayment.urlscheme ? (
                <a href={externalPayment.urlscheme}>
                  打开支付 App
                  <ExternalLink size={15} />
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
        {error ? <p className="auth-error">{error}</p> : null}
        <div className="checkout-actions">
          {status === "paid" ? (
            <button className="primary-action full" onClick={onClose} type="button">完成</button>
          ) : (
            <button className={hasOrder ? "secondary-action full" : "primary-action full"} disabled={!canCreate} onClick={onCreateOrder} type="button">
              {status === "creating" ? "创建中..." : hasOrder ? "订单已创建，请选择支付方式" : "创建订单"}
            </button>
          )}
        </div>
        <div className="auth-switch">
          <button onClick={onClose} type="button">关闭</button>
        </div>
      </section>
    </div>
  );
}

function StepState({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={active ? "step-state active" : "step-state"}>
      <CircleCheck size={14} />
      {label}
    </span>
  );
}

function AuthPanel({
  mode,
  authPolicy,
  onClose,
  onModeChange,
  siteName,
  onSuccess,
}: {
  mode: "login" | "register";
  authPolicy: { registrationEnabled: boolean; passwordMinLength: number; passwordRequireDigit: boolean; passwordRequireLetter: boolean };
  onClose: () => void;
  onModeChange: (mode: "login" | "register") => void;
  siteName: string;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";
  const passwordHint = isRegister ? passwordPolicyText(authPolicy) : "请输入当前密码";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isRegister) {
        if (!authPolicy.registrationEnabled) {
          setError("当前暂未开放注册");
          return;
        }
        await registerUser(email, password, displayName);
      } else {
        await loginUser(email, password);
      }
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "认证失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-overlay" role="presentation">
      <section aria-label={isRegister ? "注册" : "登录"} className="auth-panel">
        <div className="auth-heading">
          <span className="auth-icon">{isRegister ? <UserPlus size={19} /> : <LogIn size={19} />}</span>
          <div>
            <span className="eyebrow">{isRegister ? "创建账户" : "欢迎回来"}</span>
            <h2>{isRegister ? `创建 ${siteName} 账户` : "登录后查看你的订阅"}</h2>
          </div>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {isRegister ? (
            <label>
              <span>显示名称</span>
              <input autoComplete="name" onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 Alex" value={displayName} />
            </label>
          ) : null}
          <label>
            <span>邮箱</span>
            <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" value={email} />
          </label>
          <label>
            <span>密码</span>
            <input autoComplete={isRegister ? "new-password" : "current-password"} onChange={(event) => setPassword(event.target.value)} placeholder={passwordHint} type="password" value={password} />
            {isRegister ? <small>{passwordHint}</small> : null}
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="primary-action full" disabled={busy} type="submit">
            {busy ? "处理中..." : isRegister ? "注册并登录" : "登录"}
          </button>
        </form>
        <div className="auth-switch">
          {isRegister || authPolicy.registrationEnabled ? (
            <button onClick={() => onModeChange(isRegister ? "login" : "register")} type="button">
              {isRegister ? "已有账户，去登录" : "没有账户，创建一个"}
            </button>
          ) : (
            <span>当前暂未开放注册</span>
          )}
          <button onClick={onClose} type="button">稍后再说</button>
        </div>
      </section>
    </div>
  );
}

function passwordPolicyText(policy: { passwordMinLength: number; passwordRequireDigit: boolean; passwordRequireLetter: boolean }): string {
  const rules = [`至少 ${policy.passwordMinLength || 8} 位`];
  if (policy.passwordRequireLetter) {
    rules.push("包含字母");
  }
  if (policy.passwordRequireDigit) {
    rules.push("包含数字");
  }
  return rules.join("，");
}

function OrderDetailPanel({
  detailState,
  onClose,
  order,
}: {
  detailState: { status: "idle" | "loading" | "ready" | "error"; message?: string };
  onClose: () => void;
  order: OrderSummary;
}) {
  const snapshot = order.itemSnapshot;
  const policy = snapshot?.membershipPolicy;
  const facts = snapshot ? orderSnapshotFacts(snapshot) : [];

  return (
    <section className="order-detail-card" aria-label="订单详情">
      <div className="order-detail-heading">
        <div>
          <span className="eyebrow">Order snapshot</span>
          <h3>{snapshot?.name || "订单详情"}</h3>
        </div>
        <button aria-label="关闭订单详情" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </div>
      <div className="order-detail-summary">
        <div>
          <span>订单金额</span>
          <strong>{formatMoney(order.amount)}</strong>
        </div>
        <em className={`order-status ${orderStatusTone(order.status)}`}>{orderStatusLabel(order.status)}</em>
      </div>
      <div className="order-detail-meta">
        <span>{order.orderNo}</span>
        <span>创建 {dateText(order.createdAtUnixMs)}</span>
        {order.paidAtUnixMs ? <span>支付 {dateText(order.paidAtUnixMs)}</span> : null}
      </div>
      {detailState.status === "loading" ? <p className="order-detail-state">正在读取订单快照...</p> : null}
      {detailState.status === "error" ? <p className="order-detail-state error">{detailState.message}</p> : null}
      {snapshot ? (
        <>
          <div className="order-detail-grid">
            {facts.map((fact) => (
              <div className="order-detail-fact" key={fact.label}>
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
              </div>
            ))}
          </div>
          <div className="snapshot-footnote">
            <span>商品 ID {snapshot.productId.toString()}</span>
            <span>版本 ID {snapshot.productVersionId.toString()}</span>
            {policy ? <span>会员超期容忍 {policy.maxSubscriptionExpiryOverrunDays} 天</span> : null}
          </div>
        </>
      ) : (
        <p className="order-detail-state">这个订单暂时没有商品快照。</p>
      )}
    </section>
  );
}

function orderSnapshotFacts(snapshot: ProductSnapshot): Array<{ label: string; value: string }> {
  const base = [{ label: "商品类型", value: productKindLabel(snapshot.kind) }];
  switch (snapshot.kind) {
    case ProductKind.MEMBERSHIP:
      return [
        ...base,
        { label: "会员有效期", value: snapshot.durationMonths ? `${snapshot.durationMonths} 个月` : "未配置" },
        { label: "库存", value: snapshot.stockLimit ? `${snapshot.stockUsed}/${snapshot.stockLimit}` : "不限" },
        { label: "有效名额", value: snapshot.activeLimit ? `${snapshot.activeCount}/${snapshot.activeLimit}` : "不限" },
        { label: "快照版本", value: `v${snapshot.version || 1}` },
      ];
    case ProductKind.TRAFFIC_RESET:
      return [
        ...base,
        { label: "生效方式", value: "一次性重置当前有效订阅流量" },
        { label: "快照版本", value: `v${snapshot.version || 1}` },
      ];
    case ProductKind.SUBSCRIPTION:
    default:
      return [
        ...base,
        { label: "周期", value: snapshot.durationMonths ? `${snapshot.durationMonths} 个月` : "未配置" },
        { label: "流量", value: snapshot.trafficBytes ? formatBytes(snapshot.trafficBytes) : "未配置" },
        { label: "速度", value: formatSpeed(snapshot.speedLimitBps) || "未限制" },
        { label: "设备", value: snapshot.deviceLimit ? `${snapshot.deviceLimit} 台` : "未限制" },
        { label: "快照版本", value: `v${snapshot.version || 1}` },
      ];
  }
}

function isMembershipOrder(order: OrderSummary): boolean {
  return order.itemSnapshot?.kind === ProductKind.MEMBERSHIP;
}

function visibleOrdersForFeatureFlags(orders: OrderSummary[], membershipEnabled: boolean): OrderSummary[] {
  return membershipEnabled ? orders : orders.filter((order) => !isMembershipOrder(order));
}

function Activity({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="activity-row">
      <span className="activity-icon">{icon}</span>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function SupportPanel({
  category,
  categories,
  detailState,
  hasMore,
  hasToken,
  message,
  messages,
  onCategoryChange,
  onLoadMore,
  onLogin,
  onMessageChange,
  onPriorityChange,
  onReply,
  onReplyChange,
  onSelectTicket,
  onSubmit,
  onSubjectChange,
  priority,
  priorityOptions,
  reply,
  selectedTicket,
  state,
  subject,
  supportPolicy,
  tickets,
}: {
  category: string;
  categories: Array<{ key: string; label: string }>;
  detailState: { status: "idle" | "loading" | "replying" | "error" | "saved"; message?: string };
  hasMore: boolean;
  hasToken: boolean;
  message: string;
  messages: SupportTicketMessage[];
  onCategoryChange: (value: string) => void;
  onLoadMore: () => void;
  onLogin: () => void;
  onMessageChange: (value: string) => void;
  onPriorityChange: (value: string) => void;
  onReply: (event: FormEvent<HTMLFormElement>) => void;
  onReplyChange: (value: string) => void;
  onSelectTicket: (ticket: SupportTicket) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSubjectChange: (value: string) => void;
  priority: string;
  priorityOptions: Array<{ key: string; label: string }>;
  reply: string;
  selectedTicket?: SupportTicket;
  state: { status: "idle" | "loading" | "creating" | "error"; message?: string };
  subject: string;
  supportPolicy: ReturnType<typeof defaultSupportPolicyView>;
  tickets: SupportTicket[];
}) {
  const subjectLength = visibleTextLength(subject);
  const messageLength = visibleTextLength(message);
  const replyLength = visibleTextLength(reply);
  const ticketReady = (
    hasToken &&
    visibleTextLength(subject.trim()) >= supportPolicy.subjectMinLength &&
    visibleTextLength(subject.trim()) <= supportPolicy.subjectMaxLength &&
    visibleTextLength(message.trim()) >= supportPolicy.messageMinLength &&
    visibleTextLength(message.trim()) <= supportPolicy.messageMaxLength
  );
  const replyReady = (
    hasToken &&
    selectedTicket?.status !== "closed" &&
    visibleTextLength(reply.trim()) >= supportPolicy.messageMinLength &&
    visibleTextLength(reply.trim()) <= supportPolicy.messageMaxLength
  );
  return (
    <div className="support-workbench">
      <div className="support-guides">
        <Activity icon={<HelpCircle size={15} />} title="文档中心" detail="订阅导入、客户端配置和常见错误" />
        <Activity icon={<Settings size={15} />} title="工单支持" detail="账户、支付、节点连接问题可集中处理" />
        <Activity icon={<ShieldCheck size={15} />} title="账户安全" detail="登录状态、会员权益和订阅链接保护" />
      </div>
      <form className="support-form" onSubmit={onSubmit}>
        <div className="support-form-heading">
          <span className="eyebrow">工单</span>
          <strong>提交新的支持请求</strong>
        </div>
        <label>
          <span>问题标题</span>
          <input
            disabled={!hasToken || state.status === "creating"}
            maxLength={supportPolicy.subjectMaxLength}
            minLength={supportPolicy.subjectMinLength}
            onChange={(event) => onSubjectChange(event.target.value)}
            placeholder="例如 Clash 无法导入订阅"
            value={subject}
          />
          <small className="input-hint">
            {supportPolicy.subjectMinLength}-{supportPolicy.subjectMaxLength} 字 · 已输入 {subjectLength} 字
          </small>
        </label>
        <div className="support-form-row">
          <label>
            <span>分类</span>
            <select disabled={!hasToken || state.status === "creating"} onChange={(event) => onCategoryChange(event.target.value)} value={category}>
              {categories.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>优先级</span>
            <select disabled={!hasToken || state.status === "creating"} onChange={(event) => onPriorityChange(event.target.value)} value={priority}>
              {priorityOptions.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span>问题描述</span>
          <textarea
            disabled={!hasToken || state.status === "creating"}
            maxLength={supportPolicy.messageMaxLength}
            minLength={supportPolicy.messageMinLength}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="请描述客户端、节点、错误提示和发生时间。"
            value={message}
          />
          <small className="input-hint">
            {supportPolicy.messageMinLength}-{supportPolicy.messageMaxLength} 字 · 已输入 {messageLength} 字
          </small>
        </label>
        {state.message ? <p className={state.status === "error" ? "link-feedback error" : "link-feedback"}>{state.message}</p> : null}
        <button className="primary-action full" disabled={!ticketReady || state.status === "creating"} type="submit">
          <Ticket size={17} />
          {state.status === "creating" ? "提交中..." : hasToken ? (ticketReady ? "提交工单" : "填写后提交") : "登录后提交"}
        </button>
        {!hasToken ? <button className="secondary-action full" onClick={onLogin} type="button">登录账号</button> : null}
      </form>
      <div className="support-ticket-list">
        <div className="support-list-heading">
          <strong>我的工单</strong>
          <span>{hasToken ? `${tickets.length} 条` : "登录后查看"}</span>
        </div>
        {tickets.length ? (
          tickets.map((ticket) => (
            <button
              className={`support-ticket-row ${selectedTicket?.id === ticket.id ? "active" : ""}`}
              key={ticket.id.toString()}
              onClick={() => onSelectTicket(ticket)}
              type="button"
            >
              <div>
                <strong>{ticket.subject}</strong>
                <span>{ticket.category} · {supportStatusLabel(ticket.status)} · {dateText(ticket.updatedAtUnixMs)}</span>
              </div>
              <em className={`support-status ${ticket.status}`}>{supportStatusLabel(ticket.status)}</em>
              <p>{ticket.latestMessage}</p>
            </button>
          ))
        ) : (
          <div className="support-empty">
            <Ticket size={18} />
            <strong>{hasToken ? "还没有工单" : "登录后显示你的工单"}</strong>
            <span>{hasToken ? "遇到连接、支付或账户问题时，可以从这里提交。" : "工单只读取当前账户，不展示预览数据。"}</span>
          </div>
        )}
        {hasMore ? <button className="order-more" disabled={state.status === "loading"} onClick={onLoadMore} type="button">{state.status === "loading" ? "加载中..." : "加载更多工单"}</button> : null}
        <div className="support-thread">
          {selectedTicket ? (
            <>
              <div className="support-thread-heading">
                <div>
                  <span className={`support-status ${selectedTicket.status}`}>{supportStatusLabel(selectedTicket.status)}</span>
                  <strong>{selectedTicket.subject}</strong>
                </div>
                <small>{selectedTicket.category} · {selectedTicket.priority}</small>
              </div>
              <div className="support-message-list">
                {detailState.status === "loading" ? (
                  <div className="support-empty compact">
                    <Ticket size={17} />
                    <strong>正在读取会话</strong>
                  </div>
                ) : messages.length ? (
                  messages.map((item) => (
                    <div className={`support-message ${item.authorRole === "admin" ? "admin" : "user"}`} key={item.id.toString()}>
                      <span>{item.authorRole === "admin" ? "客服" : "你"} · {dateText(item.createdAtUnixMs)}</span>
                      <p>{item.body}</p>
                    </div>
                  ))
                ) : (
                  <div className="support-empty compact">
                    <Ticket size={17} />
                    <strong>暂无会话记录</strong>
                    <span>新工单已创建，后续消息会显示在这里。</span>
                  </div>
                )}
              </div>
              <form className="support-reply-form" onSubmit={onReply}>
                <label>
                  <span>继续补充</span>
                  <textarea
                    disabled={!hasToken || detailState.status === "replying" || selectedTicket.status === "closed"}
                    maxLength={supportPolicy.messageMaxLength}
                    minLength={supportPolicy.messageMinLength}
                    onChange={(event) => onReplyChange(event.target.value)}
                    placeholder={selectedTicket.status === "closed" ? "工单已关闭，暂不能继续回复。" : "补充错误截图、客户端日志或你的处理结果。"}
                    value={reply}
                  />
                  <small className="input-hint">
                    {supportPolicy.messageMinLength}-{supportPolicy.messageMaxLength} 字 · 已输入 {replyLength} 字
                  </small>
                </label>
                {detailState.message ? <p className={detailState.status === "error" ? "link-feedback error" : "link-feedback"}>{detailState.message}</p> : null}
                <button className="primary-action full" disabled={!replyReady || detailState.status === "replying" || selectedTicket.status === "closed"} type="submit">
                  <Ticket size={17} />
                  {detailState.status === "replying" ? "发送中..." : selectedTicket.status === "closed" ? "工单已关闭" : replyReady ? "发送回复" : "填写后发送"}
                </button>
              </form>
            </>
          ) : (
            <div className="support-empty compact">
              <Ticket size={17} />
              <strong>{hasToken ? "选择一个工单查看会话" : "登录后可查看完整会话"}</strong>
              <span>{hasToken ? "列表中的每条工单都可以打开详情并继续回复。" : "会话内容只属于当前账户。"}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SubscriptionQrPreview({ tone, value }: { tone: ScopeChoice["tone"]; value: string }) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    let canceled = false;
    setDataUrl("");
    if (!value) {
      return () => {
        canceled = true;
      };
    }
    QRCodeGenerator.toDataURL(value, {
      color: { dark: "#111827", light: "#ffffff" },
      errorCorrectionLevel: "M",
      margin: 1,
      width: 180,
    })
      .then((url) => {
        if (!canceled) {
          setDataUrl(url);
        }
      })
      .catch(() => {
        if (!canceled) {
          setDataUrl("");
        }
      });
    return () => {
      canceled = true;
    };
  }, [value]);

  return (
    <div className={`subscription-qr-preview ${tone}`} aria-label="subscription qr code">
      {dataUrl ? (
        <img alt="订阅二维码" src={dataUrl} />
      ) : (
        <div className="qr-grid" aria-hidden="true">
          {qrCells.map((filled, index) => (
            <span className={filled ? "filled" : ""} key={index} />
          ))}
        </div>
      )}
    </div>
  );
}

function useUserPortalDashboard(revision: number) {
  const [state, setState] = useState<{ data?: UserPortalDashboard; status: "loading" | "live" | "partial" | "fallback"; error?: string }>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    setState((current) => ({ data: current.data, status: "loading" }));
    loadUserPortalDashboard()
      .then((data) => {
        if (active) {
          setState({ data, status: data.source });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "fallback", error: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);

  return state;
}

function useSubscriptionScopes(subscriptionId: bigint | undefined, revision: number, initialData?: ListSubscriptionScopesResponse) {
  const [state, setState] = useState<{ data?: ListSubscriptionScopesResponse; status: "idle" | "loading" | "ready" | "error"; error?: string }>({
    status: "idle",
  });
  const subscriptionKey = subscriptionId?.toString() || "";

  useEffect(() => {
    if (!subscriptionKey || !subscriptionId) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState((current) => ({
      data: initialData || current.data,
      status: initialData ? "ready" : "loading",
    }));
    listUserSubscriptionScopes(subscriptionId)
      .then((data) => {
        if (!cancelled) {
          setState({ data, status: "ready" });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", error: errorMessage(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialData, revision, subscriptionId, subscriptionKey]);

  return state;
}

function scopeChoicesFromView(view?: ListSubscriptionScopesResponse, presetsOverride?: SubscriptionPresetSummary[]): ScopeChoice[] {
  if (!view) {
    return [];
  }
  const choices: ScopeChoice[] = [
    {
      id: "all",
      key: "",
      kind: "all",
      label: "全部节点",
      nodeCount: view.nodes.length,
      tone: "blue",
    },
  ];
  view.profiles.forEach((profile, index) => {
    choices.push({
      id: `profile:${profile.profileKey}`,
      key: profile.profileKey,
      kind: "profile",
      label: accessProfileDisplayName(profile.label, profile.profileKey),
      nodeCount: profile.nodeCount,
      tone: index % 2 === 0 ? "green" : "amber",
    });
  });
  (presetsOverride || view.presets.filter((preset) => preset.enabled)).forEach((preset) => {
    choices.push({
      id: `preset:${preset.presetKey}`,
      key: preset.presetKey,
      kind: "preset",
      label: preset.name,
      nodeCount: preset.nodeCount,
      tone: "violet",
    });
  });
  return choices;
}

function mergePresetSummaries(backend: SubscriptionPresetSummary[], local: SubscriptionPresetSummary[]): SubscriptionPresetSummary[] {
  if (!local.length) {
    return backend;
  }
  const byKey = new Map<string, SubscriptionPresetSummary>();
  for (const preset of backend) {
    byKey.set(preset.presetKey, preset);
  }
  for (const preset of local) {
    if (preset.enabled) {
      byKey.set(preset.presetKey, preset);
    }
  }
  return Array.from(byKey.values());
}

function profileLabelForNode(node: SubscriptionScopeNode): string {
  const protocol = node.protocol ? accessProfileTokenLabel(node.protocol.toLowerCase()) : "节点";
  const transport = node.transport ? ` ${accessProfileTokenLabel(node.transport.toLowerCase())}` : "";
  return `${protocol}${transport}`;
}

function accessProfileDisplayName(label: string, key: string): string {
  const value = (label || key).trim();
  if (!value) {
    return "自定义接入";
  }
  const normalized = value.toLowerCase();
  if (label && label !== key && !normalized.startsWith("default-") && !normalized.startsWith("default_")) {
    return value;
  }
  const tokens = normalized
    .replace(/^default[-_\s]+/, "")
    .split(/[-_\s/]+/)
    .filter(Boolean);
  if (!tokens.length) {
    return value;
  }
  return tokens.map(accessProfileTokenLabel).join(" ");
}

function accessProfileTokenLabel(token: string): string {
  switch (token) {
    case "grpc":
      return "gRPC";
    case "xhttp":
      return "XHTTP";
    case "httpupgrade":
      return "HTTPUpgrade";
    case "hysteria2":
    case "hy2":
      return "Hysteria2";
    case "vless":
    case "vmess":
    case "trojan":
    case "shadowsocks":
    case "tcp":
    case "udp":
    case "tls":
      return token.toUpperCase();
    case "ws":
      return "WebSocket";
    case "reality":
      return "Reality";
    default:
      return token.charAt(0).toUpperCase() + token.slice(1);
  }
}

function nodeMatchesSearch(node: SubscriptionScopeNode, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [node.name, node.serverName, node.regionCode, node.profileKey, node.protocol, node.transport]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function groupNodesForSubscription(nodes: SubscriptionScopeNode[]): Array<{ label: string; nodes: SubscriptionScopeNode[] }> {
  const groups = new Map<string, SubscriptionScopeNode[]>();
  for (const node of nodes) {
    const label = node.serverName || node.regionCode || "默认服务";
    const items = groups.get(label);
    if (items) {
      items.push(node);
    } else {
      groups.set(label, [node]);
    }
  }
  return Array.from(groups.entries()).map(([label, groupedNodes]) => ({ label, nodes: groupedNodes }));
}

function nodesForScope(nodes: SubscriptionScopeNode[], scope: ScopeChoice, presets: SubscriptionPresetSummary[]): SubscriptionScopeNode[] {
  if (scope.kind === "all") {
    return nodes;
  }
  if (scope.kind === "profile") {
    return nodes.filter((node) => node.profileKey === scope.key);
  }
  const preset = presets.find((item) => item.presetKey === scope.key);
  if (!preset) {
    return [];
  }
  const nodeById = new Map(nodes.map((node) => [node.nodeId.toString(), node]));
  const items = preset.nodeItems.length
    ? preset.nodeItems
    : preset.nodeIds.map((nodeId, index) => ({ displayName: "", nodeId, sortOrder: index }));
  return items
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => {
      const node = nodeById.get(item.nodeId.toString());
      if (!node) {
        return undefined;
      }
      return item.displayName.trim() ? { ...node, name: item.displayName.trim() } : node;
    })
    .filter((node): node is SubscriptionScopeNode => Boolean(node));
}

function uniqueSubscriptionSummaries(items: SubscriptionSummary[]): SubscriptionSummary[] {
  const seen = new Set<string>();
  const out: SubscriptionSummary[] = [];
  for (const item of items) {
    const key = item.id.toString();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function planCards(plans?: PortalPlan[]): PlanCardView[] {
  if (!plans?.length) {
    return fallbackPlans;
  }
  return plans.slice(0, 3).map((plan, index) => ({
    canPurchase: plan.canPurchase,
    kind: plan.kind,
    name: plan.name,
    price: formatMoney(plan.monthlyPrice) || "$0.00",
    productId: plan.id,
    activeCount: plan.activeCount,
    activeLimit: plan.activeLimit,
    stockLimit: plan.stockLimit,
    stockUsed: plan.stockUsed,
    meta: planMeta(plan),
    tone: index === 0 ? "blue" : index === 1 ? "green" : "amber",
    featured: plan.canPurchase && index === 1,
    unavailableReason: plan.unavailableReason,
  }));
}

function planMeta(plan: PortalPlan): string {
  if (plan.kind === ProductKind.MEMBERSHIP) {
    const parts = [`会员资格 · ${plan.durationMonths || 12} 个月`];
    if (plan.stockLimit) {
      parts.push(`剩余 ${Math.max(0, plan.stockLimit - plan.stockUsed)}`);
    }
    if (plan.activeLimit) {
      parts.push(`名额 ${Math.max(0, plan.activeLimit - plan.activeCount)}`);
    }
    return parts.join(" · ");
  }
  if (plan.kind === ProductKind.TRAFFIC_RESET) {
    return plan.highlights[0] || "一次性流量重置 · 不改变订阅周期";
  }
  const traffic = formatBytes(plan.trafficBytes);
  const speed = formatSpeed(plan.speedLimitBps);
  return [traffic, speed].filter(Boolean).join(" · ") || plan.highlights[0] || "可购买套餐";
}

function paymentMethodViews(methods?: PaymentMethod[]): PaymentMethodView[] {
  if (!methods?.length) {
    return [];
  }
  return methods
    .filter((method) => method.methodKey || method.provider || method.checkoutFlow)
    .map((method) => {
      const checkoutFlow = method.checkoutFlow || "redirect";
      const provider = method.provider || (checkoutFlow === "balance" ? "balance" : "");
      return {
        checkoutFlow,
        description: method.description || paymentMethodFallbackDescription(checkoutFlow),
        label: method.label || paymentMethodFallbackLabel(provider, checkoutFlow),
        methodKey: method.methodKey || provider || checkoutFlow,
        provider,
        tone: paymentMethodTone(provider, checkoutFlow),
      };
    });
}

function paymentMethodFallbackLabel(provider: string, checkoutFlow: string): string {
  if (checkoutFlow === "balance" || provider === "balance") {
    return "余额支付";
  }
  if (provider === "stripe") {
    return "Stripe";
  }
  if (provider === "epay") {
    return "EPay";
  }
  if (provider === "sandbox") {
    return "Sandbox";
  }
  if (provider === "custom") {
    return "外部支付";
  }
  return provider ? provider.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "外部支付";
}

function paymentMethodFallbackDescription(checkoutFlow: string): string {
  if (checkoutFlow === "balance") {
    return "余额充足时即时开通权益";
  }
  if (checkoutFlow === "api") {
    return "生成支付链接、二维码或 App 唤起链接";
  }
  return "跳转到配置的收银台完成支付";
}

function paymentMethodTone(provider: string, checkoutFlow: string): PaymentMethodView["tone"] {
  if (checkoutFlow === "balance" || provider === "balance") {
    return "green";
  }
  if (provider === "stripe") {
    return "blue";
  }
  if (provider === "epay") {
    return "amber";
  }
  if (provider === "sandbox") {
    return "amber";
  }
  return "violet";
}

function subscriptionUsageValues(subscription?: SubscriptionSummary) {
  if (!subscription || subscription.totalBytes === 0n) {
    return { percent: 0, remaining: 0n, total: subscription?.totalBytes || 0n, used: 0n };
  }
  const used = (subscription.used?.upload || 0n) + (subscription.used?.download || 0n);
  const total = subscription.totalBytes;
  const remaining = total > used ? total - used : 0n;
  const percent = Number((used * 100n) / total);
  return {
    percent: Math.max(0, Math.min(100, percent)),
    remaining,
    total,
    used,
  };
}

function subscriptionUsage(subscription?: SubscriptionSummary): SubscriptionUsageView {
  const unavailable = { used: "0 B", total: "登录后查看", remaining: "待登录", percent: 0 };
  if (!subscription) {
    return unavailable;
  }
  if (subscription.totalBytes === 0n) {
    return { used: "0 B", total: "未配置", remaining: "未配置", percent: 0 };
  }
  const usage = subscriptionUsageValues(subscription);
  return {
    used: formatBytes(usage.used),
    total: formatBytes(usage.total),
    remaining: formatBytes(usage.remaining),
    percent: usage.percent,
  };
}

function aggregateSubscriptionUsage(subscriptions: SubscriptionSummary[]): SubscriptionUsageView {
  if (!subscriptions.length) {
    return { used: "0 B", total: "登录后查看", remaining: "待登录", percent: 0 };
  }
  const metered = subscriptions.filter((subscription) => subscription.totalBytes > 0n);
  if (!metered.length) {
    return { used: "0 B", total: "未配置", remaining: "未配置", percent: 0 };
  }
  const totals = metered.reduce(
    (acc, subscription) => {
      const usage = subscriptionUsageValues(subscription);
      return {
        remaining: acc.remaining + usage.remaining,
        total: acc.total + usage.total,
        used: acc.used + usage.used,
      };
    },
    { remaining: 0n, total: 0n, used: 0n },
  );
  const percent = totals.total > 0n ? Number((totals.used * 100n) / totals.total) : 0;
  return {
    percent: Math.max(0, Math.min(100, percent)),
    remaining: formatBytes(totals.remaining),
    total: formatBytes(totals.total),
    used: formatBytes(totals.used),
  };
}

function buildConnectionOverview(
  subscriptions: SubscriptionSummary[],
  state: { hasSession: boolean; isAccountSyncing: boolean },
): ConnectionOverviewView {
  if (state.isAccountSyncing) {
    return {
      body: "正在读取订阅、流量和到期信息。同步完成后会自动更新这里的连接健康状态。",
      highlights: [
        { detail: "账户资料", label: "同步", value: "进行中" },
        { detail: "订阅信息", label: "订阅", value: "读取中" },
        { detail: "流量统计", label: "用量", value: "读取中" },
      ],
      primaryAction: "稍候",
      secondaryAction: "浏览套餐",
      title: "正在同步账户状态。",
      tone: "blue",
    };
  }
  if (!state.hasSession) {
    return {
      body: "登录后会汇总所有订阅的可用状态、最早到期时间和剩余流量风险。",
      highlights: [
        { detail: "登录后可见", label: "订阅", value: "-" },
        { detail: "登录后可见", label: "到期", value: "-" },
        { detail: "登录后可见", label: "流量", value: "-" },
      ],
      primaryAction: "登录查看",
      secondaryAction: "浏览套餐",
      title: "登录后查看连接状态。",
      tone: "blue",
    };
  }
  if (!subscriptions.length) {
    return {
      body: "选择套餐后，这里会显示整体连接健康、到期提醒和流量风险。",
      highlights: [
        { detail: "生效中 / 全部", label: "可用订阅", value: "0/0" },
        { detail: "购买后显示", label: "最早到期", value: "-" },
        { detail: "购买后显示", label: "最低剩余", value: "-" },
      ],
      primaryAction: "选择套餐",
      secondaryAction: "浏览套餐",
      title: "还没有可用订阅。",
      tone: "amber",
    };
  }

  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "active");
  const earliestExpiry = activeSubscriptions
    .filter((subscription) => subscription.expiredAtUnixMs > 0n)
    .sort((a, b) => Number(a.expiredAtUnixMs - b.expiredAtUnixMs))[0];
  const lowestTraffic = activeSubscriptions
    .filter((subscription) => subscription.totalBytes > 0n)
    .map((subscription) => ({ subscription, usage: subscriptionUsageValues(subscription) }))
    .sort((a, b) => Number(a.usage.remaining - b.usage.remaining))[0];
  const expiringDays = earliestExpiry ? daysUntil(earliestExpiry.expiredAtUnixMs) : 0;
  const hasExpiringWarning = Boolean(earliestExpiry && expiringDays <= 7);
  const hasTrafficWarning = Boolean(lowestTraffic && lowestTraffic.usage.percent >= 90);
  const inactiveCount = subscriptions.length - activeSubscriptions.length;
  const tone: ScopeChoice["tone"] = activeSubscriptions.length === 0 || hasExpiringWarning || hasTrafficWarning ? "amber" : "green";
  const warningParts = [
    activeSubscriptions.length === 0 ? "没有生效中的订阅" : "",
    hasExpiringWarning ? `${earliestExpiry?.name || "订阅"} 即将到期` : "",
    hasTrafficWarning ? `${lowestTraffic?.subscription.name || "订阅"} 流量偏低` : "",
  ].filter(Boolean);
  return {
    body: warningParts.length
      ? `${warningParts.join("，")}。进入订阅页可以处理链接、预设和节点范围。`
      : "全部生效订阅状态正常。复制链接、二维码和自定义预设仍在订阅页集中管理。",
    highlights: [
      { detail: inactiveCount ? `${inactiveCount} 个非生效` : "生效中 / 全部", label: "可用订阅", value: `${activeSubscriptions.length}/${subscriptions.length}` },
      {
        detail: earliestExpiry ? `${expiringDays} 天后 · ${dateText(earliestExpiry.expiredAtUnixMs)}` : "无生效订阅",
        label: "最早到期",
        value: earliestExpiry?.name || "-",
      },
      {
        detail: lowestTraffic ? `剩余 ${formatBytes(lowestTraffic.usage.remaining)}` : "未配置流量上限",
        label: "最低剩余",
        value: lowestTraffic?.subscription.name || "-",
      },
    ],
    primaryAction: activeSubscriptions.length ? "管理订阅" : "选择套餐",
    secondaryAction: "继续购买",
    title: warningParts.length ? "有订阅需要处理。" : "连接状态正常。",
    tone,
  };
}

function formatMoney(value?: { currency: string; amountMinor: bigint | number }): string {
  if (!value) {
    return "";
  }
  const amount = Number(value.amountMinor) / 100;
  const symbol = value.currency === "USD" ? "$" : `${value.currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

function formatBytes(value: bigint): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Number(value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const fractionDigits = unit <= 1 ? 0 : amount >= 100 ? 0 : 2;
  return `${amount.toFixed(fractionDigits)} ${units[unit]}`;
}

function formatSpeed(value: bigint): string {
  if (value === 0n) {
    return "";
  }
  const mbps = Number(value) / 1_000_000;
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(mbps >= 10_000 ? 0 : 1)} Gbps`;
  }
  return `${Math.round(mbps)} Mbps`;
}

function nodeCountPhrase(value: string): string {
  if (!value || value === "-") {
    return "暂无节点";
  }
  if (/^\d+$/.test(value)) {
    return `${value} 个节点`;
  }
  if (value === "失败") {
    return "节点加载失败";
  }
  return value;
}

function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.PAID:
      return "已支付";
    case OrderStatus.CANCELED:
      return "已取消";
    case OrderStatus.FAILED:
      return "失败";
    case OrderStatus.PENDING:
      return "待支付";
    default:
      return "未知";
  }
}

function subscriptionStatusLabel(status?: string): string {
  switch (status) {
    case "active":
      return "生效中";
    case "expired":
      return "已过期";
    case "paused":
      return "已暂停";
    case "disabled":
      return "已停用";
    case "":
    case undefined:
      return "";
    default:
      return status;
  }
}

function supportStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return "已打开";
    case "pending_user":
      return "待你回复";
    case "pending_admin":
      return "等待客服";
    case "closed":
      return "已关闭";
    default:
      return status || "未知";
  }
}

const supportPriorityOptions = [
  { key: "normal", label: "普通" },
  { key: "high", label: "较高" },
  { key: "urgent", label: "紧急" },
];

function defaultSupportPolicyView() {
  return {
    categories: [
      { key: "connection", label: "连接问题" },
      { key: "billing", label: "支付订单" },
      { key: "account", label: "账户安全" },
      { key: "general", label: "其他" },
    ],
    defaultPriority: "normal",
    subjectMinLength: 4,
    subjectMaxLength: 160,
    messageMinLength: 2,
    messageMaxLength: 4000,
  };
}

function validateSupportTicketInput(subject: string, message: string, policy: ReturnType<typeof defaultSupportPolicyView>): string {
  const subjectLength = visibleTextLength(subject.trim());
  if (subjectLength < policy.subjectMinLength || subjectLength > policy.subjectMaxLength) {
    return `问题标题需要 ${policy.subjectMinLength}-${policy.subjectMaxLength} 字。`;
  }
  return validateSupportMessageInput(message, policy);
}

function validateSupportMessageInput(message: string, policy: ReturnType<typeof defaultSupportPolicyView>): string {
  const messageLength = visibleTextLength(message.trim());
  if (messageLength < policy.messageMinLength || messageLength > policy.messageMaxLength) {
    return `问题描述需要 ${policy.messageMinLength}-${policy.messageMaxLength} 字。`;
  }
  return "";
}

function visibleTextLength(value: string): number {
  return Array.from(value).length;
}

function orderStatusTone(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.PAID:
      return "paid";
    case OrderStatus.CANCELED:
      return "canceled";
    case OrderStatus.FAILED:
      return "failed";
    default:
      return "pending";
  }
}

function productKindLabel(kind: ProductKind): string {
  switch (kind) {
    case ProductKind.MEMBERSHIP:
      return "会员卡";
    case ProductKind.SUBSCRIPTION:
      return "订阅套餐";
    case ProductKind.TRAFFIC_RESET:
      return "流量重置";
    default:
      return "商品";
  }
}

function dateText(value: bigint): string {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(Number(value));
}

function daysUntil(value: bigint): number {
  if (!value) {
    return 0;
  }
  const diff = Number(value) - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function userRouteHero(
  route: UserRoute,
  fallback: { connectionSummary: string; heroTitle: string; primaryCopyText: string; scopeTone: ScopeChoice["tone"]; secondaryCopyText: string },
): { body: string; eyebrow: string; heading: string; primaryIcon: ReactNode; primaryText: string; secondaryIcon: ReactNode; secondaryText: string; tone?: ScopeChoice["tone"] } {
  switch (route) {
    case "auth":
      return {
        body: "登录注册使用同一个轻量入口。user 端会话独立保存，不会和 admin 端互相污染，退出只影响当前浏览器。",
        eyebrow: "账户",
        heading: "先确认身份，再进入你的控制台。",
        primaryIcon: <LogIn size={18} />,
        primaryText: "登录",
        secondaryIcon: <UserPlus size={18} />,
        secondaryText: "注册",
      };
    case "subscriptions":
      return {
        body: "按全部节点、接入方式或自定义预设生成链接。你只需要选择范围，系统会处理节点和 inbound 关系。",
        eyebrow: "我的订阅",
        heading: "订阅链接清楚可控，不暴露复杂细节。",
        primaryIcon: <Copy size={18} />,
        primaryText: fallback.primaryCopyText,
        secondaryIcon: <QrCode size={18} />,
        secondaryText: fallback.secondaryCopyText,
        tone: fallback.scopeTone,
      };
    case "plans":
      return {
        body: "购买先校验会员权益，再创建订单快照。价格、周期、流量、速度和策略都会随订单保存，后续商品调整不污染历史。",
        eyebrow: "购买",
        heading: "先锁定订单快照，再安心完成支付。",
        primaryIcon: <ShoppingBag size={18} />,
        primaryText: "查看套餐",
        secondaryIcon: <ReceiptText size={18} />,
        secondaryText: "查看订单",
      };
    case "checkout":
      return {
        body: "结算页只承载真实下单链路。直接访问时展示流程说明，选择套餐后再创建订单、选择余额或外部支付。",
        eyebrow: "结算",
        heading: "支付前先确认套餐，再生成订单快照。",
        primaryIcon: <ShoppingBag size={18} />,
        primaryText: "选择套餐",
        secondaryIcon: <ReceiptText size={18} />,
        secondaryText: "查看订单",
      };
    case "membership":
      return {
        body: "Moment 采用一人一卡模型。会员卡续费只延长有效期，订阅商品购买会先校验会员状态，再创建订单快照。",
        eyebrow: "会员卡",
        heading: "先拥有会员身份，再选择订阅套餐。",
        primaryIcon: <RefreshCw size={18} />,
        primaryText: "刷新会员",
        secondaryIcon: <ShoppingBag size={18} />,
        secondaryText: "查看套餐",
      };
    case "wallet":
      return {
        body: "余额、赠送金、佣金和订单记录放在同一个财务视角里，方便用户自己核对每一次支付和权益变化。",
        eyebrow: "钱包",
        heading: "账户资金要一眼看清，也要经得起对账。",
        primaryIcon: <RefreshCw size={18} />,
        primaryText: "刷新钱包",
        secondaryIcon: <ShoppingBag size={18} />,
        secondaryText: "继续购买",
      };
    case "orders":
      return {
        body: "查看金额、支付状态、创建时间和权益参数。商品之后改价或调整流量，也不会污染这里的历史订单。",
        eyebrow: "订单中心",
        heading: "每一笔订单都保留当时的商品快照。",
        primaryIcon: <RefreshCw size={18} />,
        primaryText: "刷新订单",
        secondaryIcon: <ShoppingBag size={18} />,
        secondaryText: "继续购买",
      };
    case "support":
      return {
        body: "把订阅导入、支付、账户安全和工单入口收在一个轻量页面里，用户遇到问题时不用在控制台里找路。",
        eyebrow: "帮助",
        heading: "遇到问题时，下一步应该很明确。",
        primaryIcon: <RefreshCw size={18} />,
        primaryText: "刷新状态",
        secondaryIcon: <LayoutDashboard size={18} />,
        secondaryText: "回到订阅",
      };
    case "settings":
      return {
        body: "账号设置不应该堆满无效开关。Moment 会先展示会话、会员、订阅范围和提醒偏好，再逐步接入真实可操作项。",
        eyebrow: "设置",
        heading: "把账号控制权放在清楚的位置。",
        primaryIcon: <RefreshCw size={18} />,
        primaryText: "刷新设置",
        secondaryIcon: <HelpCircle size={18} />,
        secondaryText: "查看帮助",
      };
    default:
      return {
        body: fallback.connectionSummary,
        eyebrow: "服务状态",
        heading: fallback.heroTitle,
        primaryIcon: <LayoutDashboard size={18} />,
        primaryText: fallback.primaryCopyText,
        secondaryIcon: <ShoppingBag size={18} />,
        secondaryText: fallback.secondaryCopyText,
        tone: fallback.scopeTone,
      };
  }
}

function userRouteGuide(
  route: UserRoute,
  context: {
    activeNodeCount: number;
    activeNodeCountText: string;
    activeScopeLabel: string;
    activeScopeTone: ScopeChoice["tone"];
    hasSubscription: boolean;
    hasToken: boolean;
    isAccountSyncing: boolean;
    membershipEnabled: boolean;
    membershipActive: boolean;
    orderCount: number;
    savedPresetCount: number;
    subscriptionName: string;
    walletBalance: string;
  },
): PageGuideView {
  const activeNodeCountPhrase = nodeCountPhrase(context.activeNodeCountText);
  const loginStep: PageGuideStep = context.hasToken
    ? { label: "已登录", detail: "当前浏览器会话有效", state: "done" }
    : { label: "先登录", detail: "登录后才显示个人订阅", state: "active" };
  const purchaseReady = !context.membershipEnabled || context.membershipActive;
  const membershipStep: PageGuideStep = !context.membershipEnabled
    ? { label: "内部入口", detail: "无需会员卡即可购买订阅", state: "done" }
    : context.isAccountSyncing
      ? { label: "同步权益", detail: "正在读取会员与订阅状态", state: "active" }
      : context.membershipActive
        ? { label: "会员有效", detail: "可以购买或续费订阅", state: "done" }
        : { label: "开通会员", detail: "会员卡是购买订阅前置条件", state: context.hasToken ? "active" : "next" };
  const subscriptionStep: PageGuideStep = context.isAccountSyncing
    ? { label: "同步订阅", detail: "正在读取可用订阅和节点", state: "next" }
    : context.hasSubscription
    ? { label: "订阅可用", detail: `${context.subscriptionName} 正在运行`, state: "done" }
    : { label: "购买订阅", detail: "选择套餐后创建订单快照", state: purchaseReady ? "active" : "next" };
  const entrySteps = context.membershipEnabled ? [loginStep, membershipStep, subscriptionStep] : [loginStep, subscriptionStep];

  switch (route) {
    case "subscriptions":
      return {
        body: "这里的顺序固定为：选订阅，选节点范围，最后复制链接或保存预设。节点多的时候先按接入方式筛选。",
        eyebrow: "当前任务",
        primaryIcon: <Copy size={17} />,
        primaryText: context.isAccountSyncing ? "同步中" : context.hasSubscription ? `复制${context.activeScopeLabel}链接` : context.hasToken ? "去购买订阅" : "登录后生成",
        secondaryIcon: <KeyRound size={17} />,
        secondaryText: "编辑自定义预设",
        steps: [
          { label: "选择订阅", detail: context.isAccountSyncing ? "正在同步订阅" : context.hasSubscription ? context.subscriptionName : "还没有可用订阅", state: context.hasSubscription ? "done" : "active" },
          { label: "选择范围", detail: context.isAccountSyncing ? "同步完成后显示节点" : `${context.activeScopeLabel} · ${activeNodeCountPhrase}`, state: context.hasSubscription ? "active" : "next" },
          { label: "复制链接", detail: `${context.savedPresetCount} 个已保存预设`, state: context.activeNodeCount ? "next" : "next" },
        ],
        title: "先决定链接范围，再复制给客户端。",
        tone: context.activeScopeTone,
      };
    case "membership":
      return {
        body: context.membershipEnabled ? "会员卡只有一张，续费只延长时间。订阅商品会先校验会员有效期，再允许创建订单。" : "内部入口不展示会员卡，直接从订阅套餐开始。",
        eyebrow: "当前任务",
        primaryIcon: <BadgeCheck size={17} />,
        primaryText: context.membershipActive ? "续费会员" : context.hasToken ? "开通会员" : "登录后开通",
        secondaryIcon: <ShoppingBag size={17} />,
        secondaryText: "查看订阅套餐",
        steps: [
          loginStep,
          membershipStep,
          { label: "再买订阅", detail: "订阅周期不能越过会员策略", state: context.membershipActive ? "active" : "next" },
        ],
        title: context.membershipEnabled ? (context.membershipActive ? "会员已生效，下一步是订阅或续期。" : "先拿到会员身份，再购买订阅。") : "内部入口可以直接购买订阅。",
      };
    case "plans":
      return {
        body: "购买页只做三件事：选择商品，创建订单快照，选择余额或外部支付。订单生成后商品改价也不会影响历史。",
        eyebrow: "当前任务",
        primaryIcon: <ShoppingBag size={17} />,
        primaryText: "选择套餐",
        secondaryIcon: <ReceiptText size={17} />,
        secondaryText: "查看订单",
        steps: context.membershipEnabled
          ? [
              membershipStep,
              { label: "选择商品", detail: "会员卡、订阅、流量重置分开判断", state: "active" },
              { label: "创建订单", detail: "保存价格、周期和权益快照", state: "next" },
            ]
          : [
              loginStep,
              { label: "选择订阅", detail: "只展示可购买的订阅商品", state: "active" },
              { label: "创建订单", detail: "保存价格、周期和权益快照", state: "next" },
            ],
        title: "先选商品，再进入结算。",
      };
    case "checkout":
      return {
        body: "结算页不是商品列表。直接访问时先回到套餐，选中商品后再创建订单并选择支付方式。",
        eyebrow: "当前任务",
        primaryIcon: <ShoppingBag size={17} />,
        primaryText: "回到套餐",
        secondaryIcon: <ReceiptText size={17} />,
        secondaryText: "查看订单",
        steps: [
          { label: "确认商品", detail: "从套餐卡片进入结算", state: "active" },
          { label: "创建订单", detail: "锁定本次订单快照", state: "next" },
          { label: "完成支付", detail: "余额或支付服务商回调开通权益", state: "next" },
        ],
        title: "结算从选中套餐开始。",
      };
    case "wallet":
      return {
        body: "钱包只展示可用于支付的资金和来源。真正消耗余额的动作发生在订单支付时。",
        eyebrow: "当前任务",
        primaryIcon: <ReceiptText size={17} />,
        primaryText: "查看订单",
        secondaryIcon: <ShoppingBag size={17} />,
        secondaryText: "继续购买",
        steps: [
          { label: "核对余额", detail: `${context.walletBalance} 可用`, state: "active" },
          { label: "选择订单", detail: "待支付订单会在订单页处理", state: "next" },
          { label: "余额支付", detail: "支付成功后权益立即生效", state: "next" },
        ],
        title: "先核对余额，再去订单里支付。",
      };
    case "orders":
      return {
        body: "订单页用来核对金额、状态和商品快照。需要继续购买时回到套餐，需要补支付时打开对应订单。",
        eyebrow: "当前任务",
        primaryIcon: <RefreshCw size={17} />,
        primaryText: "刷新订单",
        secondaryIcon: <ShoppingBag size={17} />,
        secondaryText: "继续购买",
        steps: [
          { label: "打开订单", detail: context.orderCount ? `${context.orderCount} 条记录` : "暂无订单", state: context.orderCount ? "active" : "next" },
          { label: "核对快照", detail: "名称、金额和权益按下单时保存", state: "next" },
          { label: "确认权益", detail: "支付完成后回到账户查看状态", state: "next" },
        ],
        title: "订单先看状态，再看快照。",
      };
    case "settings":
      return {
        body: "设置页只放账户相关动作。订阅范围去订阅页，支付记录去订单页，遇到问题再进帮助。",
        eyebrow: "当前任务",
        primaryIcon: context.hasToken ? <HelpCircle size={17} /> : <LogIn size={17} />,
        primaryText: context.hasToken ? "查看帮助" : "登录账号",
        secondaryIcon: <LayoutDashboard size={17} />,
        secondaryText: "管理订阅",
        steps: [
          loginStep,
          { label: "确认权益", detail: context.membershipEnabled ? (context.isAccountSyncing ? "正在同步权益" : context.membershipActive ? "会员身份有效" : "会员待开通") : "内部入口无需会员卡", state: purchaseReady ? "done" : context.isAccountSyncing ? "active" : "next" },
          { label: "处理问题", detail: "需要协助时提交工单", state: "next" },
        ],
        title: "账户动作集中在这里，业务操作回到对应页面。",
      };
    case "support":
      return {
        body: "提交工单前先选问题类型，再写清现象和最近操作。订阅导入或支付问题会更容易定位。",
        eyebrow: "当前任务",
        primaryIcon: context.hasToken ? <HelpCircle size={17} /> : <LogIn size={17} />,
        primaryText: context.hasToken ? "填写工单" : "登录后提交",
        secondaryIcon: <LayoutDashboard size={17} />,
        secondaryText: "回到订阅",
        steps: [
          loginStep,
          { label: "选择类型", detail: "连接、支付、账户或其他", state: context.hasToken ? "active" : "next" },
          { label: "等待回复", detail: "后续消息会留在工单记录里", state: "next" },
        ],
        title: "先把问题归类，再提交。",
      };
    case "auth":
      return {
        body: "登录后才会加载真实订阅、钱包、订单和自定义预设。注册入口只在服务端允许时显示。",
        eyebrow: "当前任务",
        primaryIcon: <LogIn size={17} />,
        primaryText: "登录账号",
        secondaryIcon: <UserPlus size={17} />,
        secondaryText: "创建账户",
        steps: [
          { label: "填写邮箱", detail: "使用当前用户端账户", state: "active" },
          { label: "输入密码", detail: "密码只用于 user 端会话", state: "next" },
          { label: "进入控制台", detail: "登录后同步个人数据", state: "next" },
        ],
        title: "先确认身份，再进入控制台。",
      };
    default:
      if (!context.hasToken) {
        return {
          body: "访客可以先看公开套餐。登录后才会出现你的订阅、钱包、订单和预设。",
          eyebrow: "下一步",
          primaryIcon: <LogIn size={17} />,
          primaryText: "登录账号",
          secondaryIcon: <ShoppingBag size={17} />,
          secondaryText: "先看套餐",
          steps: entrySteps,
          title: "先登录，系统才知道该显示什么。",
        };
      }
      if (!context.hasSubscription) {
        return {
          body: context.isAccountSyncing ? "正在读取账户里的订阅、钱包和订单信息。同步完成后再给出下一步动作。" : context.membershipEnabled ? "当前账户还没有可复制的订阅链接。先确认会员状态，再从套餐页创建订单。" : "当前账户还没有可复制的订阅链接。可以直接从套餐页创建订阅订单。",
          eyebrow: "下一步",
          primaryIcon: context.isAccountSyncing ? <RefreshCw size={17} /> : <ShoppingBag size={17} />,
          primaryText: context.isAccountSyncing ? "同步中" : "去购买套餐",
          secondaryIcon: context.isAccountSyncing ? <LayoutDashboard size={17} /> : <ShoppingBag size={17} />,
          secondaryText: context.isAccountSyncing ? "稍后查看" : "查看套餐",
          steps: entrySteps,
          title: context.isAccountSyncing ? "正在同步账户状态。" : context.membershipEnabled ? "先补齐购买条件，再开通订阅。" : "选择订阅套餐后就可以下单。",
        };
      }
      return {
        body: "首页只展示整体连接健康。复制链接、二维码和自定义节点范围都集中在订阅页，避免多个订阅时选错范围。",
        eyebrow: "下一步",
        primaryIcon: <LayoutDashboard size={17} />,
        primaryText: "管理订阅",
        secondaryIcon: <ShoppingBag size={17} />,
        secondaryText: "继续购买",
        steps: [
          subscriptionStep,
          { label: "查看概览", detail: "首页聚合全部生效订阅", state: "active" },
          { label: "管理范围", detail: `${context.savedPresetCount} 个已保存预设`, state: "next" },
        ],
        title: "订阅可用，首页只保留总览。",
      };
  }
}

function routeFromPath(pathname: string): UserRoute {
  switch (pathname.replace(/\/+$/, "") || "/") {
    case "/auth":
      return "auth";
    case "/subscribe":
    case "/subscriptions":
      return "subscriptions";
    case "/member":
    case "/membership":
    case "/memberships":
      return "membership";
    case "/plans":
    case "/purchase":
      return "plans";
    case "/checkout":
      return "checkout";
    case "/wallet":
      return "wallet";
    case "/orders":
      return "orders";
    case "/settings":
    case "/profile":
      return "settings";
    case "/help":
    case "/support":
      return "support";
    default:
      if (pathname.startsWith("/subscriptions/") || pathname.startsWith("/subscribe/")) {
        return "subscriptions";
      }
      return "dashboard";
  }
}

function canonicalRoutePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  switch (normalized) {
    case "/subscribe":
      return "/subscriptions";
    case "/member":
    case "/memberships":
      return "/membership";
    case "/purchase":
      return "/plans";
    case "/profile":
      return "/settings";
    case "/help":
      return "/support";
    default:
      if (normalized.startsWith("/subscribe/")) {
        return normalized.replace(/^\/subscribe\//, "/subscriptions/");
      }
      return normalized;
  }
}

function routePath(route: UserRoute): string {
  if (route === "auth") {
    return "/auth";
  }
  if (route === "checkout") {
    return "/checkout";
  }
  return userNavLinks.find((item) => item.route === route)?.href || "/";
}

function navRouteActive(route: UserRoute, navRoute: UserRoute): boolean {
  return route === navRoute || (route === "checkout" && navRoute === "plans");
}

function routeSectionId(route: UserRoute): string {
  switch (route) {
    case "auth":
      return "dashboard";
    case "subscriptions":
      return "subscriptions";
    case "plans":
      return "plans";
    case "checkout":
      return "checkout";
    case "membership":
      return "membership";
    case "wallet":
      return "wallet";
    case "orders":
      return "orders";
    case "settings":
      return "settings";
    case "support":
      return "support";
    default:
      return "dashboard";
  }
}

function subscriptionIdFromPath(pathname: string): bigint {
  const match = pathname.match(/^\/(?:subscriptions|subscribe)\/(\d+)\/?$/);
  if (!match) {
    return 0n;
  }
  try {
    return BigInt(match[1]);
  } catch {
    return 0n;
  }
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function errorMessage(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : "";
  const friendly = friendlyBusinessError(raw);
  if (friendly) {
    return friendly;
  }
  return raw || "操作失败，请稍后重试";
}

function isUserSessionExpiredError(reason: unknown): boolean {
  const message = errorMessage(reason).toLowerCase();
  return message.includes("user session expired") || message.includes("unauthenticated") || message.includes("session not found");
}

function friendlyBusinessError(message: string): string {
  const normalized = message.toLowerCase();
  const mappings: Array<[string, string]> = [
    ["monthly membership spend limit exceeded", "本月会员消费额度已用完，请下月再试或联系管理员调整上限。"],
    ["membership stock exhausted", "会员卡库存已售罄，请选择其他会员卡或稍后再试。"],
    ["membership active limit exceeded", "当前有效会员名额已满，请稍后再试或联系管理员。"],
    ["active membership required", "需要先开通会员卡后才能购买订阅套餐。"],
    ["subscription renewal is not allowed", "当前订阅暂不允许续费，请选择其他套餐或联系管理员。"],
    ["traffic reset is not allowed", "当前订阅暂不允许重置流量。"],
    ["resettable active subscription required", "当前没有可重置流量的有效订阅。"],
    ["subscription expiry exceeds membership policy", "订阅到期时间会超过会员卡允许范围，请先续费会员卡或选择更短周期。"],
    ["insufficient balance", "账户余额不足，请先充值或选择其他支付方式。"],
    ["product unavailable", "该商品暂不可购买，请选择其他套餐。"],
    ["product not purchasable", "该商品当前不允许购买，请选择其他套餐。"],
    ["order is not payable", "订单当前不可支付，请刷新订单状态后再试。"],
    ["balance payment is disabled", "余额支付暂未开启，请选择其他支付方式。"],
  ];
  return mappings.find(([needle]) => normalized.includes(needle))?.[1] ?? "";
}

function unavailableReasonLabel(reason: string): string {
  switch (reason) {
    case "membership_required":
      return "需要有效会员";
    case "membership_expired":
      return "会员卡已过期";
    case "subscription_expiry_exceeds_membership_policy":
    case "subscription_expiry_exceeds_membership":
      return "订阅会超过会员卡允许期限";
    case "subscription_renewal_disabled":
    case "renewal_disabled":
      return "当前套餐暂不允许续费";
    case "resettable_subscription_required":
      return "没有可重置订阅";
    case "traffic_reset_disabled":
      return "当前套餐暂不允许重置流量";
    case "no_available_nodes":
    case "subscription_nodes_required":
      return "套餐暂未配置可用节点";
    case "purchase_disabled":
      return "暂未开放购买";
    case "membership_stock_exhausted":
      return "会员卡已售罄";
    case "membership_active_limit_exceeded":
      return "会员名额已满";
    default:
      return "";
  }
}
