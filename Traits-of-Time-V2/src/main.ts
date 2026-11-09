import { GameEngine } from "../assets/scripts/core/engine/GameEngine";
import { GameSession, type SessionSave, type SessionAction } from "../assets/scripts/application/GameSession";
import { sha256Json } from "../assets/scripts/core/persistence/JsonDigest";
import { getNativeMingEndContent } from "../assets/scripts/application/NativeContentLoader";
import { EnumMapper } from "../assets/scripts/presentation/EnumMapper";
import { LogParser, type EngineRawLog, type FoldItemData } from "../assets/scripts/presentation/LogParser";
import { LifetimeRecords } from "../assets/scripts/presentation/LifetimeRecords";
import { BrowserAudio, type AudioChannel, type AudioCue } from "./audio";
import type { GameView, LogEntry, PendingDecision, EndingReport } from "../assets/scripts/core/types/schema";
import type { Card, ContentBundle, Event, Option } from "../assets/scripts/core/types/content.generated";

type LifePackage = ReturnType<typeof getNativeMingEndContent>;
type OptionPending = Extract<PendingDecision, { kind: "option" }>;

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error("Missing page element: " + id);
  return value as T;
};

const ui = {
  home: el("home-screen"),
  identity: el("identity-screen"),
  game: el("game-screen"),
  start: el<HTMLButtonElement>("btn-start-life"),
  identityYear: el("identity-year"),
  identityAge: el("identity-age"),
  identityName: el("identity-name"),
  identityBackground: el("identity-background"),
  identityMeta: el("identity-meta"),
  identityNext: el<HTMLButtonElement>("btn-identity-next"),
  hudEra: el("hud-era"),
  hudTurn: el("hud-turn"),
  hudIdentity: el("hud-identity"),
  hudRegion: el("hud-region"),
  hudCaste: el("hud-caste"),
  stats: {
    physique: el("stat-physique"),
    wealth: el("stat-wealth"),
    intelligence: el("stat-intel"),
    prestige: el("stat-prestige"),
    luck: el("stat-luck"),
  },
  stream: el("log-stream"),
  shelf: el("shelf-items"),
  tooltip: el("relic-tooltip"),
  tooltipName: el("rtt-name"),
  tooltipRarity: el("rtt-rarity"),
  tooltipDesc: el("rtt-desc"),
  tooltipPerk: el("rtt-perk"),
  advance: el<HTMLButtonElement>("btn-seal-advance"),
  career: el<HTMLButtonElement>("btn-toggle-career"),
  scrollBottom: el<HTMLButtonElement>("btn-scroll-bottom"),
  decision: el("overlay-decision"),
  decisionKicker: el("decision-kicker"),
  decisionDate: el("decision-date"),
  decisionTitle: el("decision-title"),
  decisionDesc: el("decision-desc"),
  decisionOptions: el("decision-options"),
  careerFromDecision: el<HTMLButtonElement>("btn-career-from-decision"),
  cards: el("overlay-gacha"),
  cardList: el("gacha-cards-grid"),
  confirmCard: el<HTMLButtonElement>("btn-confirm-gacha"),
  careerOverlay: el("overlay-career"),
  careerList: el("career-list"),
  closeCareer: el<HTMLButtonElement>("btn-close-career"),
  ending: el("overlay-ending"),
  endingSummary: el("ending-summary"),
  endingAge: el("ending-age"),
  endingWealth: el("ending-wealth"),
  endingAchievementCount: el("ending-achievements"),
  endingAchievementList: el("ending-achievement-list"),
  restartEnding: el<HTMLButtonElement>("btn-restart-from-ending"),
  recordsOverlay: el("overlay-records"),
  recordsTitle: el("records-title"),
  recordsSummary: el("records-summary"),
  recordsList: el("records-list"),
  recordsWarning: el("records-warning"),
  closeRecords: el<HTMLButtonElement>("btn-close-records"),
  audioOverlay: el("overlay-audio"),
  audioMute: el<HTMLButtonElement>("btn-audio-mute"),
  closeAudio: el<HTMLButtonElement>("btn-close-audio"),
  homeStats: el<HTMLButtonElement>("btn-home-stats"),
  homeAchievements: el<HTMLButtonElement>("btn-home-achievements"),
  homeSound: el<HTMLButtonElement>("btn-home-sound"),
  volumeInputs: {
    music: el<HTMLInputElement>("volume-music"),
    effects: el<HTMLInputElement>("volume-effects"),
    ambience: el<HTMLInputElement>("volume-ambience"),
  },
  volumeOutputs: {
    music: el<HTMLOutputElement>("volume-music-value"),
    effects: el<HTMLOutputElement>("volume-effects-value"),
    ambience: el<HTMLOutputElement>("volume-ambience-value"),
  },
  toast: el("toast"),
};

