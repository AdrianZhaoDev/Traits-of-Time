import {
  _decorator,
  Component,
  Node,
  Label,
  Color,
  Vec3,
  tween,
  Tween,
  isValid,
  UIOpacity,
  ScrollView,
  UITransform,
  v3,
} from 'cc';


interface MotionPreference {
  readonly matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

interface TrackedAnimation {
  readonly targets: readonly object[];
  readonly restore: () => void;
}
/**
 * 明末水墨 UI 动效与微交互控制器
 * 严格遵循《动效与微交互制作规范》：原生 tween + UIOpacity，保证合批与性能
 */
export class UIAnimController {
  private static readonly animations = new Map<Node, TrackedAnimation>();
  private static motionPreference: MotionPreference | null | undefined;
  private static readonly onMotionChange = (): void => {
    if (UIAnimController.prefersReducedMotion()) UIAnimController.stopTrackedAnimations();
  };

  /** 重开、复用或宿主禁用时停止节点及其关联组件的 Tween，并恢复起始位姿/基色。 */
  public static stopAnimations(target: Node, recursive = false): void {
    const animation = this.animations.get(target);
    if (animation) {
      this.finishAnimation(target, animation);
      for (const animatedTarget of animation.targets) Tween.stopAllByTarget(animatedTarget);
      animation.restore();
    } else if (isValid(target, true)) {
      Tween.stopAllByTarget(target);
      const opacity = target.getComponent(UIOpacity);
      const label = target.getComponent(Label);
      if (opacity) Tween.stopAllByTarget(opacity);
      if (label) Tween.stopAllByTarget(label);
    }
    if (recursive && isValid(target)) {
      for (const child of target.children) this.stopAnimations(child, true);
    }
  }

  private static prefersReducedMotion(): boolean {
    if (this.motionPreference === undefined) {
      const host = globalThis as typeof globalThis & {
        matchMedia?: (query: string) => MotionPreference;
      };
      this.motionPreference = host.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    }
    return this.motionPreference?.matches ?? false;
  }

  private static trackAnimation(target: Node, targets: readonly object[], restore: () => void): TrackedAnimation {
    const animation = { targets, restore };
    this.animations.set(target, animation);
    // Component lifecycle also observes an ancestor becoming inactive; node events do not.
    const cleanup = target.getComponent(UIAnimationCleanup) || target.addComponent(UIAnimationCleanup);
    cleanup.enabled = true;
    if (this.animations.size === 1) {
      if (this.motionPreference?.addEventListener) {
        this.motionPreference.addEventListener('change', this.onMotionChange);
      } else {
        this.motionPreference?.addListener?.(this.onMotionChange);
      }
    }
    return animation;
  }

  private static finishAnimation(target: Node, animation: TrackedAnimation): void {
    if (this.animations.get(target) !== animation) return;
    this.animations.delete(target);
    if (this.animations.size !== 0) return;
    if (this.motionPreference?.addEventListener) {
      this.motionPreference.removeEventListener?.('change', this.onMotionChange);
    } else {
      this.motionPreference?.removeListener?.(this.onMotionChange);
    }
  }

  private static stopTrackedAnimations(): void {
    for (const target of this.animations.keys()) this.stopAnimations(target);
  }
  /**
   * 1. 朱砂盖印与震屏微动
   * 印章从 2.8 倍带旋转砸下，落定刹那震动画布
   */
  public static playStampEffect(
    stampNode: Node,
    shakeTarget: Node | null,
    onComplete?: () => void,
  ): void {
    if (!isValid(stampNode, true) || !stampNode.activeInHierarchy) return;
    this.stopAnimations(stampNode);
    if (this.prefersReducedMotion()) {
      onComplete?.();
      return;
    }

    const opacityComp = stampNode.getComponent(UIOpacity) || stampNode.addComponent(UIOpacity);
    const baseScale = stampNode.scale.clone();
    const baseRotation = stampNode.eulerAngles.clone();
    const baseOpacity = opacityComp.opacity;
    const animation = this.trackAnimation(stampNode, [stampNode, opacityComp], () => {
      if (isValid(stampNode, true)) {
        stampNode.setScale(baseScale);
        stampNode.setRotationFromEuler(baseRotation);
      }
      if (isValid(opacityComp, true)) opacityComp.opacity = baseOpacity;
    });
    opacityComp.opacity = 0;

    const targetRotZ = (Math.random() - 0.5) * 12; // -6° ~ 6° 自然歪斜
    stampNode.setScale(baseScale.x * 2.8, baseScale.y * 2.8, baseScale.z);
    stampNode.setRotationFromEuler(baseRotation.x, baseRotation.y, baseRotation.z + targetRotZ * 2);

    tween(opacityComp).to(0.06, { opacity: 255 }).start();
    tween(stampNode)
      .to(0.18, { scale: baseScale }, {
        easing: 'quadIn',
        onUpdate: (target: Node, ratio: number) => {
          target.setRotationFromEuler(baseRotation.x, baseRotation.y, baseRotation.z + targetRotZ * (2 - ratio));
        },
      })
      .call(() => {
        this.finishAnimation(stampNode, animation);
        if (!isValid(stampNode, true)) return;
        if (shakeTarget && isValid(shakeTarget, true)) this.playScreenShake(shakeTarget, 5, 0.12);
        onComplete?.();
      })
      .start();
  }

