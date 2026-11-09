export const ink = {
  background: '#0c0d12', desk: '#13151c', panel: '#181b24', raised: '#222633',
  inset: '#11131a', rail: '#141720', slot: '#1c202b', border: '#353b49',
  borderLight: '#525b6e', text: '#edf1f7', sub: '#a0aabb', muted: '#7e899c',
  cyan: '#00f0ff', gold: '#ffbe0b', red: '#ff5277', green: '#05dfb7',
  purple: '#c77dff', modern: '#121c29', ended: '#571b29', advance: '#1f6048',
  advanceBorder: '#4ade80', selected: '#19313c', veil: 'rgba(9,10,14,0.88)',
  clear: 'rgba(0,0,0,0)', hud: '#161922', homeVeil: 'rgba(12,13,18,0.3)',
} as const;

export const fonts = {
  body: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  title: '"Songti SC", SimSun, "Noto Serif CJK SC", serif',
} as const;

export type Style = Record<string, string | number | Record<string, string | number>>;
export interface UiAction {
  id: string;
  label: string;
  invoke: () => unknown;
  disabled: boolean;
  pressed?: boolean;
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
      width, fontSize: 26, lineHeight: 42, color: ink.text,
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
    invoke: () => unknown, options: Partial<Pick<UiAction, 'disabled' | 'pressed' | 'kind' | 'value' | 'setValue'>> = {}): string {
    this.actions.push({ id, label, invoke, disabled: false, ...options });
    return this.view(children, {
      borderWidth: 1, borderColor: ink.border, backgroundColor: ink.raised,
      borderRadius: 6, opacity: options.disabled ? 0.45 : 1, ...style,
    }, id);
  }

  button(id: string, label: string, width: number, invoke: () => unknown,
    options: { height?: number; fill?: string; color?: string; border?: string; disabled?: boolean;
      fontSize?: number; marginTop?: number; kind?: 'seal' } = {}): string {
    const height = options.height ?? 84;
    return this.control(id, label, this.text(label, width - 20, {
      textAlign: 'center', fontSize: options.fontSize ?? 26, lineHeight: 36,
      color: options.color ?? ink.text, fontWeight: '600', fontFamily: options.kind === 'seal' ? fonts.title : fonts.body,
    }), { width, height, justifyContent: 'center', alignItems: 'center',
      backgroundColor: options.fill ?? ink.raised, borderColor: options.border ?? ink.border,
      marginTop: options.marginTop ?? 0 }, invoke, { disabled: options.disabled, kind: options.kind });
  }

  finish(children: string, height: number, overlay = false): UiScene {
    return {
      xml: this.view(children, { width: 750, height, backgroundColor: overlay ? ink.clear : ink.desk }, 'root'),
      styles: this.styles, actions: this.actions, text: this.texts, scrollIds: this.scrollIds,
    };
  }
}