const attributeKeys = ["physique", "wealth", "intelligence", "prestige", "luck"] as const;
const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
let packageInfo: LifePackage | null = null;
let session: GameSession | null = null;
let currentView: GameView | null = null;
let selectedCardId: string | null = null;
let busy = false;
let saveSlot: SessionSave | null = null;
let toastTimer = 0;
let tooltipTimer = 0;
let fx: PixelFxPlayer | null = null;
const audio = new BrowserAudio();
let activeLifeId = "";
let recordedLifeId = "";
let lastAudibleSettings: ReturnType<BrowserAudio["getSettings"]> | null = null;
const lifetimeRecords = new LifetimeRecords({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
});

function bundle(): ContentBundle {
  if (!packageInfo) packageInfo = getNativeMingEndContent();
  return packageInfo.bundle;
}

function showToast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("show"), 2200);
}

function setBusy(value: boolean): void {
  busy = value;
  const frame = el("phone-screen");
  frame.classList.toggle("loading", value);
  ui.start.disabled = value;
  ui.identityNext.disabled = value;
  ui.confirmCard.disabled = value || !selectedCardId;
  ui.advance.disabled = value || currentView?.status === "AWAITING_CARD" || currentView?.status === "AWAITING_OPTION" || currentView?.status === "AWAITING_STAGE";
}

function chineseNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 99) return String(value);
  if (value < 10) return digits[value];
  if (value === 10) return "十";
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return (tens === 1 ? "" : digits[tens]) + "十" + (ones ? digits[ones] : "");
}

function ganzhiYear(year: number): string {
  const index = ((year - 4) % 60 + 60) % 60;
  return stems[index % 10] + branches[index % 12];
}

function yearHeading(view: GameView): string {
  const year = view.player.calendar_year;
  if (view.timeline !== "historical") return "架空人生 · " + year;
  const reign = year - 1627;
  return "崇祯" + chineseNumber(reign) + "年 · 岁次" + ganzhiYear(year);
}

function formatWealth(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "两";
}

function makeSavePorts() {
  return {
    hash: sha256Json,
    persist: async (save: SessionSave): Promise<void> => {
      saveSlot = structuredClone(save);
    },
    load: async (): Promise<SessionSave | null> => saveSlot,
  };
}

async function startNewLife(): Promise<void> {
  if (busy) return;
  setBusy(true);
  ui.start.textContent = "正在揭晓身份…";
  try {
    packageInfo = getNativeMingEndContent();
    const engine = new GameEngine(packageInfo.bundle, packageInfo.fingerprint);
    session = new GameSession(engine, makeSavePorts());
    saveSlot = null;
    const result = await session.initialize(Math.floor(Math.random() * 0x1_0000_0000));
    if (!result.ok) {
      showToast("未能开局：" + EnumMapper.playerError(result.error));
      return;
    }
    if (result.pending?.kind !== "card") throw new Error("开局家当候选未能载入，请重试。");
    currentView = result.state as GameView;
    activeLifeId = Date.now() + ":" + Math.random().toString(36).slice(2);
    recordedLifeId = "";
    audio.unlock();
    audio.playMusic("life");
    audio.playCue("identity");
    renderIdentity(currentView, result.pending);
    ui.home.hidden = true;
    ui.identity.hidden = false;
    ui.game.hidden = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showToast("读取游戏内容失败：" + message);
  } finally {
    ui.start.textContent = "开始新人生";
    setBusy(false);
  }
}

function renderIdentity(view: GameView, pending: PendingDecision | null): void {
  const player = view.player;
  const data = bundle();
  ui.identityYear.textContent = player.calendar_year + " 年";
  ui.identityAge.textContent = player.age + " 岁";
  ui.identityName.textContent = EnumMapper.translateIdentity(player.identity_id);
  const run = session?.exportSave().engine.payload.run;
  const background = data.era.backgrounds.find((item) => item.id === run?.opening_background_id);
  ui.identityBackground.textContent = background?.text ?? "你来到明朝，新的生活从此开始。";
  ui.identityMeta.textContent = EnumMapper.translateRegion(player.region_id) + " · " + EnumMapper.translateCaste(player.caste_id);
  ui.identityNext.disabled = pending?.kind !== "card";
}

function openCardSelection(): void {
  if (!currentView || currentView.pending?.kind !== "card") {
    showToast("本局候选家当暂时不可用，请重新开始。");
    return;
  }
  ui.identity.hidden = true;
  ui.game.hidden = false;
  ui.cards.hidden = false;
  selectedCardId = null;
  updateHud(currentView);
  renderCardOffers(currentView.pending.cards);
}

