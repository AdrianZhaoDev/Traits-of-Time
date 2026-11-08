import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Button, Node, UITransform, Label, UIOpacity, view } from '../mocks/cc-mock';
import { RelicBarController, type RelicItemData } from '../../assets/scripts/presentation/RelicBarController';
import { GameMain } from '../../assets/scripts/presentation/GameMain';
import type { SessionSave } from '../../assets/scripts/application/GameSession';
import { getNativeMingEndContent } from '../../assets/scripts/application/NativeContentLoader';
import * as NativeContentLoader from '../../assets/scripts/application/NativeContentLoader';
import { sha256Json } from '../../assets/scripts/core/persistence/JsonDigest';
import { useLegacyRelicPool } from '../helpers/content';
import { EnumMapper } from '../../assets/scripts/presentation/EnumMapper';
import { LogParser } from '../../assets/scripts/presentation/LogParser';
import { EventFoldItem } from '../../assets/scripts/presentation/EventFoldItem';
import { OpeningFlow } from '../../assets/scripts/presentation/OpeningFlow';

beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(1628 / 0x1_0000_0000); });
afterEach(() => { vi.restoreAllMocks(); });

function descendants(node: Node): Node[] {
  return [node, ...node.children.flatMap(descendants)];
}

function displayedText(node: Node): string {
  return descendants(node).map(child => child.getComponent(Label)?.string ?? '').join('\n');
}

async function selectOpeningCard(gameMain: GameMain, preferredCard?: string): Promise<string> {
  const opening = descendants(gameMain.node).find(node => node.name === 'OpeningFlow')!.getComponent(OpeningFlow)!;
  const home = descendants(opening.node).find(node => node.name === 'OpeningPage_home')!;
  const homeItems = descendants(home).find(node => node.name === 'OpeningItems')!;
  descendants(homeItems).find(node => node.getComponent(Button))!.emit(Node.EventType.TOUCH_END);
  await vi.waitFor(() => expect(gameMain.getCurrentView()?.status).toBe('AWAITING_CARD'));
  const pending = gameMain.getCurrentView()!.pending;
  if (pending?.kind !== 'card') throw new Error('Expected card offers');
  expect(gameMain.getCurrentView()!.player.cards).toEqual([]);
  await vi.waitFor(() => expect(descendants(opening.node).some(node => node.name === 'OpeningPage_identity')).toBe(true));
  opening.update(3);
  const identity = descendants(opening.node).find(node => node.name === 'OpeningPage_identity')!;
  const identityFooter = descendants(identity).find(node => node.name === 'OpeningFooter')!;
  descendants(identityFooter).find(node => node.getComponent(Button))!.emit(Node.EventType.TOUCH_END);
  opening.update(3);
  const paper = descendants(opening.node).find(node => node.name === 'OpeningPage_cards')!;
  const cardsFooter = descendants(paper).find(node => node.name === 'OpeningFooter')!;
  const confirm = descendants(cardsFooter).find(node => node.getComponent(Button))!;
  confirm.emit(Node.EventType.TOUCH_END);
  expect(gameMain.getCurrentView()?.status).toBe('AWAITING_CARD');
  await gameMain.triggerAdvance();
  expect(gameMain.getCurrentView()?.status).toBe('AWAITING_CARD');
  const cardId = preferredCard ?? pending.cards[pending.cards.length - 1]!;
  descendants(paper).find(node => node.name === `CardOffer_${cardId}`)!.emit(Node.EventType.TOUCH_END);
  confirm.emit(Node.EventType.TOUCH_END);
  await vi.waitFor(() => expect(gameMain.getCurrentView()!.player.cards).toEqual([cardId]));
  expect(gameMain.getCurrentView()?.status).toBe('AWAITING_OPTION');
  expect(gameMain.getMemorialCard()!.node.active).toBe(true);
  return cardId;
}

function useWorkshopOpeningFixture(): void {
  const bundle = structuredClone(getNativeMingEndContent().bundle);
  // Retain the native-book workshop route and its seed independently of production offers.
  useLegacyRelicPool(bundle);
  vi.spyOn(NativeContentLoader, 'getNativeMingEndContent').mockReturnValue({
    bundle,
    fingerprint: sha256Json(bundle),
  });
}

