/***************************************************
 * Google Sheet CRUD Web API (Multi-Sheet Version)
 *
 * This is the deployed script, kept in the repository so the database layer is
 * versioned alongside the front-end. Deploy as a Web app ("Execute as: Me",
 * "Who has access: Anyone") and put the /exec URL into API_URL in ../app.js.
 *
 * Reads are public — index.html needs them. Writes require `token`, the
 * SHA-256 hash of PASSWORD_PREFIX + the admin password, computed in the browser
 * by admin.js so the password itself is never transmitted or logged. Run
 * setAdminPassword() once from the editor to store the matching hash.
 ***************************************************/

// Script Property holding the SHA-256 hash of PASSWORD_PREFIX + the password.
const ADMIN_HASH_PROPERTY = 'ADMIN_TOKEN_HASH';

// Mixed into the password before hashing, so a leaked hash cannot be looked up
// in a generic rainbow table. Must match PASSWORD_PREFIX in ../admin.js.
const PASSWORD_PREFIX = 'seohye-typo:';

// Request parameters that carry routing information rather than cell values.
const RESERVED_PARAMS = ['action', 'sheet', '_row', 'token', 'callback'];

/* -------------------- Entry Points -------------------- */
function doGet(e) {
  try {
    const action = e.parameter.action;
    const sheetName = e.parameter.sheet || 'sheet3'; // Default to sheet1
    if (action === 'read') return readData(sheetName);
    if (action === 'auth') return authCheck(e.parameter.token);
    if (action === 'diag') return diagnostics();
    return errorResponse("Invalid GET action");
  } catch (err) {
    return errorResponse(err);
  }
}

function doPost(e) {
  try {
    const action = e.parameter.action;
    const body = e.parameter || {};
    const sheetName = body.sheet || 'sheet3'; // Default to sheet1

    if (action === 'auth') return authCheck(body.token);

    // Everything below this line writes to the spreadsheet.
    if (!isAuthorized(body.token)) return authErrorResponse(body.token);

    // Serialised so that two concurrent writes cannot shift row numbers
    // underneath one another.
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);
    } catch (err) {
      return errorResponse("Server busy, please retry.");
    }

    try {
      if (action === 'create') return createData(body, sheetName);
      if (action === 'update') return updateData(body, sheetName);
      if (action === 'delete') return deleteData(body, sheetName);
      return errorResponse("Invalid POST action");
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return errorResponse(err);
  }
}

/* -------------------- Admin password -------------------- */

/**
 * Sets the admin password. Type it between the quotes on the line below, run
 * this function ONCE from the editor, then empty the quotes again and save so
 * the password is not left in the source. It is never stored — only its hash.
 *
 * There is deliberately only one place to edit: an earlier version compared
 * against a placeholder spelled out twice, and replacing both — the obvious
 * reading of "change this" — made the guard match the new password and abort.
 */
function setAdminPassword() {
  const password = '';

  if (!password) {
    throw new Error("Type the password between the quotes in setAdminPassword(), then run it again.");
  }

  const hash = sha256Hex(PASSWORD_PREFIX + password);
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(ADMIN_HASH_PROPERTY, hash);

  // Read it back and fail loudly if it did not stick. Both outcomes are then
  // visible in the execution list itself -- a run that ends without an error
  // really has stored the password -- so nothing depends on finding a log line.
  if (properties.getProperty(ADMIN_HASH_PROPERTY) !== hash) {
    throw new Error("The hash was not stored. Check that the script can write its properties.");
  }

  Logger.log("Admin password set. Now empty the quotes in setAdminPassword() and save.");
}

/**
 * What the DEPLOYED web app sees: ?action=diag. Answers the one question the
 * editor cannot — whether the running deployment reads the same script
 * properties the editor writes. If hasAdminHash is false here while
 * showAdminDiagnostics() reports true, the URL is serving a different script
 * project, and the scriptId values will differ.
 *
 * Reveals no password, no hash and no spreadsheet. Safe to leave in place;
 * remove the 'diag' line in doGet() if you would rather it not be public.
 */
function diagnostics() {
  const properties = PropertiesService.getScriptProperties();

  return successResponse({
    scriptId: ScriptApp.getScriptId(),
    hasAdminHash: !!properties.getProperty(ADMIN_HASH_PROPERTY),
    propertyKeys: properties.getKeys(),
    sheetTabs: SpreadsheetApp.getActive().getSheets().map(s => s.getName())
  });
}

/**
 * The same facts from the editor's side. It throws on purpose: the message
 * then appears in the execution list, which stays readable even when log
 * output does not show.
 */
function showAdminDiagnostics() {
  const properties = PropertiesService.getScriptProperties();

  throw new Error(
    "scriptId=" + ScriptApp.getScriptId() +
    " | hasAdminHash=" + !!properties.getProperty(ADMIN_HASH_PROPERTY) +
    " | keys=[" + properties.getKeys().join(", ") + "]" +
    " | tabs=[" + SpreadsheetApp.getActive().getSheets().map(s => s.getName()).join(", ") + "]");
}

/**
 * Run this to check whether a password is set, without revealing it. It throws
 * when none is, so the answer shows in the execution list as failed or
 * completed even if the log output is not visible.
 */
