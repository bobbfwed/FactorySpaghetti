// A tiny element helper. Text always goes in as text nodes (never parsed as HTML), so names
// and save contents from other players cannot inject markup.

export type Child = Node | string | number | null | undefined | false | Child[];

export interface Props {
  class?: string;
  text?: string;
  title?: string;
  type?: string;
  id?: string;
  disabled?: boolean;
  hidden?: boolean;
  value?: string;
  placeholder?: string;
  style?: string;
  attrs?: Record<string, string>;
  onclick?: (ev: MouseEvent) => void;
  oninput?: (ev: Event) => void;
  onchange?: (ev: Event) => void;
  onkeydown?: (ev: KeyboardEvent) => void;
  onpaste?: (ev: ClipboardEvent) => void;
  onfocus?: (ev: FocusEvent) => void;
  onblur?: (ev: FocusEvent) => void;
}

export function append(node: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    else if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
    else node.appendChild(c);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.title !== undefined) el.title = props.title;
    if (props.id !== undefined) el.id = props.id;
    if (props.style !== undefined) el.style.cssText = props.style;
    if (props.hidden) el.hidden = true;
    if (props.type !== undefined) el.setAttribute('type', props.type);
    if (props.disabled !== undefined && 'disabled' in el) (el as HTMLButtonElement).disabled = props.disabled;
    if (props.value !== undefined && 'value' in el) (el as HTMLInputElement).value = props.value;
    if (props.placeholder !== undefined) el.setAttribute('placeholder', props.placeholder);
    if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
    on(el, 'click', props.onclick as EventListener | undefined);
    on(el, 'input', props.oninput);
    on(el, 'change', props.onchange);
    on(el, 'keydown', props.onkeydown as EventListener | undefined);
    on(el, 'paste', props.onpaste as EventListener | undefined);
    on(el, 'focus', props.onfocus as EventListener | undefined);
    on(el, 'blur', props.onblur as EventListener | undefined);
  }
  append(el, children);
  if (tag === 'button' && !(props?.type)) el.setAttribute('type', 'button');
  return el;
}

/** Handlers live in a table on the element, so `morph` can hand a kept element the new ones. */
type Handlers = Record<string, EventListener>;
interface WithHandlers { _on?: Handlers }

function on(el: Element, type: string, fn: EventListener | undefined): void {
  if (!fn) return;
  const w = el as Element & WithHandlers;
  w._on = { ...w._on, [type]: fn };
  el.addEventListener(type, (ev) => { (el as Element & WithHandlers)._on?.[type]?.(ev); });
}

/**
 * Make `cur` look like `next` while keeping every node that can be kept, so a redraw does not
 * steal focus or swap a button out from under a finger. Nodes are matched by position and tag.
 */
export function morph(cur: Element, next: Element): void {
  // A subtree marked with the same data-keep key as before is unchanged: leave it alone.
  const keep = next.getAttribute('data-keep');
  if (keep !== null && cur.getAttribute('data-keep') === keep) return;
  // Attributes.
  for (const a of [...cur.attributes]) if (!next.hasAttribute(a.name)) cur.removeAttribute(a.name);
  for (const a of [...next.attributes]) if (cur.getAttribute(a.name) !== a.value) cur.setAttribute(a.name, a.value);
  if (cur instanceof HTMLButtonElement && next instanceof HTMLButtonElement) cur.disabled = next.disabled;
  // Handlers: listeners are only added at creation, so a kept element gets the new table.
  const nh = (next as Element & WithHandlers)._on;
  const ch = (cur as Element & WithHandlers)._on;
  if (nh) {
    for (const type of Object.keys(nh)) {
      if (!ch || !(type in ch)) cur.addEventListener(type, (ev) => { (cur as Element & WithHandlers)._on?.[type]?.(ev); });
    }
  }
  (cur as Element & WithHandlers)._on = nh ?? {};
  // Children.
  const a = [...cur.childNodes];
  const b = [...next.childNodes];
  for (let i = 0; i < b.length; i++) {
    const x = a[i];
    const y = b[i]!;
    if (!x) { cur.appendChild(y); continue; }
    if (x.nodeType === Node.TEXT_NODE && y.nodeType === Node.TEXT_NODE) {
      if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
    } else if (x instanceof Element && y instanceof Element && x.tagName === y.tagName && x.namespaceURI === y.namespaceURI) {
      morph(x, y);
    } else {
      cur.replaceChild(y, x);
    }
  }
  for (let i = b.length; i < a.length; i++) a[i]!.remove();
}

/** A button that runs an async action once at a time (disabled while it runs). */
export function actionButton(label: Child, cls: string, run: () => unknown, opts: { disabled?: boolean; title?: string } = {}): HTMLButtonElement {
  return h('button', {
    class: cls, disabled: !!opts.disabled, ...(opts.title ? { title: opts.title } : {}),
    onclick: (ev) => {
      const b = ev.currentTarget as HTMLButtonElement;
      if (b.disabled) return;
      b.disabled = true;
      Promise.resolve(run()).finally(() => { if (b.isConnected) b.disabled = !!opts.disabled; });
    },
  }, label);
}
