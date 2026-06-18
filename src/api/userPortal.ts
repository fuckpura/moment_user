import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import type {
  AuthSession,
  GetPublicConfigResponse,
  GetSubscriptionResponse,
  GetOverviewResponse,
  GetSubscriptionLinkResponse,
  ListOrdersResponse,
  ListPaymentMethodsResponse,
  ListPlansResponse,
  ListSubscriptionScopesResponse,
  ListSubscriptionsResponse,
  ListSupportTicketsResponse,
  OrderSummary,
  PayOrderWithBalanceResponse,
  SaveSubscriptionPresetResponse,
  StartOrderPaymentResponse,
  SubscriptionPresetNodeItem,
  SupportTicket,
  SupportTicketMessage,
} from "../gen/proto/moment/user/v1/portal_pb";
import { UserPortalService } from "../gen/proto/moment/user/v1/portal_pb";
import { apiBaseUrl, portalVariant, runtimeBranding, storeUserAccessToken, userAccessToken, type MomentBranding } from "./runtime";

const transport = createConnectTransport({
  baseUrl: apiBaseUrl(),
  defaultTimeoutMs: 6_000,
});

export const userPortalClient = createClient(UserPortalService, transport);

export type PublicConfig = {
  siteDisplayName: string;
  branding: MomentBranding;
  authPolicy: {
    registrationEnabled: boolean;
    passwordMinLength: number;
    passwordRequireDigit: boolean;
    passwordRequireLetter: boolean;
  };
  support: {
    categories: PublicSupportCategory[];
    defaultPriority: string;
    subjectMinLength: number;
    subjectMaxLength: number;
    messageMinLength: number;
    messageMaxLength: number;
  };
  announcement: {
    enabled: boolean;
    title: string;
    body: string;
    tone: string;
  };
  featureFlags: {
    balancePaymentEnabled: boolean;
    couponEnabled: boolean;
    internalPortalEnabled: boolean;
    inviteEnabled: boolean;
    membershipEnabled: boolean;
    membershipRequiredForPurchase: boolean;
    supportTicketEnabled: boolean;
  };
};

export type PublicSupportCategory = {
  key: string;
  label: string;
};

export type UserPortalDashboard = {
  source: "live" | "partial";
  publicConfig: PublicConfig;
  plans: ListPlansResponse["plans"];
  overview?: GetOverviewResponse;
  orders: ListOrdersResponse["orders"];
  ordersPage?: ListOrdersResponse["page"];
  paymentMethods: ListPaymentMethodsResponse["methods"];
  primaryScopeSubscriptionId?: bigint;
  primaryScopes?: ListSubscriptionScopesResponse;
  subscriptions: ListSubscriptionsResponse["subscriptions"];
  supportTickets: ListSupportTicketsResponse["tickets"];
  supportTicketsPage?: ListSupportTicketsResponse["page"];
};

export type UserSupportTicketThread = {
  ticket: SupportTicket;
  messages: SupportTicketMessage[];
};

