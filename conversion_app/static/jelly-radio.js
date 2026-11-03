/**
 * React Bits - JellyRadio Component (Vanilla JavaScript Port)
 * Dynamic squishy spring-physics segmented radio chip group.
 * Source: https://reactbits.dev/
 */

(function () {
  'use strict';

  const DEFAULT_ITEMS = ['Off', 'Low', 'Medium', 'High', 'Max'];
  const SIZES = { sm: [28, 12, 12], md: [36, 13, 16], lg: [44, 14, 20] };

  class SpringChannel {
    constructor(initVal) {
      this.current = initVal;
      this.target = initVal;
      this.velocity = 0;
      this.delay = 0;
      this.k = 580;
      this.m = 0.9;
      this.c = 20;
      this.active = false;
    }

    start(target, k, m, bounce, delaySec = 0) {
      this.target = target;
      this.k = k;
      this.m = Math.max(0.01, m);
      this.c = 2 * Math.sqrt(this.k * this.m) * (1 - bounce);
      this.delay = Math.max(0, delaySec);
      this.active = true;
    }

    jump(target) {
      this.current = target;
      this.target = target;
      this.velocity = 0;
      this.delay = 0;
      this.active = false;
    }

    update(dt) {
      if (!this.active) return false;
      if (this.delay > 0) {
        this.delay -= dt;
        if (this.delay > 0) return true;
        this.delay = 0;
      }

      // Damped harmonic oscillator: F = -k*(x - target) - c*v
      const f = -this.k * (this.current - this.target) - this.c * this.velocity;
      const a = f / this.m;
      this.velocity += a * dt;
      this.current += this.velocity * dt;

      // Convergence threshold
      if (Math.abs(this.current - this.target) < 0.0004 && Math.abs(this.velocity) < 0.0004) {
        this.current = this.target;
        this.velocity = 0;
        this.active = false;
        return false;
      }
      return true;
    }
  }

  /**
   * Creates a JellyRadio instance inside a container.
   * @param {HTMLElement|string} containerTarget
   * @param {Object} options
   */
  function createJellyRadio(containerTarget, options = {}) {
    const container = typeof containerTarget === 'string'
      ? document.querySelector(containerTarget)
      : containerTarget;

    if (!container) {
      console.warn('JellyRadio: target container not found.');
      return null;
    }

    const rawItems = options.items || DEFAULT_ITEMS;
    const list = rawItems.map(it => (typeof it === 'string' ? { value: it, label: it } : it));
    
    let innerValue = options.value ?? options.defaultValue ?? list[0]?.value;
    let selectedIndex = Math.max(0, list.findIndex(it => it.value === innerValue));

    const cfg = {
      chipColor: options.chipColor || '#27272a',
      activeColor: options.activeColor || '#f5f5f5',
      textColor: options.textColor || '#f5f5f5',
      activeTextColor: options.activeTextColor || '#18181b',
      size: options.size || 'md',
      gap: options.gap ?? 8,
      radius: options.radius ?? 18,
      swell: options.swell ?? 0.2,
      barge: options.barge ?? 6,
      shrink: options.shrink ?? 0.05,
      jelly: options.jelly ?? 1,
      bounce: options.bounce ?? 0.25,
      stagger: options.stagger ?? 22,
      stiffness: options.stiffness ?? 580,
      disabled: Boolean(options.disabled),
      ariaLabel: options.ariaLabel || 'Options',
      className: options.className || '',
      onChange: options.onChange
    };

    const [h, font, px] = SIZES[cfg.size] || SIZES.md;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    // Build DOM structure
    const groupEl = document.createElement('div');
    groupEl.className = `jelly-radio${cfg.className ? ` ${cfg.className}` : ''}`;
    groupEl.setAttribute('role', 'radiogroup');
    groupEl.setAttribute('aria-label', cfg.ariaLabel);
    if (cfg.disabled) groupEl.setAttribute('data-disabled', '');

    groupEl.style.setProperty('--jr-chip', cfg.chipColor);
    groupEl.style.setProperty('--jr-active', cfg.activeColor);
    groupEl.style.setProperty('--jr-text', cfg.textColor);
    groupEl.style.setProperty('--jr-active-text', cfg.activeTextColor);
    groupEl.style.setProperty('--jr-gap', `${cfg.gap}px`);
    groupEl.style.setProperty('--jr-radius', `${cfg.radius}px`);
    groupEl.style.setProperty('--jr-h', `${h}px`);
    groupEl.style.setProperty('--jr-font', `${font}px`);
    groupEl.style.setProperty('--jr-px', `${px}px`);

    const chips = [];
    let widths = [];

    list.forEach((item, i) => {
      const isSelected = i === selectedIndex;
      const chipBtn = document.createElement('button');
      chipBtn.type = 'button';
      chipBtn.className = 'jelly-radio__chip';
      chipBtn.setAttribute('role', 'radio');
      chipBtn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      chipBtn.setAttribute('data-on', isSelected ? 'true' : 'false');
      chipBtn.tabIndex = isSelected ? 0 : -1;
      if (cfg.disabled || item.disabled) chipBtn.disabled = true;

      const skinSpan = document.createElement('span');
      skinSpan.className = 'jelly-radio__skin';

      if (item.icon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'jelly-radio__icon';
        if (typeof item.icon === 'string' && (item.icon.startsWith('<') || item.icon.length > 4)) {
          iconSpan.innerHTML = item.icon;
        } else {
          iconSpan.textContent = item.icon;
        }
        skinSpan.appendChild(iconSpan);
      }

      const labelSpan = document.createElement('span');
      labelSpan.className = 'jelly-radio__label';
      labelSpan.textContent = item.label;
      skinSpan.appendChild(labelSpan);

      chipBtn.appendChild(skinSpan);
      groupEl.appendChild(chipBtn);

      const mv = {
        x: new SpringChannel(0),
        sx: new SpringChannel(isSelected ? 1 + cfg.swell : 1 - cfg.shrink),
        sy: new SpringChannel(isSelected ? 1 + cfg.swell : 1 - cfg.shrink)
      };

      chips.push({
        el: chipBtn,
        item,
        mv
      });

      chipBtn.addEventListener('click', (e) => {
        commit(i, e.detail === 0);
      });

      chipBtn.addEventListener('keydown', (e) => {
        onKeyDown(e, i);
      });
    });

    container.innerHTML = '';
    container.appendChild(groupEl);

    let rafId = null;
    let lastTime = 0;

    function startLoop() {
      if (!rafId) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    }

    function tick(now) {
      const dt = lastTime ? Math.min(0.032, (now - lastTime) / 1000) : 1 / 60;
      lastTime = now;
      let stillMoving = false;

      for (let i = 0; i < chips.length; i++) {
        const c = chips[i];
        const actX = c.mv.x.update(dt);
        const actSx = c.mv.sx.update(dt);
        const actSy = c.mv.sy.update(dt);
        if (actX || actSx || actSy) {
          stillMoving = true;
          c.el.style.transform = `translateX(${c.mv.x.current}px) scale(${c.mv.sx.current}, ${c.mv.sy.current})`;
        }
      }

      if (stillMoving) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
        lastTime = 0;
      }
    }

    function measure() {
      if (!groupEl.isConnected) return;
      widths = chips.map(c => c.el.offsetWidth || 0);
      const chipH = chips[0]?.el.offsetHeight || 0;
      const maxW = Math.max(0, ...widths);
      groupEl.style.setProperty('--jr-pad-x', `${Math.ceil((maxW * cfg.swell * 1.3) / 2 + cfg.barge) + 2}px`);
      groupEl.style.setProperty('--jr-pad-y', `${Math.ceil((chipH * cfg.swell) / 2) + 2}px`);
    }

    function apply(sel, instant) {
      const rtl = getComputedStyle(groupEl).direction === 'rtl';
      const push = ((widths[sel] ?? 0) * cfg.swell) / 2 + cfg.barge;

      for (let i = 0; i < chips.length; i++) {
        const c = chips[i];
        const on = i === sel;
        const far = Math.abs(i - sel);
        const dir = Math.sign(i - sel) * (rtl ? -1 : 1);
        const targetX = dir * push;
        const targetS = on ? 1 + cfg.swell : 1 - cfg.shrink;

        c.el.setAttribute('data-on', on ? 'true' : 'false');
        c.el.setAttribute('aria-checked', on ? 'true' : 'false');
        c.el.tabIndex = on ? 0 : -1;

        if (instant || reduceMotion) {
          c.mv.x.jump(targetX);
          c.mv.sx.jump(targetS);
          c.mv.sy.jump(targetS);
          c.el.style.transform = `translateX(${targetX}px) scale(${targetS}, ${targetS})`;
          continue;
        }

        const k = cfg.stiffness * (1 - 0.12 * Math.min(far, 3));
        const inFlight = c.mv.x.active || c.mv.sx.active || c.mv.sy.active;
        const delay = inFlight ? 0 : (far * cfg.stagger) / 1000;

        c.mv.x.start(targetX, k, 0.9, cfg.bounce, delay);

        const j = cfg.jelly;
        c.mv.sx.start(
          targetS,
          k * (1 + 0.24 * j),
          0.9 - 0.1 * j,
          Math.min(0.85, cfg.bounce + 0.3 * j),
          delay
        );

        c.mv.sy.start(
          targetS,
          k * (1 - 0.14 * j),
          0.9 + 0.05 * j,
          cfg.bounce,
          delay + 0.05 * j
        );
      }

      if (!instant && !reduceMotion) {
        startLoop();
      }
    }

    function commit(i, instant) {
      if (cfg.disabled || i === selectedIndex || !list[i] || list[i].disabled) return;
      selectedIndex = i;
      innerValue = list[i].value;
      apply(i, instant);
      if (typeof cfg.onChange === 'function') {
        cfg.onChange(list[i].value, i);
      }
    }

    function stepFrom(i, dir) {
      const n = list.length;
      let j = i;
      for (let tries = 0; tries < n; tries++) {
        j = (j + dir + n) % n;
        if (!list[j]?.disabled) return j;
      }
      return i;
    }

    function onKeyDown(e, i) {
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = stepFrom(i, 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = stepFrom(i, -1);
      else if (e.key === 'Home') next = stepFrom(-1, 1);
      else if (e.key === 'End') next = stepFrom(list.length, -1);
      else if (e.key === ' ' || e.key === 'Enter') next = i;
      if (next === null) return;
      e.preventDefault();
      commit(next, true);
      chips[next]?.el.focus();
    }

    const settle = () => {
      measure();
      apply(selectedIndex, true);
    };

    const resizeObserver = new ResizeObserver(settle);
    resizeObserver.observe(groupEl);
    document.fonts?.ready?.then(settle);
    requestAnimationFrame(settle);

    return {
      getValue() {
        return innerValue;
      },
      getIndex() {
        return selectedIndex;
      },
      setValue(val, instant = false) {
        const idx = list.findIndex(it => it.value === val);
        if (idx >= 0 && idx !== selectedIndex) {
          selectedIndex = idx;
          innerValue = val;
          apply(idx, instant);
        }
      },
      setDisabled(isDisabled) {
        cfg.disabled = Boolean(isDisabled);
        if (cfg.disabled) {
          groupEl.setAttribute('data-disabled', '');
        } else {
          groupEl.removeAttribute('data-disabled');
        }
        chips.forEach(c => {
          c.el.disabled = cfg.disabled || Boolean(c.item.disabled);
        });
      },
      destroy() {
        if (rafId) cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        groupEl.remove();
      }
    };
  }

  // Expose global API
  window.JellyRadio = {
    create: createJellyRadio
  };
})();