async function enterWorkshopFromRelic(gameMain: GameMain): Promise<void> {
  await selectOpeningCard(gameMain, 'CARD_NATIVE_BOOK');
  descendants(gameMain.getMemorialCard()!.node)
    .find(node => node.name === 'Option_invest')!.emit(Node.EventType.TOUCH_END);
  await vi.waitFor(() => {
    const pending = gameMain.getCurrentView()!.pending;
    expect(pending?.kind === 'option' && pending.options.some(option => option.id === 'career_ch_workshop' && option.available)).toBe(true);
  });
  descendants(gameMain.getMemorialCard()!.node)
    .find(node => node.name === 'Option_career_ch_workshop')!.emit(Node.EventType.TOUCH_END);
}
describe('UI Refactor Phase 4 - Relic Shelf & GameMain Integration', () => {
  describe('RelicBarController component logic', () => {
    it('initializes 5 antique display shelf slots upon onLoad', () => {
      const node = new Node('RelicBarRoot');
      const relicBar = node.addComponent(RelicBarController);
      relicBar.onLoad();

      expect(relicBar.getRelics()).toHaveLength(0);
      for (let i = 0; i < 5; i++) {
        const slot = relicBar.getSlotNode(i);
        expect(slot).not.toBeNull();
        expect(slot?.name).toBe(`RelicSlot_${i}`);
      }
      expect(relicBar.getSlotNode(5)).toBeNull();
    });

    it('adds heirloom and rare entries, deduplicates and caps at shelf capacity', () => {
      const node = new Node('RelicBarRoot');
      const relicBar = node.addComponent(RelicBarController);
      relicBar.onLoad();

      const item1: RelicItemData = {
        id: 'relic_iron_armor',
        name: '传家之宝',
        desc: '锁片铿锵甲光向日，披挂在身刀枪难透',
      };
      relicBar.addRelic(item1);

      expect(relicBar.getRelics()).toHaveLength(1);
      expect(relicBar.getRelics()[0]?.id).toBe('relic_iron_armor');

      // Duplicate addition should be ignored
      relicBar.addRelic(item1);
      expect(relicBar.getRelics()).toHaveLength(1);

      // Fill remaining 4 slots
      for (let i = 2; i <= 5; i++) {
        relicBar.addRelic({
          id: `relic_${i}`,
          name: `宝物${i}`,
          desc: `宝物描述${i}`,
        });
      }
      expect(relicBar.getRelics()).toHaveLength(5);

      // Exceeding capacity should be safely ignored
      relicBar.addRelic({
        id: 'relic_overflow',
        name: '溢出宝物',
        desc: '无法存入',
      });
      expect(relicBar.getRelics()).toHaveLength(5);
    });

    it('keeps all five slots clear of the hint on a short shelf', () => {
      const node = new Node('ShortShelf');
      const shelf = node.addComponent(RelicBarController);
      shelf.onLoad();
      shelf.setHeight(600);
      const hint = node.getChildByName('ShelfHint')!;
      const hintTop = hint.position.y + hint.getComponent(UITransform)!.height / 2;
      const last = shelf.getSlotNode(4)!;
      const lastBottom = last.position.y - last.getComponent(UITransform)!.height * last.scale.y / 2;
      expect(lastBottom).toBeGreaterThan(hintTop);
      for (let i = 0; i < 4; i++) {
        const upper = shelf.getSlotNode(i)!;
        const lower = shelf.getSlotNode(i + 1)!;
        expect(upper.position.y - upper.getComponent(UITransform)!.height * upper.scale.y / 2)
          .toBeGreaterThan(lower.position.y + lower.getComponent(UITransform)!.height * lower.scale.y / 2);
      }
    });


  });

  describe('GameMain full orchestration & UI tree integration', () => {
    it('keeps gameplay uninitialized at home and commits only the selected revealed offer', async () => {
      const root = new Node('OpeningJourney');
      const game = root.addComponent(GameMain);
      game.onLoad();
      expect(game.getSession()).toBeNull();
      await game.triggerAdvance();
      expect(game.getSession()).toBeNull();
      const chosen = await selectOpeningCard(game);
      const card = getNativeMingEndContent().bundle.cards.find(item => item.id === chosen)!;
      expect(card.tags).toContain('modern');
      expect(game.getCurrentView()!.player.cards).toEqual([chosen]);
      expect(root.getChildByName('OpeningFlow')!.active).toBe(false);
    });



    it('waits for an in-flight automatic stage when advance is pressed again', async () => {
      useWorkshopOpeningFixture();
      const root = new Node('GameMainRoot');
      const gameMain = root.addComponent(GameMain);
      gameMain.onLoad();
      await enterWorkshopFromRelic(gameMain);
      await vi.waitFor(() => expect(gameMain.getCurrentView()!.status).toBe('READY'));
      const age = gameMain.getCurrentView()!.player.age;
      const session: unknown = gameMain.getSession();
      if (!session || typeof session !== 'object' || !('ports' in session)) throw new Error('Missing session ports');
      const ports = session.ports;
      if (!ports || typeof ports !== 'object' || !('persist' in ports) || typeof ports.persist !== 'function') throw new Error('Missing persistence port');
      const persist = ports.persist;
      // Node 22 provides this method, but the project type library targets ES2022.
      const promiseApi = Promise as unknown as { withResolvers(): { promise: Promise<void>; resolve(): void } };
      const gate = promiseApi.withResolvers();
      let held = false;
      ports.persist = async (save: SessionSave) => {
        if (!held && save.replay_commands.at(-1)?.api === 'resolveStage') {
          held = true;
          await gate.promise;
        }
        await persist(save);
      };
      try {
        await gameMain.triggerAdvance();
        await vi.waitFor(() => expect(held).toBe(true));
        expect(gameMain.getCurrentView()!.status).toBe('AWAITING_STAGE');
        const repeated = gameMain.triggerAdvance();
        gate.resolve();
        await repeated;
        expect(gameMain.getCurrentView()!.status).toBe('READY');
        expect(gameMain.getCurrentView()!.player.age).toBe(age + 1);
        expect(gameMain.getSession()!.exportSave().replay_commands.every(command => !command.error_code)).toBe(true);
      } finally {
        gate.resolve();
        ports.persist = persist;
      }
    });

    it('lets a player cancel or confirm exit while a career decision is pending', async () => {
      useWorkshopOpeningFixture();
      const mainNode = new Node('GameMainRoot');
      const gameMain = mainNode.addComponent(GameMain);
      gameMain.onLoad();
      await enterWorkshopFromRelic(gameMain);
      const card = gameMain.getMemorialCard()!.node;
      await vi.waitFor(() => expect(gameMain.getCurrentView()!.player.chains.some(chain => chain.chain_id === 'CH_WORKSHOP' && chain.status === 'active')).toBe(true));
      const pendingEventId = () => {
        const pending = gameMain.getCurrentView()!.pending;
        return pending?.kind === 'option' ? pending.event_id : null;
      };
      await gameMain.triggerAdvance();
      await vi.waitFor(() => expect(gameMain.getCurrentView()!.status).toBe('READY'));
      await gameMain.triggerAdvance();
      await vi.waitFor(() => expect(pendingEventId()).toBe('E_CHAIN_3'));

      const overlay = gameMain.getDecisionOverlay()!;
      descendants(card).find(node => node.name === 'ManageCareers')!.emit(Node.EventType.TOUCH_END);
      let panel = overlay.children.find(node => node.name === 'CareerPanel')!;
      panel.children.find(node => node.name === 'Btn_返回')!.emit(Node.EventType.TOUCH_END);
      expect(pendingEventId()).toBe('E_CHAIN_3');
      expect(gameMain.getCurrentView()!.player.chains.find(chain => chain.chain_id === 'CH_WORKSHOP')!.status).toBe('active');

      descendants(card).find(node => node.name === 'ManageCareers')!.emit(Node.EventType.TOUCH_END);
      panel = overlay.children.find(node => node.name === 'CareerPanel')!;
      const careerContent = panel.children.find(node => node.name === 'CareerScrollView')!
        .children.find(node => node.name === 'Viewport')!.children.find(node => node.name === 'Content')!;
      const confirm = panel.children.find(node => node.name === 'Btn_确认退出事业')!;
      expect(confirm.getComponent(Button)?.interactable).toBe(false);
      confirm.emit(Node.EventType.TOUCH_END);
      expect(gameMain.getCurrentView()!.player.chains.find(chain => chain.chain_id === 'CH_WORKSHOP')!.status).toBe('active');
      const workshopName = getNativeMingEndContent().bundle.chains.find(chain => chain.id === 'CH_WORKSHOP')!.name;
      careerContent.children.find(node => displayedText(node).includes(workshopName))!.emit(Node.EventType.TOUCH_END);
      expect(confirm.getComponent(Button)?.interactable).toBe(true);
      expect(gameMain.getCurrentView()!.player.chains.find(chain => chain.chain_id === 'CH_WORKSHOP')!.status).toBe('active');
      confirm.emit(Node.EventType.TOUCH_END);
      await vi.waitFor(() => expect(gameMain.getCurrentView()!.player.chains.find(chain => chain.chain_id === 'CH_WORKSHOP')!.status).toBe('interrupted'));
      expect(pendingEventId()).not.toBe('E_CHAIN_3');
    });

    it('does not revive the view after teardown when its seal child is already destroyed', async () => {
      const root = new Node('DestroyedScene');
      const game = root.addComponent(GameMain);
      game.onLoad();
      game.getSealAdvanceBtn()!.destroy();
      game.onDestroy();
      await game.triggerAdvance();
      expect(game.getSession()).toBeNull();
      expect(game.getCurrentView()).toBeNull();
      expect(game.isHoldingSeal()).toBe(false);
      expect(game.getDecisionOverlay()!.getChildByName('CardChoice')).toBeNull();
    });

    it('keeps the seal within the visible short-screen bounds', async () => {
      const height = 1136;
      vi.spyOn(view, 'getVisibleSize').mockReturnValue({ width: 750, height });
      const root = new Node('ShortScreen');
      const game = root.addComponent(GameMain);
      game.onLoad();
      await selectOpeningCard(game);
      const seal = game.getSealAdvanceBtn()!;
      const bounds = seal.getComponent(UITransform)!;
      const center = seal.parent!.position.y + seal.position.y;
      expect(center - bounds.height / 2).toBeGreaterThanOrEqual(-height / 2);
      expect(center + bounds.height / 2).toBeLessThanOrEqual(height / 2);
    });

    it('starts repeating at 0.35 seconds and preserves death until a new gesture', async () => {
      vi.mocked(Math.random).mockReturnValue(3 / 0x1_0000_0000);
      useWorkshopOpeningFixture();
      const root = new Node('NaturalDeath');
      const game = root.addComponent(GameMain);
      game.onLoad();
      await selectOpeningCard(game, 'CARD_MODERN_CALCULATOR');
      const choose = (id: string) => descendants(game.getMemorialCard()!.node)
        .find(node => node.name === `Option_${id}`)!.emit(Node.EventType.TOUCH_END);
      choose('withdraw');
      await vi.waitFor(() => {
        const pending = game.getCurrentView()?.pending;
        expect(pending?.kind === 'option' && pending.event_id).toBe('E_SOC_YOUTH_APPRENTICE');
      });
      choose('decline');
      await vi.waitFor(() => expect(game.getCurrentView()?.status).toBe('READY'));
      const seal = game.getSealAdvanceBtn()!;
      seal.emit(Node.EventType.TOUCH_START);
      await vi.waitFor(() => expect(game.getCurrentView()?.status).toBe('READY'));
      await game.triggerAdvance();
      await vi.waitFor(() => expect(game.getCurrentView()?.status).toBe('READY'));
      const initialYear = game.getCurrentView()!.player.calendar_year;
      game.update(0.349);
      expect(game.getCurrentView()!.player.calendar_year).toBe(initialYear);
      game.update(0.001);
      await vi.waitFor(() => expect(game.getCurrentView()!.player.calendar_year).toBe(initialYear + 1));
      seal.emit(Node.EventType.TOUCH_CANCEL);
      await vi.waitFor(() => expect(game.getCurrentView()?.status).toBe('READY'));
      while (game.getCurrentView()!.player.calendar_year < 1635) {
        await game.triggerAdvance();
        await vi.waitFor(() => expect(game.getCurrentView()?.status).toBe('READY'));
      }
      seal.emit(Node.EventType.TOUCH_START);
      await vi.waitFor(() => expect(game.getCurrentView()?.status).toBe('ENDED'));
      const session = game.getSession();
      seal.emit(Node.EventType.TOUCH_END);
      expect(game.getCurrentView()?.status).toBe('ENDED');
      expect(game.getSession()).toBe(session);
      expect(game.getSession()!.exportSave().engine.payload.run.death).toBe('D_MOD_CALCULATOR_HERESY_FIRE');
      seal.emit(Node.EventType.TOUCH_START);
      seal.emit(Node.EventType.TOUCH_END);
      await vi.waitFor(() => expect(game.getCurrentView()?.status).toBe('AWAITING_CARD'));
      expect(game.getCurrentView()!.player.cards).toEqual([]);
    });

    it('shows the real death report and permits restarting a completed life', async () => {
      useWorkshopOpeningFixture();
      const root = new Node('GameMainRoot');
      const gameMain = root.addComponent(GameMain);
      gameMain.onLoad();
      await selectOpeningCard(gameMain, 'CARD_MODERN_FLASHLIGHT');
      const overlay = gameMain.getDecisionOverlay()!;
      await vi.waitFor(() => expect(gameMain.getCurrentView()?.pending?.kind).toBe('option'));
      const clickOption = (id: string) => descendants(gameMain.getMemorialCard()!.node)
        .find(node => node.name === `Option_${id}`)!.emit(Node.EventType.TOUCH_END);
      clickOption('career_study');
      await vi.waitFor(() => expect(gameMain.getCurrentView()?.status).toBe('READY'));
      await gameMain.triggerAdvance();
      await vi.waitFor(() => {
        const pending = gameMain.getCurrentView()?.pending;
        expect(pending?.kind === 'option' && pending.event_id).toBe('E_MOD_FLASHLIGHT_EVIDENCE');
      });
      const decisionRows = descendants(gameMain.getMemorialCard()!.node);
      expect(displayedText(decisionRows.find(node => node.name === 'Option_flashlight_robbery')!)).toMatch(/丧命|死亡/);
      expect(displayedText(decisionRows.find(node => node.name === 'Option_flashlight_study')!)).not.toMatch(/丧命|死亡/);
      clickOption('flashlight_robbery');
      await vi.waitFor(() => expect(gameMain.getCurrentView()?.status).toBe('ENDED'));
      const report = gameMain.getSession()!.exportSave().engine.payload.run.ending!;
      const bundle = getNativeMingEndContent().bundle;
      const death = bundle.deaths.find(item => item.id === report.death_id)!;
      const achievement = bundle.achievements.find(item => item.id === 'A_MOD_FLASHLIGHT_DEATH_ROBBERY')!;
      expect(report.achievements).toContain(achievement.id);
      descendants(root).find(node => node.name === 'Btn_事业')!.emit(Node.EventType.TOUCH_END);
      const careerPanel = overlay.children.find(node => node.name === 'CareerPanel')!;
      careerPanel.children.find(node => node.name === 'Btn_人生总结')!.emit(Node.EventType.TOUCH_END);
      const panel = overlay.children.find(node => node.name === 'EndingPanel')!;
      expect(displayedText(panel)).toContain(death.text);
      expect(displayedText(panel)).toContain(achievement.name);
      const firstSeed = gameMain.getSession()!.exportSave().engine.payload.run.seed;
      vi.mocked(Math.random).mockReturnValue(2000 / 0x1_0000_0000);
      panel.children.find(node => node.name === 'Btn_返回首页')!.emit(Node.EventType.TOUCH_END);
      descendants(root).find(node => node.name === 'Btn_我要穿越')!.emit(Node.EventType.TOUCH_END);
      await vi.waitFor(() => expect(gameMain.getCurrentView()?.status).toBe('AWAITING_CARD'));
      expect(gameMain.getCurrentView()!.player.cards).toEqual([]);
      const restarted = gameMain.getSession()!.exportSave();
      expect(firstSeed).toBe(1628);
      expect(restarted.engine.payload.run.seed).toBe(2000);
      expect(restarted.replay_commands[0]).toMatchObject({ api: 'initGame', args: { seed: 2000 } });
    });
  });
});
