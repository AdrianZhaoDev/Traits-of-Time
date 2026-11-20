/** Approved A: a bright comic broadside, with program-drawn text and a static brand prop. */
import { MEMORY_NOTICE, type AppSnapshot, type GameController } from './controller';
import { HOME_TITLE } from './brand';
import type { GamePlatform } from './platform';
import { Ui, fonts, ink } from './ui';

const [titleStart, titleMiddle, titleFinale] = HOME_TITLE.split('\n') as [string, string, string];

/** Keep every real entry and warning in the same scrollable, safe-area-aware layout. */
export function buildHome(ui: Ui, snapshot: AppSnapshot, height: number, controller: GameController): string {
  const gutter = ui.px(ui.viewportWidth <= 340 ? 20 : 24);
  const width = 750 - gutter * 2;
  const compact = height * ui.viewportWidth / 750 < 700;
  const hasNotice = snapshot.notice !== '' && snapshot.notice !== MEMORY_NOTICE;
  const topPadding = ui.px(compact ? 16 : 20);
  const headerHeight = ui.px(24);
  const heroGap = ui.px(compact ? 16 : 24);
  const titleGap = ui.px(4);
  const startSize = ui.px(Math.min(58, Math.max(41, ui.viewportWidth * 0.13)));
  const middleSize = ui.px(Math.min(36, Math.max(28, ui.viewportWidth * 0.08)));
  const finaleSize = ui.px(Math.min(60, Math.max(43, ui.viewportWidth * 0.136)));
  const startLine = Math.ceil(startSize * 1.13);
  const middleLine = Math.ceil(middleSize * 1.13);
  const finaleLine = Math.ceil(finaleSize * 1.13);
  const illustrationGap = ui.px(4);
  const promiseGap = ui.px(compact ? 8 : 12);
  const promiseLine = ui.px(26);
  const actionsGap = ui.px(compact ? 12 : 20);
  const primaryHeight = ui.px(63);
  const hintGap = ui.px(compact ? 12 : 14);
  const hintLine = ui.px(20);
  const utilitiesGap = ui.px(12);
  const utilityHeight = ui.px(48);
  const warningGap = ui.px(compact ? 12 : 16);
  const warningLine = ui.px(22);
  const bottomPadding = ui.px(compact ? 16 : 20);
  const fixedHeight = topPadding + headerHeight + heroGap + startLine + middleLine + finaleLine
    + titleGap * 2 + illustrationGap + promiseGap + promiseLine * 2 + actionsGap + primaryHeight
    + hintGap + hintLine + utilitiesGap + utilityHeight + warningGap + warningLine * 2 + bottomPadding;
  // Short screens spend less on the illustration and whitespace, never on readable type or targets.
  const illustrationHeight = Math.max(ui.px(64), Math.min(ui.px(hasNotice ? 64 : compact ? 102 : 188), height - fixedHeight));
  const spareHeight = hasNotice ? 0 : Math.max(0, height - fixedHeight - illustrationHeight);
  const heroTopExtra = Math.floor(spareHeight / 2);
  const heroBottomExtra = spareHeight - heroTopExtra;
  const headerLeft = Math.floor(width / 2);
  const header = ui.row(
    ui.text('穿越人生模拟', headerLeft, {
      fontSize: ui.px(13), lineHeight: ui.px(20), color: ink.text, fontWeight: '700',
    }) + ui.text('荒诞 · 明朝 · 你', width - headerLeft, {
      fontSize: ui.px(12), lineHeight: ui.px(20), color: ink.muted, textAlign: 'right',
    }), width, { height: headerHeight });
  const title = ui.text(titleStart, width, {
    fontFamily: fonts.title, fontWeight: '900', fontSize: startSize, lineHeight: startLine, height: startLine,
  }) + ui.text(titleMiddle, width, {
    fontFamily: fonts.title, fontWeight: '900', fontSize: middleSize, lineHeight: middleLine,
    height: middleLine, marginTop: titleGap,
  }) + ui.text(titleFinale, width, {
    fontFamily: fonts.title, fontWeight: '900', fontSize: finaleSize, lineHeight: finaleLine,
    height: finaleLine, marginTop: titleGap, color: ink.accent,
    textShadow: `${ui.px(2)}px ${ui.px(3)}px 0px ${ink.sun}`,
  });
  // Renderer composites the cached art inside this real Layout box; no text or action lives in it.
  const illustration = ui.view('', {
    width, height: illustrationHeight, marginTop: illustrationGap, backgroundColor: ink.clear,
  }, 'homeIllustration');
  const promise = ui.text('带上一件现代物品，\n去明朝过一生。', width, {
    fontSize: ui.px(16), lineHeight: promiseLine, height: promiseLine * 2, marginTop: promiseGap,
  });
  const notice = hasNotice ? ui.text(snapshot.notice, width, {
    fontSize: ui.px(14), lineHeight: ui.px(22), color: ink.accent, marginTop: ui.px(12),
  }) : '';
  const entryGap = ui.px(8);
  const entryWidth = Math.floor((width - entryGap * 2) / 3);
  const actions = ui.button('startLife', snapshot.busy ? '正在揭晓身份…' : '我要穿越', width,
    () => controller.start(), {
      primary: true, disabled: snapshot.busy, height: primaryHeight, fontSize: ui.px(21),
    }) + ui.text('出发前，先看看你的身份。', width, {
      fontSize: ui.px(13), lineHeight: hintLine, height: hintLine, color: ink.muted,
      textAlign: 'center', marginTop: hintGap,
    }) + ui.row(
      ui.button('homeSound', '声音', entryWidth, () => controller.open('sound'), { height: utilityHeight })
      + ui.view(ui.button('homeAchievements', '成就', entryWidth, () => controller.open('achievements'), {
        height: utilityHeight,
      }), { marginLeft: entryGap })
      + ui.view(ui.button('homeStats', '统计', width - entryWidth * 2 - entryGap * 2, () => controller.open('stats'), {
        height: utilityHeight,
      }), { marginLeft: entryGap }), width, { height: utilityHeight, marginTop: utilitiesGap })
    + ui.text('本局进度仅临时保留，\n关闭或刷新后不能继续。', width, {
      fontSize: ui.px(14), lineHeight: warningLine, height: warningLine * 2, color: ink.muted,
      textAlign: 'center', marginTop: warningGap,
    });
  const content = ui.view(
    ui.gap(topPadding) + header + ui.gap(heroGap + heroTopExtra) + title + illustration + promise + notice
    + ui.gap(actionsGap + heroBottomExtra) + actions + ui.gap(bottomPadding), { width, minHeight: height });
  return ui.view('', {
    position: 'absolute', left: 0, top: 0, width: 750, height: ui.px(6), backgroundColor: ink.sun,
  }) + ui.scroll(content, width, height, 'homeScroll', { marginLeft: gutter });
}

