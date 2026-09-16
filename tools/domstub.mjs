/* Dahat OS — tools/domstub.mjs
 * A small headless DOM so the OS can be booted and exercised in Node (no browser
 * available in this sandbox). Only what the UI kit and the apps actually touch.
 * Usage: import { installDom, reportDomGaps } from './domstub.mjs';
 */

const noop = () => {};
/* capture the real host timers before wire() shadows them (a wrapper that
 * calls the global would recurse forever) */
const _setTimeout = globalThis.setTimeout.bind(globalThis);
const _clearTimeout = globalThis.clearTimeout.bind(globalThis);
const _setInterval = globalThis.setInterval.bind(globalThis);
const _clearInterval = globalThis.clearInterval.bind(globalThis);
const LISTENERS = [];
const TIMERS = new Map(); // id -> { kind, ms, at }

class Node0 {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this._handlers = new Map();
  }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i + 1] || null;
  }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.nodeType === 9; }
  appendChild(n) {
    if (!n) return n;
    if (n.nodeType === 11) { [...n.childNodes].forEach((c) => this.appendChild(c)); return n; }
    n.parentNode?.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  append(...ns) { ns.flat(4).forEach((n) => this.appendChild(n == null ? null : typeof n === 'object' ? n : textNode(String(n)))); }
  prepend(...ns) { ns.flat(4).forEach((n) => this.childNodes.unshift(typeof n === 'object' ? n : textNode(String(n)))); }
  insertBefore(n, ref) {
    if (!n) return n;
    n.parentNode?.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
  replaceChild(n, old) { const i = this.childNodes.indexOf(old); if (i >= 0) this.childNodes[i] = n; n.parentNode = this; return old; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); if (n) n.parentNode = null; return n; }
  remove() { this.parentNode?.removeChild(this); }
  replaceChildren(...ns) { this.childNodes = []; this.append(...ns); }
  addEventListener(t, fn, opts) {
    if (!fn) return;
    if (!this._handlers.has(t)) this._handlers.set(t, []);
    this._handlers.get(t).push(fn);
    if (t === 'pointermove' || t === 'touchmove' || t === 'mousemove') LISTENERS.push({ node: this, type: t, fn, opts });
  }
  removeEventListener(t, fn) { const a = this._handlers.get(t); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  dispatchEvent(ev) {
    if (!ev || !ev.type) return true;
    if (!ev.target) ev.target = this;
    let node = this;
    while (node) {
      ev.currentTarget = node;
      for (const fn of [...(node._handlers?.get(ev.type) || [])]) {
        try { if (fn.handleEvent) fn.handleEvent(ev); else fn(ev); } catch (e) { if (e?.name !== 'DomGap') throw e; recordGap(e.message); }
      }
      if (ev._stop) break;
      node = ev.bubbles === false ? null : node.parentNode;
    }
    return !ev.defaultPrevented;
  }
  _fire(type, ev = {}) { this.dispatchEvent({ type, bubbles: true, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; }, ...ev }); }
  get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(''); }
  set textContent(v) { this.childNodes = []; if (v !== '' && v != null) this.appendChild(textNode(String(v))); }
  set innerHTML(v) {
    this.childNodes = []; this._html = String(v);
    const frag = parseFragment(String(v));
    frag.childNodes.slice().forEach((c) => this.appendChild(c));
  }
  get innerHTML() { return this._html || ''; }
  closest(sel) { let n = this; while (n && n.matches && !n.matches(sel)) n = n.parentNode; return n && n.matches?.(sel) ? n : null; }
  matches(sel) { return matchChain(this, sel) }
  querySelector(sel) { for (const el of descendants(this)) if (el.matches?.(sel)) return el; return null; }
  querySelectorAll(sel) { return descendants(this).filter((el) => el.matches?.(sel)); }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 800, width: 400, height: 800, toJSON: noop }; }
  contains(n) { return descendants(this).includes(n); }
  setPointerCapture = noop; releasePointerCapture = noop; hasPointerCapture = () => false;
  scrollIntoView = noop; scrollTo = noop; scrollBy = noop; focus = noop; blur = noop; select = noop; setCustomValidity = noop;
  animate = () => ({ finished: Promise.resolve(), cancel: noop, onfinish: null });
  getRootNode() { return document; }
  cloneNode(deep) { const c = this.nodeType === 3 ? textNode(this.data) : createElement(this.tagName.toLowerCase()); if (deep) [...this.childNodes].forEach((n) => c.appendChild(n.cloneNode(true))); return c; }
  insertAdjacentElement(_pos, n) { return this.appendChild(n); }
  /** minimal HTML sink: enough for the badges/icons the shell injects as strings */
  insertAdjacentHTML(pos, html) {
    const frag = parseFragment(String(html));
    if (pos === 'afterbegin') this.childNodes.unshift(...frag.childNodes.map((c) => (c.parentNode = this, c)));
    else frag.childNodes.slice().forEach((c) => this.appendChild(c));
  }
}

