/** Approved A palette; Canvas and host styles share these exact sRGB roles. */
export const ink = {
  paper: '#FFF9E9', text: '#302826', muted: '#67594C', accent: '#BF3527',
  accentInk: '#FFF9E9', accentHover: '#A42B21', sun: '#FFDA58', sunSoft: '#FFF0AC',
  surface: '#FFFDF5', line: '#D8C899', focus: '#196C8A', disabled: '#E4DDD0',
  veil: 'rgba(48,40,38,0.72)', clear: 'rgba(0,0,0,0)',
} as const;

export const fonts = {
  body: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  title: '"Microsoft YaHei", "PingFang SC", sans-serif',
} as const;

export type Style = Record<string, string | number | Record<string, string | number>>;
export interface UiAction {
  id: string;
  label: string;
  invoke: () => unknown;
  disabled: boolean;
  pressed?: boolean;
  primary?: boolean;
  kind?: 'seal' | 'range';
  value?: number;
  setValue?: (value: number) => void;
}
export interface UiScene {
  xml: string;
  styles: Record<string, Style>;
  actions: UiAction[];
  text: string[];
  scrollIds: string[];
}

const escapeXml = (value: string): string => value.replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\r?\n/g, '&#10;');

/** Small XML builder; every widget still belongs to Layout's real layout tree. */
export class Ui {
  private sequence = 0;
  readonly styles: Record<string, Style> = {};
  readonly actions: UiAction[] = [];
  readonly texts: string[] = [];
  readonly scrollIds: string[] = [];

  constructor(readonly viewportWidth = 360) {}

  /** Convert visible CSS pixels to the engine's 750-unit layout. DPR is independent. */
  px(value: number): number { return Math.ceil(value * 750 / this.viewportWidth); }

  private node(tag: string, attributes: string, children: string, style: Style, id?: string): string {
    const key = id ?? `node${++this.sequence}`;
    this.styles[key] = { flexShrink: 0, ...style };
    return `<${tag} id="${key}"${attributes}>${children}</${tag}>`;
  }

  view(children: string, style: Style, id?: string): string {
    return this.node('view', '', children, style, id);
  }

  row(children: string, width: number, style: Style = {}, id?: string): string {
    return this.view(children, { width, flexDirection: 'row', alignItems: 'center', ...style }, id);
  }

  text(value: string, width: number, style: Style = {}, id?: string): string {
    if (value) this.texts.push(value);
    return this.node('text', ` value="${escapeXml(value)}"`, '', {
      width, fontSize: this.px(16), lineHeight: this.px(25), color: ink.text,
      fontFamily: fonts.body, whiteSpace: 'pre-wrap', wordBreak: 'break-all', ...style,
    }, id);
  }

  image(src: string, width: number, height: number, style: Style = {}): string {
    return this.node('image', ` src="${escapeXml(src)}"`, '', { width, height, ...style });
  }

  gap(height: number): string { return this.view('', { height, width: 1 }); }

  scroll(children: string, width: number, height: number, id: string, style: Style = {}): string {
    this.scrollIds.push(id);
    return this.node('scrollview', ' scrollY="true"', this.view(children, { width }),
      { width, height, ...style }, id);
  }

  control(id: string, label: string, children: string, style: Style,
    invoke: () => unknown, options: Partial<Pick<UiAction, 'disabled' | 'pressed' | 'primary' | 'kind' | 'value' | 'setValue'>> = {}): string {
    this.actions.push({ id, label, invoke, disabled: false, ...options });
    return this.view(children, {
      borderWidth: this.px(1.5), borderColor: ink.text,
      backgroundColor: options.disabled ? ink.disabled : ink.surface,
      borderRadius: this.px(8), ...style,
    }, id);
  }

  button(id: string, label: string, width: number, invoke: () => unknown,
    options: { height?: number; fill?: string; color?: string; border?: string; disabled?: boolean;
      fontSize?: number; marginTop?: number; kind?: 'seal'; primary?: boolean; pressed?: boolean } = {}): string {
    const primary = options.primary ?? options.kind === 'seal';
    const height = Math.max(this.px(primary ? 52 : 44), options.height ?? this.px(primary ? 56 : 48));
    const fontSize = options.fontSize ?? this.px(16);
    const faceWidth = primary ? width - this.px(4) : width;
    const faceHeight = primary ? height - this.px(5) : height;
    const labelNode = this.text(label, faceWidth - this.px(12), {
      textAlign: 'center', fontSize, lineHeight: Math.ceil(fontSize * 1.5), whiteSpace: 'nowrap',
      color: options.disabled ? ink.muted : options.color ?? ink.text,
      fontWeight: primary ? '800' : '600',
    });
    const faceStyle: Style = { width: faceWidth, height: faceHeight, justifyContent: 'center', alignItems: 'center',
      backgroundColor: options.disabled ? ink.disabled : options.fill ?? (primary ? ink.sun : options.pressed ? ink.sunSoft : ink.surface),
      borderColor: options.border ?? ink.text, borderWidth: this.px(primary ? 2 : 1.5), borderRadius: this.px(primary ? 10 : 8) };
    const children = primary
      ? this.view('', { width: faceWidth, height: faceHeight, position: 'absolute', left: this.px(4), top: this.px(5),
        backgroundColor: ink.text, borderRadius: this.px(10) }, id + '_shadow')
        + this.view(labelNode, { ...faceStyle, position: 'absolute', left: 0, top: 0 }, id + '_face')
      : labelNode;
    return this.control(id, label, children, primary
      ? { width, height, backgroundColor: ink.clear, borderWidth: 0, marginTop: options.marginTop ?? 0 }
      : { ...faceStyle, marginTop: options.marginTop ?? 0 }, invoke,
    { disabled: options.disabled, kind: options.kind, primary, pressed: options.pressed });
  }

  finish(children: string, height: number, overlay = false): UiScene {
    return {
      xml: this.view(children, { width: 750, height, backgroundColor: overlay ? ink.clear : ink.paper }, 'root'),
      styles: this.styles, actions: this.actions, text: this.texts, scrollIds: this.scrollIds,
    };
  }
}