function checkAdminPassword() {
  const hash = PropertiesService.getScriptProperties().getProperty(ADMIN_HASH_PROPERTY);

  if (!hash) {
    throw new Error("Admin password is NOT configured. Run setAdminPassword().");
  }

  Logger.log("Admin password IS configured (hash ends in " + hash.slice(-6) + ").");
}

/** Confirms a token without writing anything — admin.js's login screen. */
function authCheck(token) {
  return isAuthorized(token) ? successResponse("Authorized") : authErrorResponse(token);
}

function isAuthorized(token) {
  const expected = PropertiesService.getScriptProperties().getProperty(ADMIN_HASH_PROPERTY);
  if (!expected) return false;
  return constantTimeEquals(String(token || ''), expected);
}

function authErrorResponse(token) {
  const configured = PropertiesService.getScriptProperties().getProperty(ADMIN_HASH_PROPERTY);

  if (!configured) {
    return codedErrorResponse('not_configured',
      "Admin password is not configured. Run setAdminPassword() once in the Apps Script editor.");
  }

  // Slow down guessing. A failure counter would be a way to lock the owner out,
  // so this stays a delay rather than a lockout.
  if (token) Utilities.sleep(500);

  return codedErrorResponse('unauthorized', "Wrong password.");
}

function sha256Hex(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);

  return bytes.map(b => ((b & 0xff) + 0x100).toString(16).slice(1)).join('');
}

/** Compares in time that does not depend on where the first difference falls. */
function constantTimeEquals(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* -------------------- Utility -------------------- */
/**
 * The tabs are named Sheet3 and Sheet4; the client asks for sheet3 and sheet4.
 * getSheetByName() is case-sensitive, so the lookup falls back to a
 * case-insensitive scan rather than to a hand-written list of spellings.
 */
function getSheet(name) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  const wanted = String(name).toLowerCase();
  const match = ss.getSheets().filter(s => s.getName().toLowerCase() === wanted)[0];

  if (!match) throw new Error("Sheet not found: " + name);
  return match;
}

function successResponse(data) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: "success", data }, null, 2)
  ).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(err) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: "error", message: String(err) }, null, 2)
  ).setMimeType(ContentService.MimeType.JSON);
}

/** An error the client branches on rather than only shows. */
function codedErrorResponse(code, message) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: "error", code, message }, null, 2)
  ).setMimeType(ContentService.MimeType.JSON);
}

/** Header names are matched case-insensitively, mirroring the client. */
function valueFor(body, header) {
  const key = String(header).trim();
  if (!key || RESERVED_PARAMS.indexOf(key.toLowerCase()) !== -1) return undefined;
  if (key in body) return body[key];

  const wanted = key.toLowerCase();
  for (const name in body) {
    if (RESERVED_PARAMS.indexOf(name.toLowerCase()) !== -1) continue;
    if (name.toLowerCase() === wanted) return body[name];
  }
  return undefined;
}

function isBlankRow(row) {
  return row.every(cell => cell === '' || cell === null || cell === undefined);
}

/**
 * Dates come back as yyyy-MM-dd so that a year cell accidentally stored as a
 * date still yields the right number through the client's parseInt().
 */
function normalizeCell(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return value;
}

/* -------------------- CRUD Functions (Updated) -------------------- */
function readData(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 1 || lastCol < 1) {
    return successResponse({ headers: [], rows: [], rowNumbers: [] });
  }

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
    : [];

  // rowNumbers[i] is the real sheet row of rows[i]. The client used to infer it
  // from the array index, which pointed at the wrong record for everything
  // below a blank row — so blank rows are dropped and the true row reported.
  const rows = [];
  const rowNumbers = [];
  values.forEach((row, i) => {
    if (isBlankRow(row)) return;
    rows.push(row.map(normalizeCell));
    rowNumbers.push(i + 2);
  });

  return successResponse({ headers, rows, rowNumbers });
}

function createData(body, sheetName) {
  const sheet = getSheet(sheetName);
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  const newRow = headers.map(h => {
    const value = valueFor(body, h);
    return value === undefined ? "" : value;
  });

  sheet.appendRow(newRow);
  return successResponse("Row added to " + sheetName);
}

function updateData(body, sheetName) {
  const sheet = getSheet(sheetName);
  if (!body._row) return errorResponse("Missing _row");

  const rowNum = Number(body._row);
  if (rowNum < 2) return errorResponse("Row number invalid");
  if (rowNum > sheet.getLastRow()) return errorResponse("Row number past end of " + sheetName);

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // Partial update: only the columns actually supplied are touched, so a
  // layer-only drag does not blank the rest of the record.
  headers.forEach((h, i) => {
    const value = valueFor(body, h);
    if (value === undefined) return;
    sheet.getRange(rowNum, i + 1).setValue(value);
  });

  return successResponse("Row updated in " + sheetName);
}

function deleteData(body, sheetName) {
  const sheet = getSheet(sheetName);
  if (!body._row) return errorResponse("Missing _row");

  const rowNum = Number(body._row);
  if (rowNum < 2) return errorResponse("Row number invalid");
  if (rowNum > sheet.getLastRow()) return errorResponse("Row number past end of " + sheetName);

  sheet.deleteRow(rowNum);
  return successResponse("Row deleted from " + sheetName);
}