/** Code-drawn adaptation of the approved simple A concept; no image model or external asset. */
export class HomeBackdrop {
  private readonly canvas: HTMLCanvasElement;

  constructor(platform: GamePlatform) {
    this.canvas = platform.createCanvas();
    // Four samples per concept unit retain smooth outlines at the intended mobile display size.
    this.canvas.width = 1280;
    this.canvas.height = 752;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('无法创建首页插图画布。');
    context.scale(4, 4);
    context.fillStyle = ink.sun;
    context.beginPath();
    context.arc(232, 94, 84, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.translate(195, 92);
    context.rotate(-8 * Math.PI / 180);
    context.translate(-115, -82);
    context.lineWidth = 4;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = ink.text;

    context.fillStyle = ink.surface;
    context.beginPath();
    context.moveTo(78, 96);
    context.lineTo(89, 143);
    context.lineTo(115, 137);
    context.lineTo(109, 102);
    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = ink.accent;
    context.beginPath();
    context.moveTo(32, 55);
    context.lineTo(76, 53);
    context.lineTo(158, 21);
    context.lineTo(158, 120);
    context.lineTo(76, 93);
    context.lineTo(32, 91);
    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = ink.surface;
    context.fillRect(34, 57, 41, 34);
    context.strokeRect(34, 57, 41, 34);
    context.beginPath();
    context.moveTo(75, 54);
    context.lineTo(75, 94);
    context.stroke();

    context.fillStyle = ink.accent;
    context.beginPath();
    context.moveTo(181, 70);
    context.bezierCurveTo(181, 98.17, 172.05, 121, 161, 121);
    context.bezierCurveTo(149.95, 121, 141, 98.17, 141, 70);
    context.bezierCurveTo(141, 41.83, 149.95, 19, 161, 19);
    context.bezierCurveTo(172.05, 19, 181, 41.83, 181, 70);
    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = ink.text;
    context.beginPath();
    context.moveTo(174, 70);
    context.bezierCurveTo(174, 88.78, 169.52, 104, 164, 104);
    context.bezierCurveTo(158.48, 104, 154, 88.78, 154, 70);
    context.bezierCurveTo(154, 51.22, 158.48, 36, 164, 36);
    context.bezierCurveTo(169.52, 36, 174, 51.22, 174, 70);
    context.closePath();
    context.fill();

    context.fillStyle = ink.sun;
    context.fillRect(15, 67, 15, 15);
    context.strokeRect(15, 67, 15, 15);
    context.beginPath();
    context.moveTo(194, 41);
    context.lineTo(211, 29);
    context.moveTo(198, 66);
    context.lineTo(220, 64);
    context.moveTo(193, 90);
    context.lineTo(212, 103);
    context.stroke();

    context.strokeStyle = ink.accent;
    context.beginPath();
    context.moveTo(21, 28);
    context.lineTo(14, 19);
    context.moveTo(59, 32);
    context.lineTo(61, 18);
    context.stroke();
    context.restore();
  }

  draw(context: CanvasRenderingContext2D, left: number, top: number, width: number, height: number): void {
    if (width <= 0 || height <= 0 || this.canvas.width === 0) return;
    const scale = Math.min(width / this.canvas.width, height / this.canvas.height);
    const drawWidth = this.canvas.width * scale;
    const drawHeight = this.canvas.height * scale;
    context.save();
    context.imageSmoothingEnabled = true;
    context.drawImage(this.canvas, left + width - drawWidth, top + (height - drawHeight) / 2, drawWidth, drawHeight);
    context.restore();
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}
