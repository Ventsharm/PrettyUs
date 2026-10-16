/** PrettyUs order receiver. No credentials or customer data belong in this source. */
const AVON = Object.freeze({
  spreadsheetId: '1aCU18Hzss3D1j08WII0AJwsi5IKopz59skx8Un4dltc',
  tab: 'Sheet1',
  origins: ['https://www.prettyus.co.uk', 'https://prettyus.co.uk'],
  headers: ['Full name', 'Email', 'Street', 'Town', 'Post code', 'Avon items'],
  limits: { FullName: 120, Email: 254, Street: 240, Town: 100, Postcode: 12, AvonItems: 4000 },
  maxDailyOrders: 120,
  maxDailyEmailOrders: 5,
  notificationEmail: 'pfay970@gmail.com',
  protocol: 'prettyus-avon-order-v1'
});

// Run once as the owner: grants Sheets permission and checks the existing headers.
// No row is added, removed or changed. Keep this first for mobile users.
function verifyOrderSheet() {
  orderSheet_();
  // Requests Google's separate send-email permission without sending an email.
  MailApp.getRemainingDailyQuota();
  PropertiesService.getScriptProperties().setProperty('ORDER_RECEIVER_ENABLED', 'true');
  console.log('Existing Sheet1 and six headings verified. Receiver enabled. No order submitted.');
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    service: AVON.protocol,
    status: PropertiesService.getScriptProperties().getProperty('ORDER_RECEIVER_ENABLED') === 'true' ? 'ready' : 'owner_setup_required'
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(event) {
  const params = event && event.parameter || {};
  const origin = AVON.origins.includes(params.returnOrigin) ? params.returnOrigin : AVON.origins[0];
  const requestId = /^[a-f0-9]{32}$/.test(params.requestId || '') ? params.requestId : '';
  const respond = (status, reason) => acknowledgement_({ type: AVON.protocol, requestId, status, reason: reason || '' }, origin);
  // Public forms cannot keep a browser-side secret. These are abuse controls,
  // not authentication: origin field, honeypot, payload limits and bounded rates.
  if (!requestId || !AVON.origins.includes(params.returnOrigin) || params.website ||
      !event || !event.postData || event.postData.length > 16000) return respond('rejected');
  const values = validateOrder_(params);
  if (!values) return respond('rejected');
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ORDER_RECEIVER_ENABLED') !== 'true') return respond('rejected');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return respond('rejected', 'busy');
  let writeStarted = false;
  try {
    const now = Date.now();
    const day = Utilities.formatDate(new Date(now), 'Europe/London', 'yyyy-MM-dd');
    // Separate small properties avoid the 9KB/value limit. Only two days retained;
    // values contain hashes, random request IDs and counters, never customer data.
    const previous = Utilities.formatDate(new Date(Date.parse(day + 'T12:00:00Z') - 86400000), 'UTC', 'yyyy-MM-dd');
    const receiptKey = 'AVON_' + day + '_receipt_' + requestId;
    const priorReceipt = props.getProperty(receiptKey) || props.getProperty('AVON_' + previous + '_receipt_' + requestId);
    const fingerprint = digest_(JSON.stringify(values));
    if (priorReceipt) return respond(priorReceipt === fingerprint ? 'saved' : priorReceipt === 'pending:' + fingerprint ? 'unknown' : 'rejected');
    const emailHash = digest_(values[1].toLowerCase());
    const countKey = 'AVON_' + day + '_count';
    const emailKey = 'AVON_' + day + '_email_' + emailHash;
    const count = Number(props.getProperty(countKey) || 0);
    const emailCount = Number(props.getProperty(emailKey) || 0);
    if (count >= AVON.maxDailyOrders || emailCount >= AVON.maxDailyEmailOrders) {
      return respond('rejected', 'busy');
    }
    if (props.getProperty('AVON_CLEANED_DAY') !== day) {
      Object.keys(props.getProperties()).filter(k => /^AVON_\d{4}-\d{2}-\d{2}_/.test(k) &&
        !k.startsWith('AVON_' + day + '_') && !k.startsWith('AVON_' + previous + '_'))
        .forEach(k => props.deleteProperty(k));
      props.setProperty('AVON_CLEANED_DAY', day);
    }
    const sheet = orderSheet_();
    // Prevent Sheets formula injection in all customer-controlled cells.
    const safeValues = values.map(value => /^[=+\-@]/.test(value) ? "'" + value : value);
    // Reserve the random request ID before writing. If a write's outcome becomes
    // ambiguous, the same request cannot append another row on a network retry.
    props.setProperty(receiptKey, 'pending:' + fingerprint);
    writeStarted = true;
    // appendRow also grows a full sheet, without replacing any existing row.
    sheet.appendRow(safeValues);
    SpreadsheetApp.flush();
    // A success acknowledgement is emitted only after the row write completes.
    props.setProperties({ [receiptKey]: fingerprint, [countKey]: String(count + 1), [emailKey]: String(emailCount + 1) });
    notifyOrderOwner_(values);
    return respond('saved');
  } catch (error) {
    // Don't log customer data or raw exception text. A write may have succeeded
    // even if its response/receipt failed; never invite an automatic retry then.
    console.error('Order processing failed at ' + (writeStarted ? 'write_or_receipt' : 'pre_write') + '.');
    return respond(writeStarted ? 'unknown' : 'rejected');
  } finally {
    lock.releaseLock();
  }
}

function notifyOrderOwner_(values) {
  // Saving the order is authoritative. Email is best effort and never retried
  // by a duplicate POST, so email errors cannot cause duplicate order rows.
  try {
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Mail quota unavailable');
    MailApp.sendEmail({
      to: AVON.notificationEmail,
      subject: 'PrettyUs: new Avon order saved',
      name: 'PrettyUs',
      body: 'A new Avon order has been saved in Sheet1.\n\n' +
        AVON.headers.map((heading, i) => heading + ': ' + values[i]).join('\n\n') +
        '\n\nView orders: https://docs.google.com/spreadsheets/d/' + AVON.spreadsheetId + '/edit'
    });
  } catch (error) {
    console.error('Order saved, but owner email notification failed. Check MailApp authorisation and daily quota.');
  }
}

function validateOrder_(params) {
  const values = [];
  for (const name of Object.keys(AVON.limits)) {
    if (typeof params[name] !== 'string') return null;
    const value = params[name].trim();
    if (!value || value.length > AVON.limits[name] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
    values.push(value);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[1])) return null;
  if (!/^(hailsham|hellingly)$/i.test(values[3])) return null;
  if (!/^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.test(values[4])) return null;
  values[4] = values[4].toUpperCase();
  return values;
}

function orderSheet_() {
  const sheet = SpreadsheetApp.openById(AVON.spreadsheetId).getSheetByName(AVON.tab);
  if (!sheet) throw new Error('Required sheet unavailable');
  const headings = sheet.getRange(1, 1, 1, 6).getDisplayValues()[0].map(x => String(x).trim());
  if (headings.some((h, i) => h !== AVON.headers[i])) throw new Error('Existing headings do not match');
  return sheet;
}

function digest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(b => (b + 256).toString(16).slice(-2)).join('');
}

function acknowledgement_(payload, origin) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const html = '<!doctype html><meta charset="utf-8"><title>PrettyUs order status</title>' +
    '<p>' + (payload.status === 'saved' ? 'Order saved.' : payload.status === 'rejected' ? 'Order not saved.' : 'Order status unconfirmed. Please contact PrettyUs.') + '</p>' +
    '<script>window.top.postMessage(' + json + ',' + JSON.stringify(origin) + ');</script>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
