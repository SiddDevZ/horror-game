// hidden debug overlay (F3 or ?debug=1). plain text, refreshed at 5 hz, only while visible.
export class DebugOverlay {
  constructor(game, visible) {
    this.g = game;
    this.el = null;
    this.visible = false;
    this.t = 0;
    if (visible) this.toggle();
  }

  toggle() {
    if (typeof document === 'undefined') return;
    this.visible = !this.visible;
    if (!this.el) {
      const el = document.createElement('pre');
      el.id = 'br-debug';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:60;margin:0;padding:8px 10px;font:11px/1.45 ui-monospace,Menlo,monospace;color:#ece6d6;background:rgba(14,13,10,.74);border-radius:4px;pointer-events:none;white-space:pre';
      document.body.appendChild(el);
      this.el = el;
    }
    this.el.hidden = !this.visible;
    this.t = 0;
  }

  update(dt) {
    if (!this.visible) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.2;
    this.el.textContent = this.g.debugText();
  }
}