export async function loadUserPortalDashboard(signal?: AbortSignal): Promise<UserPortalDashboard> {
  const token = userAccessToken();
  const authOptions = token ? { ...bearerOptions(token), signal } : undefined;
  const publicConfig = getUserPublicConfig(signal).catch((reason: unknown) => {
    if (portalVariant() === "internal") {
      throw reason;
    }
    return fallbackPublicConfig();
  });
  const listPlans = token && authOptions ? userPortalClient.listPlans({}, authOptions) : userPortalClient.listPlans({}, { signal });

  if (!token) {
    const listPaymentMethods = userPortalClient.listPaymentMethods({}, { signal });
    const [publicConfigResult, plans, paymentMethods] = await Promise.allSettled([publicConfig, listPlans, listPaymentMethods]);
    assertPublicConfigAvailableForPortal(publicConfigResult);
    if (plans.status === "rejected") {
      throw plans.reason;
    }
    return {
      source: "partial",
      publicConfig: publicConfigResult.status === "fulfilled" ? publicConfigResult.value : fallbackPublicConfig(),
      plans: plans.value.plans,
      orders: [],
      paymentMethods: paymentMethods.status === "fulfilled" ? paymentMethods.value.methods : [],
      subscriptions: [],
      supportTickets: [],
    };
  }

  const [publicConfigResult, plans, paymentMethodsResult, overviewResult, subscriptionsResult, ordersResult] = await Promise.allSettled([
    publicConfig,
    listPlans,
    userPortalClient.listPaymentMethods({}, authOptions),
    userPortalClient.getOverview({}, authOptions),
    userPortalClient.listSubscriptions({}, authOptions),
    userPortalClient.listOrders({ page: { cursor: "", limit: 6 } }, authOptions),
  ]);

  if (plans.status === "rejected") {
    throw plans.reason;
  }
  assertPublicConfigAvailableForPortal(publicConfigResult);
  const resolvedPublicConfig = publicConfigResult.status === "fulfilled" ? publicConfigResult.value : fallbackPublicConfig();
  if (settledUnauthenticated(overviewResult) || settledUnauthenticated(subscriptionsResult) || settledUnauthenticated(ordersResult)) {
    storeUserAccessToken("");
    throw new Error("user session expired");
  }
  const supportTicketsResult = resolvedPublicConfig.featureFlags.supportTicketEnabled
    ? await userPortalClient.listSupportTickets({ page: { cursor: "", limit: 6 } }, authOptions)
        .then((value) => ({ status: "fulfilled" as const, value }))
        .catch((reason: unknown) => ({ status: "rejected" as const, reason }))
    : { status: "fulfilled" as const, value: { tickets: [], page: undefined } };
  const overview = overviewResult.status === "fulfilled" ? overviewResult.value : undefined;
  const paymentMethods = paymentMethodsResult.status === "fulfilled" ? paymentMethodsResult.value.methods : [];
  const subscriptions = subscriptionsResult.status === "fulfilled" ? subscriptionsResult.value.subscriptions : [];
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value.orders : [];
  const ordersPage = ordersResult.status === "fulfilled" ? ordersResult.value.page : undefined;
  const supportTickets = supportTicketsResult.status === "fulfilled" ? supportTicketsResult.value.tickets : [];
  const supportTicketsPage = supportTicketsResult.status === "fulfilled" ? supportTicketsResult.value.page : undefined;
  const primarySubscription = overview?.subscriptions[0] || subscriptions[0];
  let primaryScopes: ListSubscriptionScopesResponse | undefined;
  if (primarySubscription?.id) {
    try {
      primaryScopes = await userPortalClient.listSubscriptionScopes({ subscriptionId: primarySubscription.id }, authOptions);
    } catch (reason: unknown) {
      if (isUnauthenticatedError(reason)) {
        storeUserAccessToken("");
        throw new Error("user session expired");
      }
    }
  }
  return {
    source: overview && subscriptionsResult.status === "fulfilled" && ordersResult.status === "fulfilled" && supportTicketsResult.status === "fulfilled" ? "live" : "partial",
    publicConfig: resolvedPublicConfig,
    plans: plans.value.plans,
    overview,
    orders,
    ordersPage,
    paymentMethods,
    primaryScopeSubscriptionId: primarySubscription?.id,
    primaryScopes,
    subscriptions,
    supportTickets,
    supportTicketsPage,
  };
}

function assertPublicConfigAvailableForPortal(result: PromiseSettledResult<PublicConfig>): void {
  if (result.status === "rejected" && portalVariant() === "internal") {
    throw result.reason;
  }
}

function settledUnauthenticated<T>(result: PromiseSettledResult<T>): boolean {
  if (result.status !== "rejected") {
    return false;
  }
  return isUnauthenticatedError(result.reason);
}