  /**
   * 2. 震屏微交互
   */
  public static playScreenShake(target: Node, intensity: number = 6, duration: number = 0.12): void {
    if (!isValid(target, true) || !target.activeInHierarchy) return;
    this.stopAnimations(target);
    if (this.prefersReducedMotion()) return;
    const originPos = target.position.clone();
    const half = intensity / 2;
    const animation = this.trackAnimation(target, [target], () => {
      if (isValid(target, true)) target.setPosition(originPos);
    });

    tween(target)
      .to(duration * 0.25, { position: v3(originPos.x + intensity, originPos.y - half, originPos.z) })
      .to(duration * 0.25, { position: v3(originPos.x - intensity, originPos.y + half, originPos.z) })
      .to(duration * 0.25, { position: v3(originPos.x + half, originPos.y - intensity * 0.3, originPos.z) })
      .to(duration * 0.25, { position: originPos })
      .call(() => this.finishAnimation(target, animation))
      .start();
  }

  /** 死亡专用四段阻尼震屏：+8 → -6 → +4 → 原位，共 0.16 秒。 */
  public static playDeathShake(target: Node): void {
    if (!isValid(target, true) || !target.activeInHierarchy) return;
    this.stopAnimations(target);
    if (this.prefersReducedMotion()) return;
    const originPos = target.position.clone();
    const animation = this.trackAnimation(target, [target], () => {
      if (isValid(target, true)) target.setPosition(originPos);
    });
    tween(target)
      .to(0.04, { position: v3(originPos.x + 8, originPos.y - 4, originPos.z) }, { easing: 'sineInOut' })
      .to(0.04, { position: v3(originPos.x - 6, originPos.y + 6, originPos.z) }, { easing: 'sineInOut' })
      .to(0.04, { position: v3(originPos.x + 4, originPos.y - 2, originPos.z) }, { easing: 'sineInOut' })
      .to(0.04, { position: originPos }, { easing: 'sineInOut' })
      .call(() => this.finishAnimation(target, animation))
      .start();
  }

  public static playAttrPunch(
    coinNode: Node,
    valueLabel?: Label | null,
    delta?: number,
    defaultColor?: Color,
  ): void {
    if (!isValid(coinNode, true) || !coinNode.activeInHierarchy) return;
    // Restore the previous punch before capturing a new baseline, including its Label tween.
    this.stopAnimations(coinNode);
    const reduced = this.prefersReducedMotion();
    const label = valueLabel && isValid(valueLabel, true) && isValid(valueLabel.node, true)
      && delta !== undefined && delta !== 0 ? valueLabel : null;
    if (reduced && !label) return;
    const baseScale = coinNode.scale.clone();
    const color = label ? (defaultColor ?? label.color) : null;
    const baseColor = color ? new Color(color.r, color.g, color.b, color.a) : null;
    const animation = this.trackAnimation(coinNode, label ? [coinNode, label] : [coinNode], () => {
      if (isValid(coinNode, true)) coinNode.setScale(baseScale);
      if (label && isValid(label, true) && baseColor) label.color = baseColor;
    });

    // Keep cleanup on the owner node: a destroyed Label cancels its own Tween
    // without running its completion callback.
    const punch = tween(coinNode);
    if (!reduced) {
      punch
        .to(0.08, { scale: v3(baseScale.x * 1.3, baseScale.y * 1.3, baseScale.z) }, { easing: 'quadOut' })
        .to(0.12, { scale: baseScale }, { easing: 'quadIn' });
    }
    if (label) punch.delay(reduced ? 0.3 : 0.1);
    punch.call(() => this.finishAnimation(coinNode, animation)).start();
    if (!label || !baseColor) return;
    label.color = (delta ?? 0) > 0
      ? new Color(255, 190, 11, baseColor.a)
      : new Color(255, 42, 95, baseColor.a);
    tween(label)
      .to(0.3, { color: baseColor }, { easing: 'quadOut' })
      .start();
  }



