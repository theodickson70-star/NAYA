// PayPoint: maboresho madogo ya fomu (mfumo unafanya kazi hata bila JavaScript)
(function () {
  'use strict';
  var fmt = function (v) {
    var d = String(v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return d ? Number(d).toLocaleString('en-US') : '';
  };

  // Kiasi: weka koma unapoandika (1,250,000)
  document.querySelectorAll('input[data-money]').forEach(function (el) {
    if (el.value) el.value = fmt(el.value);
    el.addEventListener('input', function () {
      var end = el.value.length - el.selectionStart;
      el.value = fmt(el.value);
      var pos = Math.max(0, el.value.length - end);
      try { el.setSelectionRange(pos, pos); } catch (e) {}
    });
  });

  // Vitufe vya kiasi cha haraka
  document.querySelectorAll('[data-quick] [data-amount]').forEach(function (b) {
    b.addEventListener('click', function () {
      var input = b.closest('form').querySelector('input[name="kiasi"]');
      input.value = fmt(b.getAttribute('data-amount'));
      input.focus();
    });
  });

  // Tafuta mteja kwa namba ya simu
  document.querySelectorAll('form[data-txform]').forEach(function (form) {
    var phone = form.querySelector('input[name="simu"]');
    var name = form.querySelector('input[name="jina"]');
    var out = form.querySelector('[data-lookup]');
    var last = '';
    phone.addEventListener('input', function () {
      var d = phone.value.replace(/\D/g, '');
      if (d.length < 10) { out.textContent = ''; last = ''; return; }
      if (d === last) return;
      last = d;
      fetch('/api/mteja?simu=' + encodeURIComponent(d), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || last !== d) return;
          if (j.mteja) {
            out.textContent = 'Mteja yupo kwenye daftari' + (j.mteja.jina ? ': ' + j.mteja.jina : '');
            if (j.mteja.jina && !name.value.trim()) name.value = j.mteja.jina;
          } else {
            out.textContent = 'Mteja mpya — atasajiliwa yenyewe';
          }
        })
        .catch(function () {});
    });
  });

  // Thibitisha kabla ya kitendo muhimu
  document.querySelectorAll('[data-confirm]').forEach(function (el) {
    var form = el.tagName === 'FORM' ? el : el.closest('form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      if (!window.confirm(el.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Zuia kubonyeza mara mbili (muamala usirudiwe)
  document.querySelectorAll('form[method="post"]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;
      if (form.dataset.sent) { e.preventDefault(); return; }
      form.dataset.sent = '1';
      form.querySelectorAll('button[type="submit"]').forEach(function (b) { b.disabled = true; });
      setTimeout(function () { delete form.dataset.sent; form.querySelectorAll('button[type="submit"]').forEach(function (b) { b.disabled = false; }); }, 8000);
    });
  });

  // Chagua → onyesha papo hapo
  document.querySelectorAll('select[data-autosubmit]').forEach(function (s) {
    s.addEventListener('change', function () { s.form.submit(); });
  });

  // Float: mtandao unahitajika kwa vitendo vya float tu
  document.querySelectorAll('form[data-movement]').forEach(function (form) {
    var aina = form.querySelector('select[name="aina"]');
    var net = form.querySelector('[data-net-field]');
    var sync = function () { net.hidden = ['cash_ingia', 'cash_toka', 'matumizi'].indexOf(aina.value) >= 0; };
    aina.addEventListener('change', sync);
    sync();
  });

  document.querySelectorAll('[data-print]').forEach(function (b) {
    b.addEventListener('click', function () { window.print(); });
  });
})();