function isUnauthenticatedError(reason: unknown): boolean {
  if (reason instanceof ConnectError) {
    return reason.code === Code.Unauthenticated;
  }
  if (!(reason instanceof Error)) {
    return false;
  }
  const normalized = reason.message.toLowerCase();
  return normalized.includes("unauthenticated") || normalized.includes("session not found") || normalized.includes("token expired");
}

export async function getUserPublicConfig(signal?: AbortSignal): Promise<PublicConfig> {
  const response = await userPortalClient.getPublicConfig({ portalVariant: portalVariant() }, { signal });
  return normalizePublicConfig(response);
}

export async function loginUser(email: string, password: string): Promise<AuthSession> {
  const response = await userPortalClient.login({ email: email.trim(), password });
  return persistSession(response.session);
}

export async function registerUser(email: string, password: string, displayName: string): Promise<AuthSession> {
  const response = await userPortalClient.register({ email: email.trim(), password, displayName: displayName.trim(), portalVariant: portalVariant() });
  return persistSession(response.session);
}

export async function createUserOrder(productId: bigint): Promise<OrderSummary> {
  const response = await userPortalClient.createOrder({ productId, portalVariant: portalVariant() }, authenticatedOptions());
  if (!response.order) {
    throw new Error("创建订单响应缺少订单信息");
  }
  return response.order;
}

export async function payUserOrderWithBalance(orderNo: string): Promise<PayOrderWithBalanceResponse> {
  const response = await userPortalClient.payOrderWithBalance({ orderNo }, authenticatedOptions());
  if (!response.order) {
    throw new Error("余额支付响应缺少订单信息");
  }
  return response;
}

export async function startUserOrderPayment(orderNo: string, provider: string, returnUrl = window.location.href): Promise<StartOrderPaymentResponse> {
  const response = await userPortalClient.startOrderPayment({ orderNo, provider, returnUrl }, authenticatedOptions());
  if (!response.checkoutUrl && !response.qrcode && !response.urlscheme) {
    throw new Error("外部支付响应缺少支付链接");
  }
  return response;
}

export async function listUserPaymentMethods(): Promise<ListPaymentMethodsResponse> {
  return userPortalClient.listPaymentMethods({}, authenticatedOptions());
}

export async function listUserOrders(cursor = "", limit = 6): Promise<ListOrdersResponse> {
  return userPortalClient.listOrders({ page: { cursor, limit } }, authenticatedOptions());
}

export async function getUserOrder(orderNo: string): Promise<OrderSummary> {
  const response = await userPortalClient.getOrder({ orderNo }, authenticatedOptions());
  if (!response.order) {
    throw new Error("订单详情响应缺少订单信息");
  }
  return response.order;
}

export async function getUserSubscription(subscriptionId: bigint): Promise<GetSubscriptionResponse["subscription"]> {
  const response = await userPortalClient.getSubscription({ subscriptionId }, authenticatedOptions());
  if (!response.subscription) {
    throw new Error("订阅详情响应缺少订阅信息");
  }
  return response.subscription;
}

export async function getUserSubscriptionLink(subscriptionId: bigint, profileKey = "", presetKey = ""): Promise<GetSubscriptionLinkResponse> {
  const response = await userPortalClient.getSubscriptionLink({ subscriptionId, profileKey, presetKey }, authenticatedOptions());
  if (!response.url) {
    throw new Error("订阅链接响应缺少 URL");
  }
  return response;
}

export async function listUserSubscriptionScopes(subscriptionId: bigint): Promise<ListSubscriptionScopesResponse> {
  return userPortalClient.listSubscriptionScopes({ subscriptionId }, authenticatedOptions());
}

