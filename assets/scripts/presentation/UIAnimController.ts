import {
  Node,
  Vec3,
  tween,
  UIOpacity,
  ScrollView,
  UITransform,
  v3,
} from 'cc';

/**
 * 明末水墨 UI 动效与微交互控制器
 * 严格遵循《动效与微交互制作规范》：原生 tween + UIOpacity，保证合批与性能
 */
export class UIAnimController {
  /**
   * 1. 朱砂盖印与震屏微动
   * 印章从 2.8 倍带旋转砸下，落定刹那震动画布
   */
  public static playStampEffect(
    stampNode: Node,
    shakeTarget: Node | null,
    onComplete?: () => void,
  ): void {
    if (!stampNode || !stampNode.isValid) return;

    let opacityComp = stampNode.getComponent(UIOpacity);
    if (!opacityComp) {
      opacityComp = stampNode.addComponent(UIOpacity);
    }
    opacityComp.opacity = 0;

    const targetRotZ = (Math.random() - 0.5) * 12; // -6° ~ 6° 自然歪斜
    stampNode.setScale(2.8, 2.8, 1);
    stampNode.setRotationFromEuler(0, 0, targetRotZ * 2);

    tween(opacityComp)
      .to(0.06, { opacity: 255 })
      .start();

    tween(stampNode)
      .to(0.18, {
        scale: v3(1.0, 1.0, 1.0),
      }, {
        easing: 'quadIn',
        onUpdate: (target: Node, ratio: number) => {
          target.setRotationFromEuler(0, 0, targetRotZ * 2 * (1 - ratio) + targetRotZ * ratio);
        },
      })
      .call(() => {
        // 印章落底，微震画布
        if (shakeTarget && shakeTarget.isValid) {
          this.playScreenShake(shakeTarget, 5, 0.12);
        }
        if (onComplete) onComplete();
      })
      .start();
  }

  /**
   * 2. 震屏微交互
   */
  public static playScreenShake(target: Node, intensity: number = 6, duration: number = 0.12): void {
    if (!target || !target.isValid) return;
    const originPos = target.position.clone();
    const half = intensity / 2;

    tween(target)
      .to(duration * 0.25, { position: v3(originPos.x + intensity, originPos.y - half, originPos.z) })
      .to(duration * 0.25, { position: v3(originPos.x - intensity, originPos.y + half, originPos.z) })
      .to(duration * 0.25, { position: v3(originPos.x + half, originPos.y - intensity * 0.3, originPos.z) })
      .to(duration * 0.25, { position: originPos })
      .start();
  }

  /**
   * 3. 铜钱翻转与数值涨跌动效
   * 增益沿 Y 轴翻转，跌损左右打颤
   */
  public static playStatChangeEffect(coinNode: Node, delta: number): void {
    if (!coinNode || !coinNode.isValid) return;

    if (delta > 0) {
      // 顺时针/Y 轴翻转一圈 (0.28s)
      tween(coinNode)
        .to(0.14, { scale: v3(0.1, 1.2, 1) }, { easing: 'quadIn' })
        .to(0.14, { scale: v3(1.0, 1.0, 1) }, { easing: 'backOut' })
        .start();
    } else if (delta < 0) {
      // 左右惊慌微颤
      const originX = coinNode.position.x;
      const y = coinNode.position.y;
      const z = coinNode.position.z;
      tween(coinNode)
        .to(0.04, { position: v3(originX + 4, y, z) })
        .to(0.04, { position: v3(originX - 4, y, z) })
        .to(0.04, { position: v3(originX + 2, y, z) })
        .to(0.04, { position: v3(originX, y, z) })
        .start();
    }
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
    if (!vignetteNode || !vignetteNode.isValid) return;

    let opacityComp = vignetteNode.getComponent(UIOpacity);
    if (!opacityComp) {
      opacityComp = vignetteNode.addComponent(UIOpacity);
    }

    // 终止可能存在的旧 tween
    tween(vignetteNode).stop();
    tween(opacityComp).stop();

    const isEndangered = age >= 60 || luck <= 2;
    if (isEndangered) {
      // 濒危：急促飘忽闪烁 (1.1s 周期，暗角更深)
      opacityComp.opacity = 180;
      tween(vignetteNode)
        .repeatForever(
          tween()
            .to(0.55, { scale: v3(0.92, 0.92, 1) }, { easing: 'sineInOut' })
            .to(0.55, { scale: v3(1.0, 1.0, 1) }, { easing: 'sineInOut' })
        )
        .start();

      tween(opacityComp)
        .repeatForever(
          tween()
            .to(0.55, { opacity: 220 })
            .to(0.55, { opacity: 160 })
        )
        .start();
    } else {
      // 常态：幽静呼吸 (3.2s 周期)
      opacityComp.opacity = 120;
      tween(vignetteNode)
        .repeatForever(
          tween()
            .to(1.6, { scale: v3(1.03, 1.03, 1) }, { easing: 'sineInOut' })
            .to(1.6, { scale: v3(1.0, 1.0, 1) }, { easing: 'sineInOut' })
        )
        .start();

      tween(opacityComp)
        .repeatForever(
          tween()
            .to(1.6, { opacity: 140 })
            .to(1.6, { opacity: 90 })
        )
        .start();
    }
  }

  /**
   * 6. 身份腰牌微晃动
   */
  public static playPlaqueSway(plaqueNode: Node): void {
    if (!plaqueNode || !plaqueNode.isValid) return;
    tween(plaqueNode).stop();
    plaqueNode.setRotationFromEuler(0, 0, 0);

    tween(plaqueNode)
      .to(0.12, { scale: v3(1.05, 1.05, 1) })
      .to(0.15, {}, {
        onUpdate: (target: Node, ratio: number) => {
          target.setRotationFromEuler(0, 0, Math.sin(ratio * Math.PI * 2) * 5);
        },
      })
      .to(0.1, { scale: v3(1.0, 1.0, 1) })
      .call(() => {
        plaqueNode.setRotationFromEuler(0, 0, 0);
      })
      .start();
  }
}
