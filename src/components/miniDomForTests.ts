// A DOM stand-in just large enough for react-dom/client to mount, update and
// unmount plain elements and text, so tests can exercise behaviour that only
// the client renderer has (error boundaries, state). Tests only: no layout,
// no selection, and event listeners are ignored (call handlers through
// reactPropsOf instead).

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const DOCUMENT_NODE = 9;

export class MiniNode {
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];

  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    readonly ownerDocument: MiniDocument | null,
  ) {}

  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): MiniNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling(): MiniNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get previousSibling(): MiniNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }

  appendChild<T extends MiniNode>(child: T): T {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore<T extends MiniNode>(child: T, before: MiniNode | null): T {
    if (before === null) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    const index = this.childNodes.indexOf(before);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild<T extends MiniNode>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  contains(other: MiniNode | null): boolean {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(text: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (text) this.appendChild(this.document().createTextNode(String(text)));
  }

  protected document(): MiniDocument {
    if (this.ownerDocument) return this.ownerDocument;
    if (this instanceof MiniDocument) return this;
    throw new Error("node has no document");
  }
}

export class MiniText extends MiniNode {
  constructor(
    public nodeValue: string,
    ownerDocument: MiniDocument,
    nodeType = TEXT_NODE,
  ) {
    super(nodeType, nodeType === TEXT_NODE ? "#text" : "#comment", ownerDocument);
  }

  get data(): string {
    return this.nodeValue;
  }

  set data(text: string) {
    this.nodeValue = text;
  }

  override get textContent(): string {
    return this.nodeType === TEXT_NODE ? this.nodeValue : "";
  }

  override set textContent(text: string) {
    this.nodeValue = String(text);
  }
}

export class MiniElement extends MiniNode {
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, unknown> = {
    setProperty(this: Record<string, unknown>, name: string, value: unknown) {
      this[name] = value;
    },
    removeProperty(this: Record<string, unknown>, name: string) {
      delete this[name];
    },
  };

  constructor(
    readonly tagName: string,
    ownerDocument: MiniDocument,
    readonly namespaceURI: string = HTML_NAMESPACE,
  ) {
    super(ELEMENT_NODE, tagName.toUpperCase(), ownerDocument);
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
  }

  setAttributeNS(_namespace: string | null, name: string, value: unknown): void {
    this.setAttribute(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  /** Elements (depth first) whose `class` attribute contains `className`. */
  findByClass(className: string): MiniElement[] {
    const found: MiniElement[] = [];
    const visit = (node: MiniNode) => {
      if (node instanceof MiniElement && (node.getAttribute("class") ?? "").split(/\s+/).includes(className)) {
        found.push(node);
      }
      node.childNodes.forEach(visit);
    };
    this.childNodes.forEach(visit);
    return found;
  }
}

export class MiniDocument extends MiniNode {
  readonly documentElement: MiniElement;
  readonly head: MiniElement;
  readonly body: MiniElement;
  activeElement: MiniElement | null = null;
  defaultView: unknown = null;

  constructor() {
    super(DOCUMENT_NODE, "#document", null);
    this.documentElement = this.appendChild(new MiniElement("html", this));
    this.head = this.documentElement.appendChild(new MiniElement("head", this));
    this.body = this.documentElement.appendChild(new MiniElement("body", this));
  }

  createElement(tagName: string): MiniElement {
    return new MiniElement(tagName.toLowerCase(), this);
  }

  createElementNS(namespace: string, tagName: string): MiniElement {
    return new MiniElement(tagName, this, namespace);
  }

  createTextNode(text: string): MiniText {
    return new MiniText(String(text), this);
  }

  createComment(text: string): MiniText {
    return new MiniText(String(text), this, COMMENT_NODE);
  }
}

/**
 * The props React rendered onto a host node, to call its handlers directly
 * (the stand-in dispatches no events).
 */
export function reactPropsOf(node: MiniNode): Record<string, unknown> | undefined {
  const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
  return key ? ((node as unknown as Record<string, unknown>)[key] as Record<string, unknown>) : undefined;
}

const INSTALLED_GLOBALS = ["window", "document", "HTMLIFrameElement", "IS_REACT_ACT_ENVIRONMENT"] as const;

/**
 * Installs `window`/`document` globals for react-dom/client and returns a
 * function that restores the previous globals. Import react-dom/client after
 * installing: it reads the environment when first loaded.
 */
export function installMiniDom(): { document: MiniDocument; uninstall: () => void } {
  const scope = globalThis as Record<string, unknown>;
  const saved = INSTALLED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(scope, name)] as const);
  const document = new MiniDocument();
  // Anything not stubbed here (timers, queueMicrotask, …) falls through to the
  // real global scope.
  const windowLike = Object.assign(Object.create(globalThis) as Record<string, unknown>, {
    document,
    event: undefined,
    HTMLIFrameElement: class HTMLIFrameElement {},
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  });
  document.defaultView = windowLike;
  scope.window = windowLike;
  scope.document = document;
  scope.HTMLIFrameElement = windowLike.HTMLIFrameElement;
  scope.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    document,
    uninstall() {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(scope, name, descriptor);
        else delete scope[name];
      }
    },
  };
}