export async function saveUserSubscriptionPreset(
  subscriptionId: bigint,
  name: string,
  nodeIds: bigint[],
  nodeItems: Array<Pick<SubscriptionPresetNodeItem, "displayName" | "nodeId" | "sortOrder">> = [],
  presetKey = "",
): Promise<SaveSubscriptionPresetResponse> {
  const response = await userPortalClient.saveSubscriptionPreset(
    {
      subscriptionId,
      presetKey,
      name: name.trim(),
      nodeIds,
      nodeItems,
      enabled: true,
    },
    authenticatedOptions(),
  );
  if (!response.preset) {
    throw new Error("保存订阅预设响应缺少预设信息");
  }
  return response;
}

export async function deleteUserSubscriptionPreset(subscriptionId: bigint, presetKey: string): Promise<void> {
  await userPortalClient.deleteSubscriptionPreset({ subscriptionId, presetKey }, authenticatedOptions());
}

export async function listUserSupportTickets(cursor = "", limit = 6): Promise<ListSupportTicketsResponse> {
  return userPortalClient.listSupportTickets({ page: { cursor, limit } }, authenticatedOptions());
}

export async function createUserSupportTicket(subject: string, category: string, priority: string, message: string): Promise<SupportTicket> {
  const response = await userPortalClient.createSupportTicket({ subject, category, priority, message }, authenticatedOptions());
  if (!response.ticket) {
    throw new Error("创建工单响应缺少工单信息");
  }
  return response.ticket;
}

export async function getUserSupportTicket(ticketId: bigint): Promise<UserSupportTicketThread> {
  const response = await userPortalClient.getSupportTicket({ ticketId }, authenticatedOptions());
  if (!response.ticket) {
    throw new Error("工单详情响应缺少工单信息");
  }
  return { ticket: response.ticket, messages: response.messages };
}

export async function replyUserSupportTicket(ticketId: bigint, message: string): Promise<UserSupportTicketThread> {
  const response = await userPortalClient.replySupportTicket({ ticketId, message }, authenticatedOptions());
  if (!response.ticket) {
    throw new Error("回复工单响应缺少工单信息");
  }
  return { ticket: response.ticket, messages: response.messages };
}

export async function logoutUser(): Promise<void> {
  const token = userAccessToken();
  storeUserAccessToken("");
  if (!token) {
    return;
  }
  try {
    await userPortalClient.logout({}, bearerOptions(token));
  } catch {
    // Local logout must always complete; the server session may already be expired.
  }
}