function* walkDesc(n) { for (const c of [...n.childNodes]) { if (c.nodeType === 1) { yield c; yield* walkDesc(c); } } }
const descendants = (n) => [...walkDesc(n)];
/** supports "a b c" descendant combinators, which the shell's CSS uses constantly */
function matchChain(el, sel) {
  const groups = String(sel).split(',').map((g) => g.trim()).filter(Boolean);
  if (groups.length > 1) return groups.some((g) => matchChain(el, g));
  const parts = String(sel).trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return matchAll(el, sel);
  let cur = el;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (i === parts.length - 1) { if (!matchAll(cur, parts[i])) return false; continue; }
    let found = false;
    while (cur.parentNode && !found) { cur = cur.parentNode; if (cur.nodeType === 1 && matchAll(cur, parts[i])) found = true; }
    if (!found) return false;
  }
  return true;
}
function matchAll(el, sel) { return sel.split(',').some((s) => matchesOne(el, s.trim())); }
function matchesOne(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  const parts = sel.match(/([a-zA-Z][\w-]*)?((?:[#.][\w-]+)*)?(\[[^\]]+\])?/g) || [];
  let rest = sel;
  const attr = rest.match(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/);
  if (attr) { if (el.getAttribute(attr[1]) == null) return false; rest = rest.replace(attr[0], ''); }
  const tag = rest.match(/^([a-zA-Z][\w-]*)/);
  if (tag && el.tagName !== tag[1].toUpperCase()) return false;
  const classes = rest.match(/\.[\w-]+/g) || [];
  const ids = rest.match(/#[\w-]+/g) || [];
  if (classes.some((c) => !el.classList?.contains(c.slice(1)))) return false;
  if (ids.some((i) => el.id !== i.slice(1))) return false;
  return Boolean(tag || classes.length || ids.length || attr);
}
/** a deliberately small tag parser (no entities, no self-closing maths) */
function parseFragment(html) {
  const root = new Node0(11);
  const stack = [root];
  const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[\w-]+=(?:"[^"]*"|'[^']*'|[^\s>]+))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) {
      const txt = m[4];
      if (txt.trim()) top.appendChild(textNode(txt.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')));
      continue;
    }
    const closing = m[0][1] === '/';
    if (closing) { if (stack.length > 1) stack.pop(); continue; }
    const el = new Element(m[1]);
    if (m[2]) for (const a of m[2].trim().split(/\s+(?=[\w-]+=)/)) {
      const eq = a.indexOf('=');
      if (eq < 0) el.setAttribute(a, '');
      else el.setAttribute(a.slice(0, eq).trim(), a.slice(eq + 1).trim().replace(/^["']|["']$/g, ''));
    }
    top.appendChild(el);
    if (!m[3] && !['br', 'img', 'input', 'path', 'use', 'hr', 'meta', 'source'].includes(m[1].toLowerCase())) stack.push(el);
  }
  return root;
}
/** innerHTML as a getter that reports the tree, and as a setter that parses */
const textNode = (data) => {
  const n = new Node0(3);
  n.data = String(data);
  // bypass Node0's textContent setter (it would appendChild → recurse)
  Object.defineProperty(n, 'textContent', { get: () => n.data, set: (v) => { n.data = String(v); }, configurable: true, enumerable: true });
  return n;
};

const STYLE_PROPS = ['width', 'height', 'top', 'right', 'bottom', 'left', 'transform', 'display', 'opacity', 'visibility', 'position', 'color', 'background', 'fontSize', 'borderRadius', 'zIndex', 'aspectRatio', 'pointerEvents', 'flex', 'gridTemplateColumns', 'alignItems', 'justifyContent', 'gap', 'padding', 'margin', 'maxWidth', 'minWidth', 'maxHeight', 'minHeight', 'overflow', 'transition', 'filter', 'boxShadow', 'textShadow', 'border', 'outline', 'cursor', 'textAlign', 'fontWeight', 'lineHeight', 'flexDirection', 'flexWrap', 'inset', 'rotate', 'scale', 'translate', 'widthPx'];

function makeStyle() {
  const store = {};
  return new Proxy(store, {
    get: (t, k) => (k === 'setProperty' ? (p, v) => { t[p] = v; }
      : k === 'removeProperty' ? (p) => { delete t[p]; }
      : k === 'getPropertyValue' ? (p) => (t[p] === undefined ? '' : String(t[p]))
      : k === 'cssText' ? '' : t[k] === undefined ? '' : t[k]),
    set: (t, k, v) => { t[k] = v; return true; },
    has: () => true,
    ownKeys: () => STYLE_PROPS,
    getOwnPropertyDescriptor: (t, k) => ({ value: t[k] ?? '', enumerable: true, writable: true, configurable: true }),
  });
}

const CANVAS_2D = new Set(['save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform', 'resetTransform', 'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'fill', 'stroke', 'clip', 'isPointInPath', 'fillText', 'strokeText', 'drawImage', 'putImageData', 'createLinearGradient', 'createRadialGradient', 'createConicGradient', 'createPattern', 'createImageData', 'setLineDash', 'getLineDash', 'filter', 'globalAlpha', 'globalCompositeOperation', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'lineCap', 'lineJoin', 'lineWidth', 'miterLimit', 'strokeStyle', 'fillStyle', 'font', 'textAlign', 'textBaseline', 'direction', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'letterSpacing', 'fontKerning']);

const grad = () => ({ addColorStop: noop });
function ctx2d(canvas) {
  const c = {
    canvas,
    save: noop, restore: noop, scale: noop, rotate: noop, translate: noop, transform: noop, setTransform: noop, resetTransform: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, arc: noop, arcTo: noop, ellipse: noop, rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop, isPointInPath: () => true, fillText: noop, strokeText: noop, drawImage: noop,
    putImageData: noop, setLineDash: noop, getLineDash: () => [], createLinearGradient: grad, createRadialGradient: grad, createConicGradient: grad,
    createPattern: () => ({}), createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (t) => ({ width: String(t).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
  };
  return new Proxy(c, { get: (t, k) => (k in t ? t[k] : CANVAS_2D.has(k) ? noop : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
}

const GAP = new Set();
const recordGap = (m) => { GAP.add(m); };
export const reportDomGaps = () => [...GAP];

class Element extends Node0 {
  constructor(tag) {
    super(1);
    this.tagName = String(tag).toUpperCase();
    this.localName = String(tag).toLowerCase();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.id = '';
    this._classes = new Set();
    this._attrs = new Map();
    this.style = makeStyle();
    this.dataset = {};
    this.scrollTop = 0; this.scrollLeft = 0; this.scrollHeight = 800; this.clientHeight = 780; this.clientWidth = 400;
    this.offsetWidth = 400; this.offsetHeight = 780; this.offsetLeft = 0; this.offsetTop = 0;
    this.value = ''; this.checked = false; this.disabled = false; this.selected = false; this.hidden = false;
    this.files = null; this.selectionStart = 0; this.selectionEnd = 0;
    const self = this;
    this.classList = {
      add: (...c) => c.flat().forEach((x) => x && self._classes.add(String(x))),
      remove: (...c) => c.flat().forEach((x) => self._classes.delete(String(x))),
      toggle: (c, force) => { const want = force === undefined ? !self._classes.has(c) : !!force; want ? self._classes.add(c) : self._classes.delete(c); return want; },
      contains: (c) => self._classes.has(String(c)),
      replace: (a, b) => { self._classes.delete(a); self._classes.add(b); },
      get length() { return self._classes.size; },
    };
    if (this.localName === 'canvas') {
      this.width = 300; this.height = 150;
      this._ctx = null;
      this.getContext = (kind) => (kind === '2d' ? (this._ctx ||= ctx2d(this)) : kind === 'bitmaprenderer' ? { transferFromImageBitmap: noop, close: noop } : null);
      this.toDataURL = () => 'data:image/png;base64,ZGFoYXQ=';
      this.toBlob = (cb) => cb(new Blob(['fake-png'], { type: 'image/png' }));
    }
    if (['video', 'audio'].includes(this.localName)) {
      Object.assign(this, { srcObject: null, src: '', currentTime: 0, duration: 30, paused: true, volume: 1, muted: false, loop: false, playbackRate: 1, readyState: 0, videoWidth: 640, videoHeight: 480, remote: { setPlaybackState: noop } });
      this.play = () => { this.paused = false; this.readyState = 4; setTimeout(() => { this._fire('loadedmetadata'); this._fire('loadeddata'); this._fire('canplay'); this._fire('playing'); }, 0); return Promise.resolve(); };
      this.pause = () => { this.paused = true; };
      this.setSinkId = async () => {};
    }
    if (this.localName === 'img') { Object.assign(this, { src: '', naturalWidth: 640, naturalHeight: 480, crossOrigin: null, decoding: 'async' }); setTimeout(() => { this._fire('load'); }, 0); }
    if (this.localName === 'input' || this.localName === 'textarea' || this.localName === 'select') {
      Object.assign(this, { type: 'text', placeholder: '', pattern: '', min: '', max: '', step: '', multiple: false, accept: '', selectionDirection: 'forward' });
      this.select = () => {}; this.setRangeText = noop; this.setSelectionRange = noop;
    }
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this._attrs.set(k, String(v)); if (k === 'class') this.className = v; if (k === 'id') this.id = v; if (k === 'value') this.value = v; if (k === 'src') this.src = v; if (k === 'type') this.type = v; if (k === 'width') this.width = +v || 0; if (k === 'height') this.height = +v || 0; if (k === 'for') this.htmlFor = v; if (k === 'href') this.href = v; if (k === 'download') this.download = v; if (k === 'srcdoc') this.srcdoc = v; }
  setAttributeNS(_ns, k, v) { this.setAttribute(k, v); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : (k === 'class' ? this.className : null); }
  hasAttribute(k) { return this._attrs.has(k) || (k === 'id' && !!this.id); }
  removeAttribute(k) { this._attrs.delete(k); }
  toggleAttribute(k, force) { const has = this.hasAttribute(k); const want = force === undefined ? !has : !!force; want ? this.setAttribute(k, '') : this.removeAttribute(k); return want; }
  click() { this._fire('click', { detail: 1, clientX: 10, clientY: 10, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }); this._fire('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 10, button: 0, buttons: 1 }); }
  get parentNodeRef() { return this.parentNode; }
  get ownerDocument() { return document; }
}

const createElement = (tag) => new Element(tag);

class Doc extends Node0 {
  constructor() {
    super(9);
    this.documentElement = new Element('html');
    this.head = new Element('head');
    this.body = new Element('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.title = 'Dahat OS';
    this.readyState = 'complete';
    this.visibilityState = 'visible';
    this.hidden = false;
    this.activeElement = this.body;
    this.fullscreenElement = null;
    this.pointerLockElement = null;
    this.fonts = { load: async () => {}, ready: Promise.resolve(), check: () => true, add: noop };
    this.prerendering = false;
  }
  createElement = createElement;
  createElementNS = (_ns, tag) => createElement(tag);
  createTextNode = (d) => textNode(String(d));
  createDocumentFragment = () => new Node0(11);
  createEvent = (t) => ({ type: '', initEvent(type) { this.type = type; }, bubbles: true });
  createRange = () => ({ selectNodeContents: noop, cloneRange: () => ({ select: noop }), deleteContents: noop, surroundContents: noop });
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  getElementById(id) { return descendants(this.documentElement).find((e) => e.id === id) || null; }
  getElementsByClassName(c) { return descendants(this.documentElement).filter((e) => e.classList.contains(c)); }
  exitFullscreen = async () => {};
  exitPointerLock = noop;
  write = noop; writeln = noop; open = () => document; close = noop;
  execCommand = () => true;
  hasFocus = () => true;
  getSelection = () => ({ removeAllRanges: noop, addRange: noop, toString: () => '', rangeCount: 0 });
  defaultView = null;
}

const document = new Doc();

class Event0 {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles ?? false;
    this.cancelable = opts.cancelable ?? false;
    this.composed = opts.composed ?? false;
    this.defaultPrevented = false;
    this.target = opts.target || null;
    this.currentTarget = opts.target || null;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; }
  composedPath() { return []; }
}
class CustomEvent0 extends Event0 { constructor(t, o = {}) { super(t, o); this.detail = o.detail ?? null; } }
class KeyboardEvent0 extends CustomEvent0 {
  constructor(t, o = {}) { super(t, o); Object.assign(this, { key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, isComposing: false }, o); }
}
class PointerEvent0 extends CustomEvent0 {
  constructor(t, o = {}) {
    super(t, o);
    Object.assign(this, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 10, pageX: 10, pageY: 10, offsetX: 10, offsetY: 10, button: 0, buttons: 1, pressure: 0.5, width: 20, height: 20, tiltX: 0, tiltY: 0, twist: 0 }, o);
  }
}
class MouseEvent0 extends PointerEvent0 {}
class TouchEvent0 extends CustomEvent0 {
  constructor(t, o = {}) { super(t, o); this.touches = o.touches || []; this.changedTouches = o.changedTouches || this.touches; this.targetTouches = o.targetTouches || this.touches; }
}
class Blob0 {
  constructor(parts = [], opts = {}) { this._p = parts.map((p) => (p && p._p ? String(p._p) : String(p))).join(''); this.type = opts.type || ''; this.size = this._p.length; }
  async text() { return this._p; }
  async arrayBuffer() { return new TextEncoder().encode(this._p).buffer; }
  stream() { return { getReader: () => ({ read: async () => ({ done: true, value: undefined }), releaseLock: noop }) }; }
  slice() { return new Blob0([this._p], { type: this.type }); }
}
class File0 extends Blob0 { constructor(parts, name, opts = {}) { super(parts, opts); this.name = String(name); this.lastModified = Date.now(); } }
class Image0 extends Element { constructor() { super('img'); } set src(v) { this._src = v; setTimeout(() => this._fire('load'), 0); } get src() { return this._src || ''; } }
class Audio0 extends Element { constructor(src) { super('audio'); this._src = src; } get src() { return this._src; } set src(v) { this._src = v; } play() { return Promise.resolve(); } pause() {} addEventListener() {} }

class AudioParam0 {
  constructor(v = 0) { this.value = v; this.defaultValue = v; }
  setValueAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; return this; }
  exponentialRampToValueAtTime(v) { this.value = Math.max(1e-6, v); return this; }
  setTargetAtTime(v) { this.value = v; return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
}
const audioNode = (extra = {}) => new Proxy({ connect: (n) => n || {}, disconnect: noop, start: noop, stop: noop, channelCount: 2, onended: null, ...extra }, { get: (t, k) => (k in t ? t[k] : t[k] === undefined && typeof k === 'string' && !k.startsWith('_') ? undefined : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
function ctxAudio() { return ({
  destination: audioNode(),
  sampleRate: 48000,
  state: 'running',
  currentTime: 0,
  baseLatency: 0.01,
  resume: async () => {},
  suspend: async () => {},
  close: async () => {},
  createOscillator: () => audioNode({ type: 'sine', frequency: new AudioParam0(440), detune: new AudioParam0(0), setPeriodicWave: noop, onended: null }),
  createGain: () => audioNode({ gain: new AudioParam0(1) }),
  createBiquadFilter: () => audioNode({ type: 'lowpass', frequency: new AudioParam0(1000), Q: new AudioParam0(1), gain: new AudioParam0(0), detune: new AudioParam0(0) }),
  createDynamicsCompressor: () => audioNode({ threshold: new AudioParam0(-24), knee: new AudioParam0(30), ratio: new AudioParam0(12), attack: new AudioParam0(0.003), release: new AudioParam0(0.25) }),
  createConvolver: () => audioNode({ buffer: null, normalize: true }),
  createWaveShaper: () => audioNode({ curve: null, oversample: 'none' }),
  createDelay: () => audioNode({ delayTime: new AudioParam0(0) }),
  createStereoPanner: () => audioNode({ pan: new AudioParam0(0) }),
  createBufferSource: () => audioNode({ buffer: null, playbackRate: new AudioParam0(1), detune: new AudioParam0(0), loop: false, loopStart: 0, loopEnd: 0 }),
  createChannelMerger: () => audioNode(),
  createChannelSplitter: () => audioNode(),
  createAnalyser: () => audioNode({ fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.8, getByteFrequencyData: noop, getByteTimeDomainData: noop, getFloatFrequencyData: noop }),
  createMediaStreamSource: () => audioNode(),
  createMediaElementSource: () => audioNode(),
  createMediaStreamDestination: () => audioNode({ stream: fakeStream() }),
  createPeriodicWave: () => ({}),
  createBuffer: (ch, len, rate) => ({ numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: () => new Float32Array(len), copyToChannel: noop, copyFromChannel: noop }),
  listener: { setPosition: noop, positionX: new AudioParam0(0) },
  audioWorklet: { addModule: async () => {} },
  onstatechange: null,
  addEventListener: noop, removeEventListener: noop,
}); }
function fakeStream() {
  const track = { kind: 'video', label: 'fake-cam', enabled: true, readyState: 'live', stop: noop, getCapabilities: () => ({}), getSettings: () => ({ width: 1280, height: 720, facingMode: 'environment' }), applyConstraints: async () => {}, addEventListener: noop, removeEventListener: noop };
  const stream = { id: 'fake', active: true, getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [track], addEventListener: noop, removeEventListener: noop, addTrack: noop, getTrackById: () => null };
  return stream;
}

class Rec0 {
  constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; this.audioBitsPerSecond = 0; this.ondataavailable = null; this.onstop = null; this.onerror = null; }
  start() { this.state = 'recording'; this._chunks = []; setTimeout(() => this.ondataavailable?.({ data: new Blob0(['fake-audio']) }), 0); }
  stop() { this.state = 'inactive'; setTimeout(() => this.onstop?.({}), 0); }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
}

function wire(target) {
  const set = {
    document,
    Node: Node0, Element, Event: Event0, CustomEvent: CustomEvent0, KeyboardEvent: KeyboardEvent0, PointerEvent: PointerEvent0, MouseEvent: MouseEvent0, TouchEvent: TouchEvent0, Touch: class { constructor(o = {}) { Object.assign(this, { identifier: 1, clientX: 10, clientY: 10, pageX: 10, pageY: 10, target: null }, o); } },
    Blob: Blob0, File: File0, Image: Image0, Audio: Audio0, ImageData: class { constructor(a, b, c) { if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } else { this.width = a.width; this.height = a.height; this.data = a; } } },
    DOMMatrix: class { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } multiplySelf() { return this; } scale() { return this; } translate() { return this; } inverse() { return this; } static fromMatrix() { return new DOMMatrix(); } },
    DOMPoint: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } },
    DOMRect: class { constructor(x = 0, y = 0, w = 0, h = 0) { Object.assign(this, { x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h }); } },
    Text: class { }, NodeFilter: { FILTER_ACCEPT: 1 },
    requestAnimationFrame: (fn) => { const id = _setTimeout(() => { TIMERS.delete(id); try { fn(performance.now()); } catch (e) { rethrowReal(e); } }, 16); TIMERS.set(id, { kind: 'raf', ms: 16, at: new Error().stack }); return id; },
    cancelAnimationFrame: (id) => { TIMERS.delete(id); if (id != null) _clearTimeout(id); },
    queueMicrotask: (fn) => Promise.resolve().then(fn),
    matchMedia: (q) => { const m = { media: q, matches: /prefers-color-scheme: *light/.test(q) ? false : /any-hover|pointer: *fine|min-width|hover: *hover/.test(q) ? false : true, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop, onchange: null, dispatchEvent: () => true }; return m; },
    getComputedStyle: () => ({ getPropertyValue: () => '', fontSize: '16px', width: '400px', height: '780px' }),
    CSS: { supports: () => true, escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`), hyphens: 'auto' },
    Notification: Object.assign(class { constructor(title, opts = {}) { this.title = title; this.options = opts; this.onclick = null; setTimeout(() => this.onshow?.(), 0); } close() {} show() {} addEventListener() {} removeEventListener() {} static permission = 'granted'; static async requestPermission() { return 'granted'; } }, { permission: 'granted' }),
    Worker: class { constructor() { this.onmessage = null; this.onerror = null; } postMessage() {} terminate() {} addEventListener() {} removeEventListener() {} },
    ResizeObserver: class { constructor(cb) { this.cb = cb; } observe(el) { setTimeout(() => this.cb([{ target: el, contentRect: { width: 400, height: 780 } }], this), 0); } unobserve() {} disconnect() {} },
    IntersectionObserver: class { constructor(cb) { this.cb = cb; } observe(el) { setTimeout(() => this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el, boundingClientRect: { top: 0, bottom: 780 } }], this), 0); } unobserve() {} disconnect() {} takeRecords() { return []; } },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    PerformanceObserver: class { observe() {} disconnect() {} },
    AudioContext: ctxAudio, webkitAudioContext: ctxAudio, OfflineAudioContext: class { constructor(ch, len, rate) { Object.assign(this, ctxAudio(), { length: len, sampleRate: rate, state: 'suspended', startRendering: async () => ({ numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: () => new Float32Array(len) }) }); } },
    MediaRecorder: Rec0,
    URLSearchParams, URL: Object.assign(URL, { createObjectURL: () => 'blob:dahat/fake', revokeObjectURL: noop, canParse: (u) => /^https?:|^blob:|^data:/.test(String(u)) }),
    FileReader: class { constructor() { this.result = null; this.onload = null; this.onerror = null; this.onloadend = null; } readAsDataURL(b) { setTimeout(() => { this.result = 'data:' + (b?.type || 'application/octet-stream') + ';base64,ZGFoYXQ='; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }, 0); } readAsText(b) { setTimeout(() => { this.result = b?._p ?? ''; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }, 0); } readAsArrayBuffer() { setTimeout(() => { this.result = new ArrayBuffer(4); this.onload?.({ target: this }); }, 0); } abort() {} },
    FileReaderSync: class { readAsDataURL() { return 'data:image/png;base64,ZGFoYXQ='; } },
    DataTransfer: class { constructor() { this.items = []; this.files = []; this.dropEffect = 'move'; this.effectAllowed = 'all'; } get data() { return ''; } setData() {} getData() { return ''; } setDragImage() {} },
    DataTransferItem: class { getAsFile() { return new File0(['x'], 'f.txt'); } getAsString(cb) { cb(''); } },
    ClipboardItem: class { constructor(items) { this._items = items; } },
    DragEvent: MouseEvent0, ClipboardEvent: MouseEvent0, FocusEvent: Event0, InputEvent: Event0, WheelEvent: MouseEvent0, AnimationEvent: Event0, TransitionEvent: class extends Event0 { constructor(t, o = {}) { super(t, o); Object.assign(this, { propertyName: 'transform', elapsedTime: 0.2 }, o); } },
    DeviceLightEvent: Event0, StorageEvent: class extends Event0 { constructor(t, o = {}) { super(t, o); Object.assign(this, o); } },
    PageTransitionEvent: Event0, SubmitEvent: Event0, FormData: class { constructor() { this._ = new Map(); } append(k, v) { this._.set(k, v); } get(k) { return this._.get(k); } set(k, v) { this._.set(k, v); } has(k) { return this._.has(k); } entries() { return this._.entries(); } forEach(f) { for (const [k, v] of this._) f(v, k); } get all() { return [] } },
    Headers, Request: class { constructor(u, o = {}) { this.url = u; Object.assign(this, o); } }, Response: class { constructor(b, o = {}) { this.body = b; Object.assign(this, { ok: true, status: 200, statusText: 'OK', headers: new Headers() }, o); } async json() { return {}; } async text() { return String(this.body ?? ''); } async blob() { return new Blob0([this.body ?? '']); } },
    EventTarget: class { addEventListener() {} removeEventListener() {} dispatchEvent() { return true; } },
    HTMLElement: Element, SVGElement: Element, HTMLCanvasElement: Element, SVGRect: {},
    structuredClone: (v) => JSON.parse(JSON.stringify(v)),
    reportError: (e) => { REAL.push(e); },
    scroll: noop, scrollTo: noop, scrollBy: noop,
    visualViewport: { width: 400, height: 780, offsetTop: 0, scale: 1, addEventListener: noop, removeEventListener: noop },
    history: { state: null, length: 1, replaceState: noop, pushState: noop, back: noop, forward: noop, go: noop, scrollRestoration: 'auto' },
    location: { href: 'https://dahat.os/index.html', origin: 'https://dahat.os', protocol: 'https:', host: 'dahat.os', hostname: 'dahat.os', port: '', pathname: '/index.html', search: '', hash: '', replace: noop, assign: noop, reload: noop, toString: () => 'https://dahat.os/' },
    navigator: {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) DahatOS/1.0 NodeSmoke',
      platform: 'Android', appVersion: '5.0', vendor: '', language: 'en-GB', languages: ['en-GB', 'si-LK'],
      onLine: true, doNotTrack: null, hardwareConcurrency: 8, maxTouchPoints: 5,
      vibrate: (p) => { VIBES.push(p); return true; },
      clipboard: { readText: async () => '', writeText: async (t) => { CLIP.push(t); }, read: async () => [], write: async () => {} },
      share: undefined, canShare: () => false,
      wakeLock: { request: async (_k) => ({ type: 'screen', released: false, addEventListener: noop, removeEventListener: noop, release: async () => { wakeHeld--; } }), _supported: true },
      getBattery: async () => ({ level: 0.72, charging: true, chargingTime: 0, dischargingTime: Infinity, addEventListener: noop, removeEventListener: noop, addEventListener: noop }),
      connection: { saveData: false, effectiveType: '4g', downlink: 10, rtt: 50, addEventListener: noop, removeEventListener: noop },
      mediaDevices: { getUserMedia: async (c) => { CAM = c; return fakeStream(); }, enumerateDevices: async () => [{ deviceId: '1', kind: 'videoinput', label: 'fake-cam', groupId: 'g' }], getDisplayMedia: async () => fakeStream(), addEventListener: noop, removeEventListener: noop },
      permissions: { query: async (d) => ({ state: d?.name === 'microphone' ? 'granted' : 'prompt', onchange: null, addEventListener: noop, removeEventListener: noop }) },
      serviceWorker: { ready: Promise.resolve({ update: async () => {}, addEventListener: noop }), register: async () => ({ update: async () => {}, addEventListener: noop }), addEventListener: noop },
      keyboard: { getLayoutMap: async () => ({ get: () => '', keys: new Map() }), addEventListener: noop },
      getGamepads: () => [], sendBeacon: () => true, javaEnabled: () => false, registerProtocolHandler: noop,
      storage: { getDirectory: async () => { throw new Error('no OPFS'); }, persisted: async () => false, persist: async () => true, estimate: async () => ({ quota: 1e9, usage: 0 }), requestPermission: async () => 'granted' },
      contacts: undefined, serial: undefined, usb: undefined, bluetooth: undefined, mediaCapabilities: { decodingCapabilities: async () => ({ supported: true }) },
      scheduling: { isInputPending: () => false },
      userAgentData: { mobile: true, platform: 'Android', brands: [{ brand: 'DahatOS', version: '1' }] },
    },
    setInterval: (fn, ms, ...a) => { const id = _setInterval(() => { try { fn(...a); } catch (e) { rethrowReal(e); } }, Math.max(4, ms || 16)); TIMERS.set(id, { kind: 'interval', ms: ms || 16, at: new Error().stack }); return id; },
    clearInterval: (id) => { TIMERS.delete(id); if (id != null) _clearInterval(id); },
    DahatTimers: TIMERS,
    setTimeout: (fn, ms, ...a) => { const id = _setTimeout(() => { TIMERS.delete(id); try { fn(...a); } catch (e) { rethrowReal(e); } }, Math.max(0, ms || 0)); TIMERS.set(id, { kind: 'timeout', ms: ms || 0, at: new Error().stack }); return id; },
    clearTimeout: (id) => { TIMERS.delete(id); if (id != null) _clearTimeout(id); },
    self: null, window: null, top: null, parent: null, frames: [], frameElement: null, closed: false, name: '',
    screen: { width: 412, height: 915, availWidth: 412, availHeight: 880, colorDepth: 24, pixelDepth: 24, orientation: { type: 'portrait-primary', angle: 0, lock: async () => {}, unlock: noop, addEventListener: noop, removeEventListener: noop } },
    devicePixelRatio: 2, innerWidth: 412, innerHeight: 915, outerWidth: 412, outerHeight: 915, isSecureContext: true,
    localStorage: memStorage('local'), sessionStorage: memStorage('session'),
    indexedDB: { open: () => { const req = { result: fakeDb(), onsuccess: null, onerror: null, onupgradeneeded: null, addEventListener(t, f) { if (t.startsWith('on')) this[t] = f; }, error: null, transaction: noop }; setTimeout(() => { req.onsuccess?.({ target: req }); req.result && 0; }, 0); return req; }, deleteDatabase: async () => ({}), cmp: (a, b) => (a > b ? 1 : a < b ? -1 : 0) },
    crypto: globalThis.crypto,
    fetch: async (url) => ({ ok: false, status: 599, statusText: 'smoke: no network', url: String(url), headers: new Headers(), async text() { return ''; }, async json() { return { smoke: true }; }, async blob() { return new Blob0(['']); } }),
    XMLHttpRequest: class { constructor() { this.readyState = 0; this.status = 0; this.responseText = ''; this.responseType = ''; this.onload = null; this.onerror = null; this.upload = { addEventListener: noop }; } open() {} setRequestHeader() {} send() { setTimeout(() => this.onerror?.({}), 0); } abort() {} addEventListener() {} getAllResponseHeaders() { return ''; } },
    EventSource: class { constructor() { this.onmessage = null; this.onerror = null; } close() {} addEventListener() {} },
    WebSocket: class { constructor() { this.readyState = 0; this.onopen = null; this.onmessage = null; this.onclose = null; setTimeout(() => this.onopen?.({}), 0); } send() {} close() {} addEventListener() {} },
    RTCPeerConnection: class { addTrack() {} close() {} async createOffer() { return {}; } async setLocalDescription() {} },
    OffscreenCanvas: class { constructor(w, h) { Object.assign(this, createElement('canvas'), { width: w, height: h }); } getContext(kind) { return kind === '2d' ? ctx2d(this) : null; } transferToImageBitmap() { return {}; } },
    Path2D: class { constructor() {} addPath() {} moveTo() {} lineTo() {} arc() {} rect() {} closePath() {} bezierCurveTo() {} quadraticCurveTo() {} },
    TextEncoder, TextDecoder, URL, atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    customElements: { define: noop, get: () => undefined, whenDefined: async () => {} },
    TrustedHTML: class {}, trustedTypes: undefined,
    SharedWorker: class { constructor() { this.port = { postMessage: noop, start: noop, onmessage: null, close: noop }; } },
    BroadcastChannel: class { constructor() { this.onmessage = null; this.onmessageerror = null; } postMessage() {} close() {} addEventListener() {} removeEventListener() {} },
    PostMessage: noop,
    Selection: class {}, StaticRange: class {}, Range: class { selectNodeContents() {} cloneRange() { return this; } },
    CanvasRenderingContext2D: class {}, ImageBitmap: class {}, HTMLCollection: class { item() { return null } },
    DOMException: class extends Error { constructor(m, name) { super(m); this.name = name || 'Error'; } },
    ErrorEvent: Event0, PromiseRejectionEvent: Event0, UIEvent: Event0,
  };
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined && k !== 'trustedTypes') continue;
    try { Object.defineProperty(target, k, { value: v, writable: true, configurable: true, enumerable: false }); } catch { try { target[k] = v; } catch { /* frozen host prop */ } }
  }
}

const memStorage = (label) => {
  const m = new Map();
  return {
    _label: label, _map: m,
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
};
function fakeDb() {
  const store = () => {
    const ok = (v) => { const r = { result: v, onsuccess: null, onerror: null, set onresult(f) { this._f = f; setTimeout(() => f({ target: r }), 0); }, get onresult() { return this._f } }; setTimeout(() => r.onsuccess?.({ target: r }), 0); return r; };
    const data = new Map();
    return { put: (v, k) => { data.set(k ?? v.id, v); return ok(undefined); }, get: (k) => ok(data.get(k)), delete: (k) => { data.delete(k); return ok(undefined); }, clear: () => { data.clear(); return ok(undefined); }, getAll: () => ok([...data.values()]), getAllKeys: () => ok([...data.keys()]), count: () => ok(data.size), index: () => ({ get: (k) => ok(data.get(k)), getAll: () => ok([...data.values()]) }), createIndex: noop, keyPath: 'id' };
  };
  const db = { objectStoreNames: { contains: () => true, length: 0 }, createObjectStore: () => store(), transaction: () => ({ objectStore: () => store(), oncomplete: null, onerror: null, onabort: null }), objectStore: () => store(), close: noop, onversionchange: null, version: 1 };
  return db;
}

const REAL = [];
const VIBES = [];
const CLIP = [];
let CAM = null, wakeHeld = 0;
function rethrowReal(e) { REAL.push(e); }

export function installDom() {
  document.defaultView = globalThis;
  document.addEventListener = Element.prototype.addEventListener.bind(document);
  document.dispatchEvent = Node0.prototype.dispatchEvent.bind(document);
  document.body._handlers = new Map();
  document.documentElement._handlers = new Map();
  document._handlers = new Map();
  document.onclick = null;
  globalThis.document = document;
  wire(globalThis);
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.top = globalThis;
  globalThis.parent = globalThis;
  globalThis.window.addEventListener = (t, fn) => { (globalThis.__wl ||= new Map()); if (!globalThis.__wl.has(t)) globalThis.__wl.set(t, []); globalThis.__wl.get(t).push(fn); };
  globalThis.window.removeEventListener = (t, fn) => { const a = globalThis.__wl?.get(t); if (a) a.splice(a.indexOf(fn), 1); };
  globalThis.window.dispatchEvent = (ev) => { for (const fn of globalThis.__wl?.get(ev?.type) || []) { try { fn(ev); } catch (e) { rethrowReal(e); } } return true; };
  globalThis.screen.orientation.type = 'portrait-primary';
  return { document, REAL, VIBES, CLIP, get cam() { return CAM; }, get wakeHeld() { return wakeHeld; }, TIMERS, LISTENERS,
    allTimers: () => [...TIMERS], clearAll: () => { for (const t of TIMERS) { clearTimeout(t); clearInterval(t); } TIMERS.clear(); },
    fireGlobal: (type, ev = {}) => globalThis.window.dispatchEvent({ type, bubbles: true, preventDefault() {}, stopPropagation() {}, ...ev }) };
}
