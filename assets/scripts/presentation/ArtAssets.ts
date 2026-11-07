import {
  _decorator,
  Component,
  isValid,
  Layers,
  Node,
  resources,
  Sprite,
  SpriteFrame,
  UITransform,
} from 'cc';

const { ccclass } = _decorator;
const ART_ROOT = 'art/ming_end/';

/**
 * Keeps the caller's layout box stable and fits the actual imported image inside it.
 * Each binding owns its frame reference; Cocos owns resource caching and shared loads.
 * Ready/error events are deferred so callers can subscribe after createArt returns.
 */
@ccclass('ArtAssetBinding')
class ArtAssetBinding extends Component {
  private image: Node | null = null;
  private sprite: Sprite | null = null;
  private frame: SpriteFrame | null = null;
  private request = 0;
  private disposed = false;

  onLoad(): void {
    this.node.on(Node.EventType.SIZE_CHANGED, this.fitImage, this);
    this.fitImage();
  }

  public show(relativePath: string): void {
    if (!this.isAlive()) return;
    const request = ++this.request;
    this.ensureImage();
    this.releaseFrame();
    const path = `${ART_ROOT}${relativePath}/spriteFrame`;
    const failed = (cause: unknown): void => {
      if (!this.isCurrent(request)) return;
      console.error(`[ArtAssets] 无法载入插画 ${path}；不显示替代图片。`, cause);
      this.notify('art-error', relativePath, request);
    };
    try {
      // PNGs imported by Cocos expose a SpriteFrame subasset, not a root frame.
      resources.load(path, SpriteFrame, (error, frame) => {
        if (!this.isCurrent(request)) return;
        if (error || !frame || !isValid(frame, true)) {
          failed(error ?? new Error('SpriteFrame is unavailable'));
          return;
        }
        frame.addRef();
        this.frame = frame;
        this.sprite!.spriteFrame = frame;
        this.fitImage();
        this.sprite!.enabled = true;
        this.notify('art-ready', relativePath, request);
      });
    } catch (cause) {
      failed(cause);
    }
  }

  onDestroy(): void {
    this.disposed = true;
    this.request++;
    this.node.off(Node.EventType.SIZE_CHANGED, this.fitImage, this);
    this.releaseFrame();
    this.image = null;
    this.sprite = null;
  }

  private ensureImage(): void {
    if (this.image && isValid(this.image, true) && this.sprite && isValid(this.sprite, true)) return;
    const image = new Node('ArtImage');
    image.layer = this.node.layer;
    image.addComponent(UITransform);
    const sprite = image.addComponent(Sprite);
    sprite.type = Sprite.Type.SIMPLE;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.enabled = false;
    this.node.addChild(image);
    this.image = image;
    this.sprite = sprite;
  }

  private fitImage(): void {
    if (!this.frame || !this.image || !isValid(this.image, true)) return;
    const box = this.node.getComponent(UITransform)!;
    const size = this.frame.originalSize;
    if (size.width <= 0 || size.height <= 0) return;
    const scale = Math.min(box.width / size.width, box.height / size.height);
    this.image.getComponent(UITransform)!.setContentSize(size.width * scale, size.height * scale);
    this.image.layer = this.node.layer;
  }

  private releaseFrame(): void {
    if (this.sprite && isValid(this.sprite, true)) {
      this.sprite.enabled = false;
      this.sprite.spriteFrame = null;
    }
    const frame = this.frame;
    this.frame = null;
    if (frame && isValid(frame, true)) frame.decRef();
  }

  private isAlive(): boolean {
    if (this.disposed || !isValid(this, true)) return false;
    // An ancestor may have a deferred destroy request before this child receives it.
    for (let owner: Node | null = this.node; owner; owner = owner.parent) {
      if (!isValid(owner, true)) return false;
    }
    return true;
  }

  private isCurrent(request: number): boolean {
    return request === this.request && this.isAlive()
      && this.image !== null && isValid(this.image, true)
      && this.sprite !== null && isValid(this.sprite, true);
  }

  private notify(event: 'art-ready' | 'art-error', relativePath: string, request: number): void {
    void Promise.resolve().then(() => {
      if (this.isCurrent(request)) this.node.emit(event, relativePath);
    });
  }
}

/** Original art only, aspect-contained in a stable, non-interactive layout box. */
export function createArt(
  parent: Node,
  name: string,
  relativePath: string,
  width: number,
  height: number,
  x = 0,
  y = 0,
): Node {
  const node = new Node(name);
  node.layer = Layers.Enum.UI_2D;
  node.addComponent(UITransform).setContentSize(width, height);
  node.setPosition(x, y, 0);
  parent.addChild(node);
  setArt(node, relativePath);
  return node;
}

/** Replaces the image immediately; obsolete/destroyed requests cannot publish a frame. */
export function setArt(node: Node, relativePath: string): void {
  if (!isValid(node, true)) return;
  if (!node.getComponent(UITransform)) node.addComponent(UITransform);
  const binding = node.getComponent(ArtAssetBinding) ?? node.addComponent(ArtAssetBinding);
  binding.show(relativePath);
}
