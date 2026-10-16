(function () {
  'use strict';
  var form = document.getElementById('avonForm');
  var status = document.getElementById('orderStatus');
  var button = document.getElementById('submitBtn');
  var requestId = null, pending = false, finished = false, timeout;
  var limits = { FullName: 120, Email: 254, Street: 240, Town: 100, Postcode: 12, AvonItems: 4000 };
  Object.keys(limits).forEach(function (name) { form.elements[name].maxLength = limits[name]; });
  function unknown() {
    status.textContent = 'We could not confirm whether your order was saved. Please contact PrettyUs before submitting again.';
    button.textContent = 'Please contact PrettyUs';
    // Never retry an ambiguous write automatically; keep the entered details visible.
  }
  form.addEventListener('submit', function (event) {
    if (pending || finished) { event.preventDefault(); return; }
    var fields = form.querySelectorAll('input[required],textarea[required]');
    for (var i = 0; i < fields.length; i++) {
      if (!fields[i].value.trim() || !fields[i].checkValidity()) {
        event.preventDefault();
        status.textContent = 'Please fill in all fields correctly before submitting.';
        fields[i].focus(); return;
      }
    }
    if (form.elements.website.value) {
      event.preventDefault(); status.textContent = 'Unable to submit this form. Please contact PrettyUs.'; return;
    }
    if (!window.crypto || !window.crypto.getRandomValues) {
      event.preventDefault(); status.textContent = 'Your browser cannot securely submit this form. Please contact PrettyUs.'; return;
    }
    requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
    form.elements.requestId.value = requestId;
    form.elements.returnOrigin.value = window.location.origin;
    pending = true; button.disabled = true;
    button.textContent = 'Sending…'; status.textContent = 'Sending your order…';
    timeout = setTimeout(unknown, 30000);
    // Normal URL-encoded form POST into the iframe avoids a CORS preflight.
    // An iframe load is not proof of a saved order and deliberately does nothing.
  });
  window.addEventListener('message', function (event) {
    var trustedOrigin = event.origin === 'https://script.google.com' ||
      event.origin === 'https://script.googleusercontent.com' ||
      /^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/.test(event.origin);
    var data = event.data;
    // HtmlService uses a nested sandbox frame, so its source window differs from
    // the outer iframe. Validate Google's origin and an unpredictable per-submit ID.
    if (!trustedOrigin || !pending || finished || !data ||
        data.type !== 'prettyus-avon-order-v1' || data.requestId !== requestId) return;
    if (!['saved', 'rejected', 'unknown'].includes(data.status)) return;
    clearTimeout(timeout);
    if (data.status === 'saved') {
      finished = true;
      status.textContent = 'Thank you—your order has been saved. PrettyUs will contact you.';
      button.textContent = 'Order received';
    } else if (data.status === 'rejected') {
      pending = false; button.disabled = false; button.textContent = 'Submit';
      status.textContent = data.reason === 'busy' ?
        'The order service is busy. Please wait a moment and try again.' :
        'Your order was not saved. Please check your details or contact PrettyUs.';
    } else unknown();
  });
})();