function renderCardOffers(ids: readonly string[]): void {
  const data = bundle();
  ui.cardList.replaceChildren();
  for (const id of ids) {
    const card = data.cards.find((item) => item.id === id);
    if (!card) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gacha-card-item";
    button.dataset.cardId = card.id;
    button.setAttribute("aria-pressed", "false");

    const top = document.createElement("span");
    top.className = "card-item-top";
    const name = document.createElement("strong");
    name.className = "card-item-name";
    name.textContent = card.name;
    const rarity = document.createElement("span");
    rarity.className = "card-rarity-badge " + rarityClass(card.rarity);
    rarity.textContent = card.rarity;
    top.append(name, rarity);

    const description = document.createElement("span");
    description.className = "card-item-desc";
    description.textContent = card.description;
    button.append(top, description);
    button.addEventListener("click", () => {
      selectedCardId = card.id;
      for (const other of ui.cardList.querySelectorAll<HTMLButtonElement>(".gacha-card-item")) {
        const selected = other.dataset.cardId === selectedCardId;
        other.classList.toggle("selected", selected);
        other.setAttribute("aria-pressed", String(selected));
      }
      ui.confirmCard.disabled = busy || !selectedCardId;
    });
    ui.cardList.append(button);
  }
  ui.confirmCard.disabled = true;
}

function rarityClass(rarity: string): string {
  const value = rarity.toUpperCase();
  if (value.includes("SSR")) return "badge-ssr";
  if (value.includes("SR")) return "badge-sr";
  return "badge-r";
}

async function chooseOpeningCard(): Promise<void> {
  if (!session || !selectedCardId || busy) return;
  setBusy(true);
  try {
    const result = await session.command({ type: "selectCard", cardId: selectedCardId });
    if (!result.ok) {
      showToast(EnumMapper.playerError(result.error));
      return;
    }
    ui.cards.hidden = true;
    ui.game.hidden = false;
    ui.stream.replaceChildren();
    audio.playCue("item");
    await consumeResult(result);
  } catch (error) {
    showToast("未能选择家当：" + EnumMapper.playerError(error));
  } finally {
    setBusy(false);
  }
}

async function runAction(action: SessionAction): Promise<void> {
  if (!session || busy) return;
  if (currentView?.status === "ENDED") {
    renderEnding();
    return;
  }
  setBusy(true);
  try {
    const result = await session.command(action);
    await consumeResult(result);
  } catch (error) {
    showToast(EnumMapper.playerError(error));
  } finally {
    setBusy(false);
  }
}