  /**
   * 4. 历史折页风化渐变 (距离顶部 25% 范围内透明度逐渐衰减至 110)
   */
  public static updateScrollWeathering(scrollView: ScrollView): void {
    if (!scrollView || !scrollView.content) return;
    const content = scrollView.content;
    const scrollTrans = scrollView.node.getComponent(UITransform);
    if (!scrollTrans) return;

    const viewTopY = scrollTrans.height / 2;
    const fadeZone = scrollTrans.height * 0.3;

    for (const child of content.children) {
      const childTrans = child.getComponent(UITransform);
      if (!childTrans) continue;

      let opacityComp = child.getComponent(UIOpacity);
      if (!opacityComp) {
        opacityComp = child.addComponent(UIOpacity);
      }

      // 计算卡片世界坐标相对于视口顶部的距离
      const childWorldPos = childTrans.convertToWorldSpaceAR(Vec3.ZERO);
      const localPosInScroll = scrollTrans.convertToNodeSpaceAR(childWorldPos);
      const distFromTop = viewTopY - localPosInScroll.y;

      if (distFromTop < fadeZone && distFromTop > 0) {
        const factor = Math.max(0, distFromTop / fadeZone);
        opacityComp.opacity = Math.floor(110 + (255 - 110) * factor);
      } else if (distFromTop <= 0) {
        opacityComp.opacity = 90;
      } else {
        opacityComp.opacity = 255;
      }
    }
  }

  /**
   * 5. 命数烛火暗角动态呼吸与濒危急促闪烁
   */
  public static updateCandleVignette(
    vignetteNode: Node,
    age: number,
    luck: number,
  ): void {
    if (!isValid(vignetteNode, true) || !vignetteNode.activeInHierarchy) return;
    this.stopAnimations(vignetteNode);
    const opacityComp = vignetteNode.getComponent(UIOpacity) || vignetteNode.addComponent(UIOpacity);
    const baseScale = vignetteNode.scale.clone();
    const isEndangered = age >= 60 || luck <= 2;
    const restingOpacity = isEndangered ? 180 : 120;
    opacityComp.opacity = restingOpacity;
    if (this.prefersReducedMotion()) return;
    this.trackAnimation(vignetteNode, [vignetteNode, opacityComp], () => {
      if (isValid(vignetteNode, true)) vignetteNode.setScale(baseScale);
      if (isValid(opacityComp, true)) opacityComp.opacity = restingOpacity;
    });

    const halfPeriod = isEndangered ? 0.55 : 1.6;
    const scale = isEndangered ? 0.92 : 1.03;
    tween(vignetteNode)
      .repeatForever(
        tween()
          .to(halfPeriod, { scale: v3(baseScale.x * scale, baseScale.y * scale, baseScale.z) }, { easing: 'sineInOut' })
          .to(halfPeriod, { scale: baseScale }, { easing: 'sineInOut' })
      )
      .start();
    tween(opacityComp)
      .repeatForever(
        tween()
          .to(halfPeriod, { opacity: isEndangered ? 220 : 140 })
          .to(halfPeriod, { opacity: isEndangered ? 160 : 90 })
      )
      .start();
  }

  /**
   * 6. 身份腰牌微晃动
   */
  public static playPlaqueSway(plaqueNode: Node): void {
    if (!isValid(plaqueNode, true) || !plaqueNode.activeInHierarchy) return;
    this.stopAnimations(plaqueNode);
    if (this.prefersReducedMotion()) return;
    const baseScale = plaqueNode.scale.clone();
    const baseRotation = plaqueNode.eulerAngles.clone();
    const animation = this.trackAnimation(plaqueNode, [plaqueNode], () => {
      if (!isValid(plaqueNode, true)) return;
      plaqueNode.setScale(baseScale);
      plaqueNode.setRotationFromEuler(baseRotation);
    });

    tween(plaqueNode)
      .to(0.12, { scale: v3(baseScale.x * 1.05, baseScale.y * 1.05, baseScale.z) })
      .to(0.15, {}, {
        onUpdate: (target: Node, ratio: number) => {
          target.setRotationFromEuler(baseRotation.x, baseRotation.y, baseRotation.z + Math.sin(ratio * Math.PI * 2) * 5);
        },
      })
      .to(0.1, { scale: baseScale })
      .call(() => {
        if (isValid(plaqueNode, true)) plaqueNode.setRotationFromEuler(baseRotation);
        this.finishAnimation(plaqueNode, animation);
      })
      .start();
  }
}

@_decorator.ccclass('UIAnimationCleanup')
class UIAnimationCleanup extends Component {
  onDisable(): void {
    UIAnimController.stopAnimations(this.node);
  }

  onDestroy(): void {
    UIAnimController.stopAnimations(this.node);
  }
}