function bearerOptions(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function authenticatedOptions() {
  const token = userAccessToken();
  if (!token) {
    throw new Error("请先登录");
  }
  return bearerOptions(token);
}

function normalizePublicConfig(config?: GetPublicConfigResponse): PublicConfig {
  const announcement = config?.announcement;
  const authPolicy = config?.authPolicy;
  const featureFlags = config?.featureFlags;
  const supportPolicy = config?.supportPolicy;
  const branding = normalizePublicBranding(config);
  return {
    siteDisplayName: branding.displayName,
    branding,
    authPolicy: {
      registrationEnabled: authPolicy?.registrationEnabled ?? true,
      passwordMinLength: normalizePasswordMinLength(authPolicy?.passwordMinLength),
      passwordRequireDigit: authPolicy?.passwordRequireDigit ?? true,
      passwordRequireLetter: authPolicy?.passwordRequireLetter ?? true,
    },
    announcement: {
      enabled: Boolean(announcement?.enabled && (announcement.title?.trim() || announcement.body?.trim())),
      title: announcement?.title?.trim() || "",
      body: announcement?.body?.trim() || "",
      tone: normalizeAnnouncementTone(announcement?.tone),
    },
    support: normalizeSupportPolicy(supportPolicy),
    featureFlags: {
      balancePaymentEnabled: featureFlags?.balancePaymentEnabled ?? true,
      couponEnabled: featureFlags?.couponEnabled ?? true,
      internalPortalEnabled: featureFlags?.internalPortalEnabled ?? false,
      inviteEnabled: featureFlags?.inviteEnabled ?? true,
      membershipEnabled: featureFlags?.membershipEnabled ?? true,
      membershipRequiredForPurchase: featureFlags?.membershipRequiredForPurchase ?? true,
      supportTicketEnabled: featureFlags?.supportTicketEnabled ?? true,
    },
  };
}

function fallbackPublicConfig(): PublicConfig {
  const branding = runtimeBranding();
  return {
    siteDisplayName: branding.displayName,
    branding,
    authPolicy: { registrationEnabled: true, passwordMinLength: 8, passwordRequireDigit: true, passwordRequireLetter: true },
    announcement: { enabled: false, title: "", body: "", tone: "info" },
    support: defaultSupportPolicy(),
    featureFlags: {
      balancePaymentEnabled: true,
      couponEnabled: portalVariant() !== "internal",
      internalPortalEnabled: portalVariant() === "internal",
      inviteEnabled: portalVariant() !== "internal",
      membershipEnabled: portalVariant() !== "internal",
      membershipRequiredForPurchase: portalVariant() !== "internal",
      supportTicketEnabled: true,
    },
  };
}

function normalizePublicBranding(config?: GetPublicConfigResponse): MomentBranding {
  const fallback = runtimeBranding();
  const branding = config?.branding;
  const displayName = branding?.displayName?.trim() || config?.siteDisplayName?.trim() || fallback.displayName || "Moment";
  return {
    adminLogoUrl: branding?.adminLogoUrl?.trim() || fallback.adminLogoUrl,
    displayName,
    faviconUrl: branding?.faviconUrl?.trim() || fallback.faviconUrl,
    footerText: branding?.footerText?.trim() || fallback.footerText,
    supportEmail: branding?.supportEmail?.trim() || fallback.supportEmail,
    themeColor: branding?.themeColor?.trim() || fallback.themeColor || "#111827",
    userLogoUrl: branding?.userLogoUrl?.trim() || fallback.userLogoUrl,
  };
}

function normalizePasswordMinLength(value?: number): number {
  if (!Number.isFinite(value) || !value || value < 1) {
    return 8;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 128);
}

function normalizeAnnouncementTone(tone?: string): string {
  switch (tone?.trim().toLowerCase()) {
    case "success":
    case "warning":
    case "critical":
      return tone.trim().toLowerCase();
    default:
      return "info";
  }
}

function normalizeSupportPolicy(policy?: GetPublicConfigResponse["supportPolicy"]): PublicConfig["support"] {
  const seen = new Set<string>();
  const normalized = (policy?.categories || [])
    .map((category) => ({
      key: category.key?.trim().toLowerCase() || "",
      label: category.label?.trim() || "",
    }))
    .filter((category) => {
      if (!category.key || !category.label || seen.has(category.key)) {
        return false;
      }
      seen.add(category.key);
      return true;
    });
  return {
    categories: normalized.length ? normalized : defaultSupportPolicy().categories,
    defaultPriority: normalizeSupportPriority(policy?.defaultPriority),
    subjectMinLength: normalizeBound(policy?.subjectMinLength, defaultSupportPolicy().subjectMinLength, 1, 160),
    subjectMaxLength: normalizeBound(policy?.subjectMaxLength, defaultSupportPolicy().subjectMaxLength, 4, 512),
    messageMinLength: normalizeBound(policy?.messageMinLength, defaultSupportPolicy().messageMinLength, 1, 200),
    messageMaxLength: normalizeBound(policy?.messageMaxLength, defaultSupportPolicy().messageMaxLength, 200, 20_000),
  };
}

function defaultSupportPolicy(): PublicConfig["support"] {
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

function normalizeBound(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !value) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizeSupportPriority(priority?: string): string {
  const normalized = priority?.trim().toLowerCase();
  switch (normalized) {
    case "high":
    case "urgent":
      return normalized;
    default:
      return "normal";
  }
}

function persistSession(session?: AuthSession): AuthSession {
  if (!session?.accessToken) {
    throw new Error("登录响应缺少访问令牌");
  }
  storeUserAccessToken(session.accessToken);
  return session;
}