async function consumeResult(initial: Awaited<ReturnType<GameSession["command"]>>): Promise<void> {
  let result = initial;
  for (;;) {
    if (!result.ok) {
      showToast(EnumMapper.playerError(result.error));
      if (currentView) renderPending(currentView.pending);
      return;
    }
    currentView = result.state as GameView;
    updateHud(currentView);
    appendLogs(result.logs);
    if (currentView.status === "ENDED") {
      renderPending(result.pending);
      return;
    }
    if (result.pending?.kind !== "stage") break;

    const check = result.pending.check;
    const statName = EnumMapper.translateStat(check.attribute).name;
    showToast("检定中 · " + statName + " · 成功率 " + Math.round(check.success_probability * 100) + "%");
    await pause(220);
    if (!session) return;
    result = await session.command({ type: "stage" });
  }
  renderPending(result.pending);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function updateHud(view: GameView): void {
  if (view.status === "ENDED") {
    audio.playMusic("ending");
    audio.playAmbience(null);
  } else if (view.status !== "AWAITING_CARD") {
    audio.playMusic("life");
    audio.playAmbience(view.player.region_id);
  }
  const player = view.player;
  ui.hudEra.textContent = yearHeading(view);
  ui.hudTurn.textContent = "流年轮次 #" + (player.calendar_year - player.start_year + 1);
  ui.hudIdentity.textContent = EnumMapper.translateIdentity(player.identity_id);
  ui.hudRegion.textContent = EnumMapper.translateRegion(player.region_id);
  ui.hudCaste.textContent = EnumMapper.translateCaste(player.caste_id);

  for (const key of attributeKeys) {
    const target = ui.stats[key];
    const value = player.attributes[key];
    target.textContent = key === "wealth" ? formatWealth(value) : String(value);
    target.classList.toggle("green", key === "physique" && view.status !== "ENDED");
    target.classList.toggle("gold", key === "wealth");
    if (view.status === "ENDED" && key === "physique") target.style.color = "var(--red-death)";
    else target.style.color = "";
  }
  renderShelf(player.cards);
  ui.advance.classList.toggle("ended", view.status === "ENDED");
  ui.advance.textContent = view.status === "ENDED" ? "人生已结束 · 查看结局" : "印 · 继续一年";
  ui.advance.disabled = busy || view.status === "AWAITING_CARD" || view.status === "AWAITING_OPTION" || view.status === "AWAITING_STAGE";
}

function renderShelf(cardIds: readonly string[]): void {
  const data = bundle();
  ui.shelf.replaceChildren();
  for (let index = 0; index < 5; index++) {
    const cardId = cardIds[index];
    const card = cardId ? data.cards.find((item) => item.id === cardId) : undefined;
    const slot = document.createElement(card ? "button" : "div");
    slot.className = "shelf-slot" + (card ? " active" : " locked");
    if (card) {
      (slot as HTMLButtonElement).type = "button";
      slot.setAttribute("aria-label", card.name + " · 查看详情");
      slot.title = card.name;
      const tag = document.createElement("span");
      tag.className = "slot-tag modern";
      tag.textContent = index === 0 ? "开局" : "家当";
      const icon = document.createElement("span");
      icon.className = "slot-icon";
      icon.textContent = card.name.slice(0, 1);
      const badge = document.createElement("span");
      badge.className = "slot-rarity";
      badge.textContent = card.rarity;
      slot.append(tag, icon, badge);
      slot.addEventListener("click", () => showRelic(card));
    } else {
      const empty = document.createElement("span");
      empty.className = "slot-empty-label";
      empty.textContent = "空置";
      slot.append(empty);
    }
    ui.shelf.append(slot);
  }
}

function showRelic(card: Card): void {
  ui.tooltipName.textContent = card.name;
  ui.tooltipRarity.textContent = card.rarity;
  ui.tooltipDesc.textContent = card.description;
  ui.tooltipPerk.textContent = card.check_bonus
    ? "对应检定修正 +" + card.check_bonus.amount + " · " + EnumMapper.translateEnum(card.check_bonus.tag)
    : "本局随身家当";
  ui.tooltip.hidden = false;
  window.clearTimeout(tooltipTimer);
  tooltipTimer = window.setTimeout(() => { ui.tooltip.hidden = true; }, 3200);
}

function appendLogs(logs: readonly LogEntry[]): void {
  if (!logs.length) return;
  const stream = ui.stream;
  const empty = stream.querySelector(".stream-empty");
  empty?.remove();
  const items = LogParser.parseBatch(logs as unknown as EngineRawLog[]);
  for (const item of items) appendFoldCard(item);
  while (stream.children.length > 160) stream.firstElementChild?.remove();
  stream.scrollTop = stream.scrollHeight;
  let cue: AudioCue | null = null;
  for (const log of logs) {
    if (log.type === "death") { fx?.play("poof"); cue = "death"; }
    else if (log.type === "achievement") { fx?.play("confetti"); cue = "achievement"; }
    else if (log.type === "card_selected") cue = "item";
    else if (log.type === "option") cue = "choice";
    else if (log.type === "event" && cue === null) cue = "reveal";
    else if (log.type === "effects" && log.data.effects.some((effect) => effect.type === "attribute_add" && effect.attribute === "wealth" && effect.amount > 0)) { fx?.play("gold"); if (cue === null) cue = "gain"; }
  }
  if (cue) audio.playCue(cue);
}

function appendFoldCard(item: FoldItemData): void {
  const card = document.createElement("article");
  card.className = "fold-card";
  if (item.type === "card_selected") card.classList.add("special-modern");
  if (item.type === "death") card.classList.add("death-card");
  if (item.type === "achievement") card.classList.add("achievement-card");

  const header = document.createElement("div");
  header.className = "card-header-row";
  const age = document.createElement("span");
  age.className = "age-pill";
  age.textContent = item.age === undefined ? "人生记录" : item.age + " 岁";
  const type = document.createElement("span");
  type.className = "event-type-label";
  type.textContent = eventTypeLabel(item);
  header.append(age, type);
  card.append(header);

  if (item.introText) addCardText(card, item.introText, "card-body-text");
  if (item.actionText) addCardText(card, "你的行动：" + item.actionText, "card-action-text");
  if (item.outcomeText) addCardText(card, item.outcomeText, "card-outcome-text");
  if (item.stampTag) {
    const stamp = document.createElement("span");
    stamp.className = "card-stamp";
    stamp.textContent = "【" + item.stampTag + "】";
    card.append(stamp);
  }
  const changes = item.effectsText ?? item.effectsSummary ?? [];
  for (const change of changes) {
    const badge = document.createElement("span");
    badge.className = "card-change-badge " + changeClass(change);
    badge.textContent = change;
    card.append(badge);
  }
  const achievementIds = item.achievementIds ?? [];
  if (achievementIds.length) {
    const data = bundle();
    for (const id of achievementIds) {
      const achievement = data.achievements.find((entry) => entry.id === id);
      if (achievement) addCardText(card, "解锁成就：" + achievement.name, "card-outcome-text");
    }
  }
  ui.stream.append(card);
}

function addCardText(parent: HTMLElement, text: string, className: string): void {
  const node = document.createElement("div");
  node.className = className;
  node.textContent = text;
  parent.append(node);
}

function eventTypeLabel(item: FoldItemData): string {
  if (item.stampTag) return "【" + item.stampTag + "】";
  const labels: Record<string, string> = {
    card_selected: "本局家当",
    history: "历史流年",
    event: "遭遇事件",
    effects: "事件结果",
    achievement: "人生新成就",
    chain: "事业进展",
    death: "人生结局",
    system: "系统记录",
  };
  return labels[item.type] ?? "人生记录";
}

function changeClass(text: string): string {
  if (/[−-]\s*\d/.test(text)) return "change-down";
  if (text.includes("家资") && text.includes("+")) return "change-gain";
  return "change-up";
}

function renderPending(pending: PendingDecision | null): void {
  ui.careerOverlay.hidden = true;
  ui.decision.hidden = true;
  ui.cards.hidden = true;
  if (currentView?.status === "ENDED") {
    renderEnding();
    return;
  }
  if (pending?.kind === "option") {
    renderDecision(pending);
    return;
  }
  if (pending?.kind === "card") {
    ui.cards.hidden = false;
    renderCardOffers(pending.cards);
  }
}

function renderDecision(pending: OptionPending): void {
  const data = bundle();
  const event = data.events.find((item) => item.id === pending.event_id);
  if (!event || event.interaction !== "choice") {
    showToast("事件选项暂时无法显示，请重新打开游戏。");
    return;
  }
  ui.decisionKicker.textContent = eventTypeLabelFromEvent(event);
  ui.decisionDate.textContent = currentView ? currentView.player.calendar_year + " 年" : "";
  ui.decisionTitle.textContent = event.title || "当下抉择";
  ui.decisionDesc.textContent = event.text;
  ui.decisionOptions.replaceChildren();

  for (const option of event.options) {
    const status = pending.options.find((entry) => entry.id === option.id);
    if (!status) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "opt-choice-btn";
    button.disabled = !status.available;

    const action = document.createElement("strong");
    action.textContent = option.text;
    button.append(action);

    const details = optionDetails(event, option, status);
    if (details.length) {
      const detail = document.createElement("span");
      detail.className = "opt-req";
      detail.textContent = details.join(" · ");
      button.append(detail);
    }
    if (!status.available) {
      const unavailable = document.createElement("span");
      unavailable.className = "opt-req";
      unavailable.textContent = status.reason && status.reason !== "OUTCOME_NOT_APPLICABLE"
        ? status.reason
        : "当前条件不足，无法采取这项行动。";
      button.append(unavailable);
    }
    button.addEventListener("click", () => {
      if (button.disabled) return;
      void runAction({ type: "choose", optionId: option.id });
    });
    ui.decisionOptions.append(button);
  }
  ui.decision.hidden = false;
}

function eventTypeLabelFromEvent(event: Event): string {
  const trigger = event.trigger as unknown as { kind?: string };
  if (trigger?.kind === "history") return "历史事件";
  if (trigger?.kind === "crisis") return "危机事件";
  return "待处理事件";
}

function optionDetails(event: Event, option: Option, status: OptionPending["options"][number]): string[] {
  const lines: string[] = [];
  if (option.condition && !status.available) {
    lines.push("门槛：" + EnumMapper.describeCondition(option.condition, bundle()));
  }
  const rawEffects = option.outcome.effects as unknown as Array<Record<string, unknown>>;
  let immediateDeath = rawEffects.some((effect) => effect.type === "death");
  let chainCommitment = "";
  for (const effect of rawEffects) {
    if (effect.type === "attribute_add" && typeof effect.amount === "number" && effect.amount < 0) {
      const stat = EnumMapper.translateStat(String(effect.attribute)).name;
      lines.push("立即消耗：" + stat + " " + effect.amount);
    }
    if (effect.type === "chain_start" && typeof effect.id === "string") {
      chainCommitment = bundle().chains.find((chain) => chain.id === effect.id)?.commitment ?? "";
      if (chainCommitment) lines.push("开始前请留意：" + chainCommitment);
    }
  }
  if (immediateDeath || outcomeMayKill(option.outcome, event, new Set<string>())) {
    lines.push(immediateDeath ? "后果：此选择会导致死亡。" : "风险：后续阶段可能丧命。");
  }
  for (const check of status.checks) {
    lines.push("后续检定：" + EnumMapper.translateStat(check.attribute).name + "，成功率 " + Math.round(check.success_probability * 100) + "%");
  }
  if (option.risk) lines.push("风险等级：" + EnumMapper.translateEnum(option.risk));
  return [...new Set(lines)];
}

function outcomeMayKill(outcome: Option["outcome"], event: Event, seen: Set<string>): boolean {
  const raw = outcome as unknown as { effects: Array<Record<string, unknown>>; next_stage_id: string | null };
  if (raw.effects.some((effect) => effect.type === "death")) return true;
  if (!raw.next_stage_id || seen.has(raw.next_stage_id)) return false;
  seen.add(raw.next_stage_id);
  const stage = event.stages?.find((entry) => entry.id === raw.next_stage_id);
  if (!stage) return false;
  return [stage.success, stage.failure, stage.critical_success].some((branch) =>
    branch ? outcomeMayKill(branch, event, seen) : false
  );
}

function renderCareer(): void {
  const data = bundle();
  const active = currentView?.player.chains.filter((chain) => chain.status === "active") ?? [];
  ui.careerList.replaceChildren();
  if (!active.length) {
    const empty = document.createElement("div");
    empty.className = "stream-empty";
    empty.textContent = "目前没有正在推进的事业。";
    ui.careerList.append(empty);
    return;
  }
  for (const chainState of active) {
    const definition = data.chains.find((entry) => entry.id === chainState.chain_id);
    if (!definition) continue;
    const row = document.createElement("div");
    row.className = "career-item";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = definition.name;
    const progress = document.createElement("div");
    progress.className = "opt-req";
    progress.textContent = "已推进 " + Math.min(chainState.node_index + 1, definition.nodes.length) + " / " + definition.nodes.length + " 步";
    info.append(title, progress);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-sub";
    button.textContent = "退出事业";
    button.disabled = busy || currentView?.status === "AWAITING_STAGE";
    button.addEventListener("click", () => {
      void runAction({ type: "abandon", chainInstanceId: chainState.instance_id });
    });
    row.append(info, button);
    ui.careerList.append(row);
  }
}

function renderEnding(): void {
  if (!session || !currentView) return;
  const report: EndingReport | null = session.exportSave().engine.payload.run.ending;
  if (!report) return;
  if (activeLifeId && recordedLifeId !== activeLifeId) {
    lifetimeRecords.record(activeLifeId, report);
    recordedLifeId = activeLifeId;
  }
  const data = bundle();
  const death = data.deaths.find((item) => item.id === report.death_id);
  const primary = report.primary_achievement_id
    ? data.achievements.find((item) => item.id === report.primary_achievement_id)
    : undefined;
  const summary = [
    death?.name ? "【" + death.name + "】" : "这段人生走到了终点。",
    death?.text ?? "",
    "你从 " + report.start_age + " 岁走到 " + report.end_age + " 岁，共经历 " + report.years_played + " 年。",
    primary ? "代表成就：" + primary.name + " · " + primary.text : "",
  ].filter(Boolean).join("\n\n");
  ui.endingSummary.textContent = summary;
  ui.endingAge.textContent = report.end_age + " 岁";
  ui.endingWealth.textContent = formatWealth(report.final_attributes.wealth);
  ui.endingAchievementCount.textContent = String(report.achievements.length) + " 项";

  ui.endingAchievementList.replaceChildren();
  for (const id of report.achievements) {
    const achievement = data.achievements.find((item) => item.id === id);
    if (!achievement) continue;
    const row = document.createElement("div");
    row.className = "career-item";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = achievement.name + " · " + EnumMapper.achievementMeta(achievement);
    const text = document.createElement("div");
    text.className = "opt-req";
    text.textContent = achievement.text;
    info.append(name, text);
    row.append(info);
    ui.endingAchievementList.append(row);
  }
  ui.ending.hidden = false;
  ui.advance.disabled = false;
}

function resetToHome(): void {
  ui.recordsOverlay.hidden = true;
  ui.audioOverlay.hidden = true;
  ui.ending.hidden = true;
  ui.decision.hidden = true;
  ui.cards.hidden = true;
  ui.careerOverlay.hidden = true;
  ui.identity.hidden = true;
  ui.game.hidden = true;
  ui.home.hidden = false;
  ui.stream.replaceChildren();
  currentView = null;
  session = null;
  saveSlot = null;
  selectedCardId = null;
  activeLifeId = "";
  recordedLifeId = "";
  audio.playMusic("home");
  audio.playAmbience(null);
}

function openCareer(): void {
  if (!currentView) return;
  renderCareer();
  ui.careerOverlay.hidden = false;
}

function closeCareer(): void {
  ui.careerOverlay.hidden = true;
}

function eventIsChoicePending(): boolean {
  return currentView?.pending?.kind === "option";
}

function onAdvance(): void {
  if (!session || !currentView || busy) return;
  if (currentView.status === "ENDED") {
    renderEnding();
    return;
  }
  if (currentView.status === "AWAITING_OPTION") {
    showToast("请先完成当前选择，再继续往下走。");
    ui.decision.hidden = false;
    return;
  }
  if (currentView.status === "AWAITING_CARD") {
    ui.cards.hidden = false;
    return;
  }
  void runAction({ type: "next" });
}

function showRecords(achievementsOnly: boolean): void {
  const snapshot = lifetimeRecords.snapshot();
  ui.recordsList.replaceChildren();
  ui.recordsTitle.textContent = achievementsOnly ? "生涯成就" : "人生统计";
  if (achievementsOnly) {
    ui.recordsSummary.textContent = "已完成 " + snapshot.completed + " 段人生 · 获得 " + snapshot.achievements.size + " 项成就";
    if (!snapshot.achievements.size) {
      const empty = document.createElement("div");
      empty.className = "stream-empty";
      empty.textContent = "还没有解锁成就。完成一段人生后，成就会留在这里。";
      ui.recordsList.append(empty);
    } else {
      for (const id of snapshot.achievements) {
        const achievement = bundle().achievements.find((item) => item.id === id);
        if (!achievement) continue;
        const row = document.createElement("div");
        row.className = "career-item records-achievement";
        const name = document.createElement("strong");
        name.textContent = achievement.name + " · " + EnumMapper.achievementMeta(achievement);
        const description = document.createElement("span");
        description.textContent = achievement.text;
        row.append(name, description);
        ui.recordsList.append(row);
      }
    }
  } else {
    ui.recordsSummary.textContent = [
      "完成的人生  " + snapshot.completed + " 次",
      "最长寿命  " + snapshot.longest + " 岁",
      "累计经历  " + snapshot.years + " 年",
      "已获成就  " + snapshot.achievements.size + " 项",
      "",
      "仅统计本机完成的人生；当前未结束的进度不计入。",
    ].join("\n");
  }
  ui.recordsWarning.textContent = snapshot.warning;
  ui.recordsOverlay.hidden = false;
}

function syncAudioSettings(): void {
  const settings = audio.getSettings();
  const channels: AudioChannel[] = ["music", "effects", "ambience"];
  for (const channel of channels) {
    ui.volumeInputs[channel].value = String(settings[channel]);
    ui.volumeOutputs[channel].value = Math.round(settings[channel] * 100) + "%";
    ui.volumeOutputs[channel].textContent = Math.round(settings[channel] * 100) + "%";
  }
  const muted = channels.every((channel) => settings[channel] === 0);
  ui.audioMute.textContent = muted ? "恢复声音" : "全部静音";
}

function openAudioSettings(): void {
  audio.unlock();
  syncAudioSettings();
  ui.audioOverlay.hidden = false;
}

function toggleAudioMute(): void {
  const channels: AudioChannel[] = ["music", "effects", "ambience"];
  const current = audio.getSettings();
  if (channels.every((channel) => current[channel] === 0) && lastAudibleSettings) {
    for (const channel of channels) audio.setVolume(channel, lastAudibleSettings[channel]);
    lastAudibleSettings = null;
  } else {
    lastAudibleSettings = current;
    for (const channel of channels) audio.setVolume(channel, 0);
  }
  syncAudioSettings();
}
function initializePage(): void {
  syncAudioSettings();
  try {
    fx = createPixelFx();
    void fx.initialize().catch(() => showToast("特效素材未能载入，游戏流程不受影响。"));
    ui.start.addEventListener("click", () => { void startNewLife(); });
    ui.identityNext.addEventListener("click", openCardSelection);
    ui.confirmCard.addEventListener("click", () => { void chooseOpeningCard(); });
    ui.advance.addEventListener("click", onAdvance);
    ui.career.addEventListener("click", openCareer);
    ui.careerFromDecision.addEventListener("click", openCareer);
    ui.closeCareer.addEventListener("click", closeCareer);
    ui.scrollBottom.addEventListener("click", () => { ui.stream.scrollTop = ui.stream.scrollHeight; });
    for (const channel of ["music", "effects", "ambience"] as const) {
      ui.volumeInputs[channel].addEventListener("input", () => {
        audio.setVolume(channel, Number(ui.volumeInputs[channel].value));
        syncAudioSettings();
      });
    }
    ui.audioMute.addEventListener("click", toggleAudioMute);
    ui.restartEnding.addEventListener("click", resetToHome);
    ui.homeStats.addEventListener("click", () => { audio.unlock(); showRecords(false); });
    ui.homeAchievements.addEventListener("click", () => { audio.unlock(); showRecords(true); });
    ui.homeSound.addEventListener("click", openAudioSettings);
    ui.closeRecords.addEventListener("click", () => { ui.recordsOverlay.hidden = true; });
    ui.closeAudio.addEventListener("click", () => { ui.audioOverlay.hidden = true; });
    ui.recordsOverlay.addEventListener("click", (event) => { if (event.target === ui.recordsOverlay) ui.recordsOverlay.hidden = true; });
    ui.audioOverlay.addEventListener("click", (event) => { if (event.target === ui.audioOverlay) ui.audioOverlay.hidden = true; });
    ui.careerOverlay.addEventListener("click", (event) => {
      if (event.target === ui.careerOverlay) closeCareer();
    });
    ui.decision.addEventListener("click", (event) => {
      if (event.target === ui.decision && currentView?.status === "AWAITING_OPTION") {
        showToast("请先完成当前选择。");
      }
    });
    ui.cards.addEventListener("click", (event) => {
      if (event.target === ui.cards) showToast("请选择一件本局家当。");
    });
  } catch (error) {
    showToast("页面初始化失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

interface FxAsset {
  id: string;
  image: string;
  fps: number;
  duration_seconds: number;
  frame_size: [number, number];
  sheet: { frames: Array<{ frame: { x: number; y: number; w: number; h: number } }> };
}

interface PixelFxPlayer {
  initialize(): Promise<void>;
  play(key: "gold" | "poof" | "confetti"): void;
}

function createPixelFx(): PixelFxPlayer {
  const sourceAssets = new Map<string, FxAsset>();
  const mappings = {
    candle: { id: "FX_MING_CANDLE", canvas: "canvas-candle", loop: true },
    gold: { id: "FX_COLLECT_BURST", canvas: "canvas-gold", loop: false },
    poof: { id: "FX_COMIC_POOF", canvas: "canvas-poof", loop: false },
    confetti: { id: "FX_ACHIEVE_CONFETTI", canvas: "canvas-confetti", loop: false },
  } as const;
  const loaded = new Map<keyof typeof mappings, { asset: FxAsset; image: HTMLImageElement; context: CanvasRenderingContext2D; time: number }>();
  let last = 0;
  let running = true;

  const draw = (key: keyof typeof mappings, entry: typeof loaded extends Map<any, infer V> ? V : never): void => {
    const frameList = entry.asset.sheet.frames;
    if (!frameList.length) return;
    const frameIndex = Math.floor(entry.time * entry.asset.fps);
    if (!mappings[key].loop && entry.time >= entry.asset.duration_seconds) {
      const element = document.getElementById(mappings[key].canvas);
      if (element?.parentElement) (element.parentElement as HTMLElement).hidden = true;
      entry.context.clearRect(0, 0, entry.context.canvas.width, entry.context.canvas.height);
      return;
    }
    const frame = frameList[frameIndex % frameList.length].frame;
    entry.context.clearRect(0, 0, entry.context.canvas.width, entry.context.canvas.height);
    entry.context.drawImage(entry.image, frame.x, frame.y, frame.w, frame.h, 0, 0, entry.context.canvas.width, entry.context.canvas.height);
  };

  const tick = (now: number): void => {
    if (!last) last = now;
    const elapsed = (now - last) / 1000;
    last = now;
    if (running && !document.hidden) {
      for (const [key, entry] of loaded) {
        if (key !== "candle" && entry.time < entry.asset.duration_seconds + 0.05) entry.time += elapsed;
        else if (key === "candle") entry.time += elapsed;
        draw(key, entry);
      }
    }
    requestAnimationFrame(tick);
  };

  return {
    async initialize(): Promise<void> {
      for (const [key, config] of Object.entries(mappings) as Array<[keyof typeof mappings, (typeof mappings)[keyof typeof mappings]]>) {
        const asset = sourceAssets.get(config.id);
        const canvas = document.getElementById(config.canvas) as HTMLCanvasElement | null;
        if (!asset || !canvas) continue;
        const context = canvas.getContext("2d");
        if (!context) continue;
        context.imageSmoothingEnabled = false;
        canvas.width = asset.frame_size[0];
        canvas.height = asset.frame_size[1];
        const image = new Image();
        await new Promise<void>((resolve) => {
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = new URL(asset.image, document.baseURI).href;
          if (image.complete) resolve();
        });
        if (!image.naturalWidth) continue;
        loaded.set(key, { asset, image, context, time: 0 });
        if (key !== "candle" && canvas.parentElement) canvas.parentElement.hidden = true;
      }
      document.addEventListener("visibilitychange", () => { running = !document.hidden; });
      requestAnimationFrame(tick);
    },
    play(key): void {
      const entry = loaded.get(key);
      if (!entry) return;
      entry.time = 0;
      const config = mappings[key];
      const canvas = document.getElementById(config.canvas);
      if (canvas?.parentElement) (canvas.parentElement as HTMLElement).hidden = false;
    },
  };
}

initializePage();