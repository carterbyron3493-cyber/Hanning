/* Hanning 2026 — main.js
 * Countdown to June 16, 2026 primary · nav toggle · form handling
 */

(() => {
  'use strict';

  // ---- Mobile nav toggle ----
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', links.classList.contains('is-open'));
    });
  }

  // ---- Countdown ----
  // Primary: Tuesday, June 16, 2026. Polls open 7am CDT.
  const TARGET = new Date('2026-06-16T07:00:00-05:00').getTime();
  const labels = { d: 'Days', h: 'Hrs', m: 'Min', s: 'Sec' };

  function renderCountdown(rootEl) {
    const now = Date.now();
    const diff = TARGET - now;

    if (diff <= 0) {
      rootEl.classList.add('is-past');
      rootEl.innerHTML = `
        <div class="countdown-label">
          <span>PRIMARY DAY</span>
          <strong>Vote today — June 16</strong>
        </div>`;
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    rootEl.innerHTML = `
      <div class="countdown-label">
        <span>COUNTDOWN</span>
        <strong>Primary: June 16</strong>
      </div>
      <div class="countdown-values" role="timer" aria-live="polite" aria-atomic="true">
        <div><span class="num">${days}</span><span class="unit">${labels.d}</span></div>
        <div><span class="num">${String(hours).padStart(2,'0')}</span><span class="unit">${labels.h}</span></div>
        <div><span class="num">${String(minutes).padStart(2,'0')}</span><span class="unit">${labels.m}</span></div>
        <div><span class="num">${String(seconds).padStart(2,'0')}</span><span class="unit">${labels.s}</span></div>
      </div>`;
  }

  const countdownEl = document.querySelector('.countdown');
  if (countdownEl) {
    renderCountdown(countdownEl);
    setInterval(() => renderCountdown(countdownEl), 1000);
  }

  // ---- Form handling (AJAX → Netlify Functions) ----
  document.querySelectorAll('form[data-endpoint]').forEach((form) => {
    const statusEl = form.querySelector('.form-status');
    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Honeypot (spam bot trap)
      const hp = form.querySelector('input[name="website"]');
      if (hp && hp.value) return; // silent drop

      const endpoint = form.dataset.endpoint;
      const formData = new FormData(form);
      const payload = {};
      const interests = [];
      formData.forEach((v, k) => {
        if (k === 'interests') { interests.push(v); return; }
        if (k === 'website') return;
        payload[k] = v;
      });
      if (interests.length) payload.interests = interests;

      if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset._label = submitBtn.textContent; submitBtn.textContent = 'Sending…'; }
      if (statusEl) { statusEl.className = 'form-status'; statusEl.textContent = ''; }

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        if (statusEl) {
          statusEl.className = 'form-status is-success';
          statusEl.textContent = form.dataset.success || 'Thanks — we\'ll be in touch shortly.';
        }
        form.reset();
      } catch (err) {
        if (statusEl) {
          statusEl.className = 'form-status is-error';
          statusEl.textContent = 'Something went wrong. Please try again or email info@hanningforwagonercountycommissioner.com.';
        }
        console.error('Form submit failed:', err);
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitBtn.dataset._label || 'Submit'; }
      }
    });
  });

  // ---- Mark active nav link ----
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href').replace(/\/$/, '') || '/';
    if (href === path || (path === '/' && (href === '/' || href === '/index.html'))) {
      a.classList.add('active');
    }
  });
})();
