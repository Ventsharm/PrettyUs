const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../apps-script/Code.gs'), 'utf8');
function receiver(options = {}) {
  const state = { ORDER_RECEIVER_ENABLED: 'true' }, rows = [];
  const properties = {
    getProperty: k => state[k] || null,
    setProperty(k,v) { state[k] = v; },
    setProperties(values) { if (options.receiptFailure) throw Error('private error'); Object.assign(state, values); },
    getProperties: () => ({ ...state }), deleteProperty: k => delete state[k]
  };
  const sheet = {
    getRange(row, column, height, width) {
      assert.equal(column,1); assert.equal(height,1); assert.equal(width,6);
      return { getDisplayValues: () => [options.headers || ['Full name ', 'Email','Street','Town','Post code ','Avon items']],
        setValues(values) { if (options.writeFailure) throw Error('private error'); rows.push(...values); } };
    }, getLastRow: () => rows.length + 1,
    appendRow(values) { if(options.writeFailure) throw Error('private error'); rows.push(values); }
  };
  const c = {
    console: { log() {}, error() {} },
    PropertiesService: { getScriptProperties: () => properties },
    LockService: { getScriptLock: () => ({ tryLock: () => !options.busy, releaseLock() {} }) },
    SpreadsheetApp: { openById(id) { assert.equal(id,'1aCU18Hzss3D1j08WII0AJwsi5IKopz59skx8Un4dltc');
      return { getSheetByName(name) { assert.equal(name,'Sheet1'); return sheet; } }; }, flush() {} },
    Utilities: { formatDate: (d, zone) => zone === 'UTC' ? d.toISOString().slice(0,10) :
      new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(d),
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()], DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 } },
    HtmlService: { createHtmlOutput: html => ({ html, setXFrameOptionsMode() { return this; } }), XFrameOptionsMode:{ ALLOWALL: 1 } },
    ContentService: { createTextOutput: text => ({ text, setMimeType() { return this; } }), MimeType: { JSON:1 } }
  };
  vm.createContext(c);vm.runInContext(source,c);
  return { c, rows, state };
}
function order(overrides = {}) {
  return { parameter: { FullName:'TEST ONLY', Email:'prettyus-test@example.invalid', Street:'TEST STREET', Town:'Hailsham',
    Postcode:'BN27 1AA', AvonItems:'TEST ONLY — NO ORDER', website:'', requestId:'a'.repeat(32),
    returnOrigin:'https://www.prettyus.co.uk', ...overrides }, postData:{ length:300 } };
}
test('owner readiness checks preserve existing sheet and whitespace in headings', () => {
  const r=receiver();r.c.verifyOrderSheet();assert.equal(r.rows.length,0);assert.equal(r.state.ORDER_RECEIVER_ENABLED,'true');
});
test('acknowledges only a completed write, preserves column order and deduplicates retries', () => {
  const r=receiver();const input=order();assert.match(r.c.doPost(input).html,/"status":"saved"/);
  assert.deepEqual(Array.from(r.rows[0]),['TEST ONLY','prettyus-test@example.invalid','TEST STREET','Hailsham','BN27 1AA','TEST ONLY — NO ORDER']);
  assert.match(r.c.doPost(input).html,/"status":"saved"/);assert.equal(r.rows.length,1);
  assert.match(r.c.doPost(order({AvonItems:'different'})).html,/"status":"rejected"/);assert.equal(r.rows.length,1);
});
test('server rejects invalid, oversized, automated and non-local submissions before writing', () => {
  for(const invalid of [{Email:'bad'},{Town:'London'},{Postcode:'invalid'},{website:'spam'},{FullName:'x'.repeat(121)},
    {returnOrigin:'https://evil.example'},{requestId:'invalid'},{AvonItems:'\x00bad'}]) {
    const r=receiver();assert.match(r.c.doPost(order(invalid)).html,/"status":"rejected"/);assert.equal(r.rows.length,0);
  }
  const r=receiver(),input=order();input.postData.length=16001;assert.match(r.c.doPost(input).html,/"status":"rejected"/);assert.equal(r.rows.length,0);
});
test('write or receipt failure never produces a saved acknowledgement or duplicate retry', () => {
  for(const options of [{writeFailure:true},{receiptFailure:true}]) {
    const r=receiver(options);assert.match(r.c.doPost(order()).html,/"status":"unknown"/);
    const count=r.rows.length;assert.match(r.c.doPost(order()).html,/"status":"unknown"/);assert.equal(r.rows.length,count);
  }
});
test('formula-like input is stored as literal text', () => {
  const r=receiver();r.c.doPost(order({FullName:'=IMPORTXML("https://invalid.example","x")',AvonItems:'+SUM(1,2)'}));
  assert.equal(r.rows[0][0][0],"'");assert.equal(r.rows[0][5][0],"'");
});
test('lock, schema and disabled-receiver failures do not write customer rows', () => {
  for(const options of [{busy:true},{headers:['wrong','Email','Street','Town','Post code','Avon items']}]) {
    const r=receiver(options);assert.match(r.c.doPost(order()).html,/"status":"rejected"/);assert.equal(r.rows.length,0);
  }
  const r=receiver();r.state.ORDER_RECEIVER_ENABLED='false';assert.match(r.c.doPost(order()).html,/"status":"rejected"/);assert.equal(r.rows.length,0);
});
test('per-email abuse limit rejects excess orders and keeps small bounded properties', () => {
  const r=receiver();
  for(let i=0;i<6;i++) {
    const result=r.c.doPost(order({requestId:String(i).padStart(32,'0')}));
    assert.match(result.html, i<5 ? /"status":"saved"/ : /"status":"rejected"/);
  }
  assert.equal(r.rows.length,5);assert.ok(Object.values(r.state).every(value=>value.length<9000));
});
