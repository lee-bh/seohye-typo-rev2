/**
 * East Asian Typography Timeline — Google Apps Script backend
 *
 * Acts as the database layer for the timeline front-end (../app.js).
 * Deploy as a Web app ("Execute as: Me", "Who has access: Anyone") and put the
 * resulting /exec URL into API_URL at the top of app.js.
 *
 * Endpoints (both GET and POST are accepted; POST bodies must be
 * application/x-www-form-urlencoded so that e.parameter is populated):
 *
 *   ?action=read&sheet=sheet3
 *     -> { status, data: { headers: [...], rows: [[...]], rowNumbers: [...] } }
 *
 *   ?action=create&sheet=sheet4&country=...&begin=...   (values as parameters)
 *     -> { status, _row }
 *
 *   ?action=update&sheet=sheet4&_row=12&layer=3
 *     -> { status, _row }   (only the columns present in the request are written)
 *
 *   ?action=delete&sheet=sheet3&_row=12
 *     -> { status, _row }
 *
 *   ?action=auth&token=<hash>
 *     -> { status }          (used by admin.html's login screen)
 *
 * Every response is JSON with a `status` of 'success' or 'error'.
 *
 * Reads are public; create, update and delete require `token`. The token is a
 * SHA-256 hash of the admin password, computed in the browser so the password
 * itself is never transmitted or written to the execution log. Run
 * setAdminPassword() once from the editor to store the matching hash.
 *
 * This is one shared password, not per-user accounts: anyone who knows it can
 * write, and anyone holding the hash can write without knowing the password.
 * It is a real server-side gate -- a check in the page's own JavaScript would
 * not be, since the endpoint is reachable directly -- but it is not an identity
 * system, so rotate the password when someone should no longer have access.
 */

// Columns used when a sheet has to be created from scratch. Existing sheets
// always keep whatever header row they already have.
var DEFAULT_HEADERS = {
    sheet3: ['nation', 'category', 'yr', 'item', 'info', 'link', 'cite'],
    sheet4: ['country', 'theme', 'begin', 'end', 'layer', 'title']
};

var DEFAULT_SHEET = 'sheet3';

// Script Property holding the SHA-256 hash of PASSWORD_PREFIX + the password.
var ADMIN_HASH_PROPERTY = 'ADMIN_TOKEN_HASH';

// Mixed into the password before hashing, so a leaked hash cannot be looked up
// in a generic rainbow table. Must match PASSWORD_PREFIX in admin.js.
var PASSWORD_PREFIX = 'seohye-typo:';

// Parameters that carry routing information rather than cell values.
var RESERVED_PARAMS = { action: true, sheet: true, _row: true, callback: true, token: true };

function doGet(e) {
    return handleRequest(e);
}

function doPost(e) {
    return handleRequest(e);
}

function handleRequest(e) {
    var params = flattenParams(e);
    var action = String(params.action || 'read').toLowerCase();

    // Reads are safe to run concurrently; writes are serialised so that row
    // numbers cannot shift underneath another request.
    if (action === 'read') {
        try {
            return jsonOut(readRows(params.sheet));
        } catch (err) {
            return jsonOut(errorOf(err));
        }
    }

    if (action === 'auth') {
        return jsonOut(isAuthorized(params.token)
            ? { status: 'success' }
            : authFailure(params.token));
    }

    // Everything below this line writes to the spreadsheet.
    if (!isAuthorized(params.token)) {
        return jsonOut(authFailure(params.token));
    }

    var lock = LockService.getScriptLock();
    try {
        lock.waitLock(20000);
    } catch (err) {
        return jsonOut({ status: 'error', message: 'Server busy, please retry.' });
    }

    try {
        switch (action) {
            case 'create':
                return jsonOut(createRow(params.sheet, params));
            case 'update':
                return jsonOut(updateRow(params.sheet, params));
            case 'delete':
                return jsonOut(deleteRow(params.sheet, params));
            default:
                return jsonOut({ status: 'error', message: 'Unknown action: ' + action });
        }
    } catch (err) {
        return jsonOut(errorOf(err));
    } finally {
        lock.releaseLock();
    }
}

/* ------------------------------------------------------------------- auth */

/**
 * Run this once from the Apps Script editor to set the admin password, then
 * clear the literal below and save again so it is not left in the source.
 * The password itself is never stored -- only its hash.
 */
function setAdminPassword() {
    var password = 'CHANGE-ME';

    if (!password || password === 'CHANGE-ME') {
        throw new Error('Edit the password in setAdminPassword() before running it.');
    }
    PropertiesService.getScriptProperties()
        .setProperty(ADMIN_HASH_PROPERTY, sha256Hex(PASSWORD_PREFIX + password));

    Logger.log('Admin password set. Clear the literal from setAdminPassword() now.');
}

function isAuthorized(token) {
    var expected = PropertiesService.getScriptProperties().getProperty(ADMIN_HASH_PROPERTY);
    if (!expected) return false;
    return constantTimeEquals(String(token || ''), expected);
}

function authFailure(token) {
    var configured = PropertiesService.getScriptProperties().getProperty(ADMIN_HASH_PROPERTY);
    if (!configured) {
        return {
            status: 'error',
            code: 'not_configured',
            message: 'Admin password is not configured. Run setAdminPassword() once in the Apps Script editor.'
        };
    }

    // Slow down guessing. A counter would be a way to lock the owner out, so
    // this stays a delay rather than a lockout.
    if (token) Utilities.sleep(500);

    return { status: 'error', code: 'unauthorized', message: 'Wrong password.' };
}

function sha256Hex(value) {
    var bytes = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);

    return bytes.map(function (b) {
        return ((b & 0xff) + 0x100).toString(16).slice(1);
    }).join('');
}

// Compares in time that does not depend on where the first difference falls.
function constantTimeEquals(a, b) {
    var diff = a.length ^ b.length;
    for (var i = 0; i < a.length && i < b.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

/* ---------------------------------------------------------------- actions */

function readRows(sheetName) {
    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow < 1 || lastCol < 1) {
        return { status: 'success', data: { headers: [], rows: [], rowNumbers: [] } };
    }

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = values[0].map(function (h) { return String(h).trim(); });

    var rows = [];
    var rowNumbers = [];
    for (var i = 1; i < values.length; i++) {
        if (isBlankRow(values[i])) continue;
        rows.push(values[i].map(normalizeCell));
        rowNumbers.push(i + 1); // real 1-based sheet row, blanks included
    }

    return { status: 'success', data: { headers: headers, rows: rows, rowNumbers: rowNumbers } };
}

function createRow(sheetName, params) {
    var sheet = getSheet(sheetName);
    var headers = getHeaders(sheet, sheetName);
    var row = headers.map(function (header) {
        var value = pickParam(params, header);
        return value === undefined ? '' : value;
    });

    sheet.appendRow(row);
    return { status: 'success', _row: sheet.getLastRow() };
}

function updateRow(sheetName, params) {
    var sheet = getSheet(sheetName);
    var headers = getHeaders(sheet, sheetName);
    var rowIndex = requireRowIndex(sheet, params);

    // Partial update: only the columns actually supplied are touched, so a
    // layer-only drag does not wipe the rest of the record.
    var written = 0;
    headers.forEach(function (header, col) {
        var value = pickParam(params, header);
        if (value === undefined) return;
        sheet.getRange(rowIndex, col + 1).setValue(value);
        written++;
    });

    if (written === 0) {
        return { status: 'error', message: 'No known columns supplied for update.' };
    }
    return { status: 'success', _row: rowIndex, updated: written };
}

function deleteRow(sheetName, params) {
    var sheet = getSheet(sheetName);
    var rowIndex = requireRowIndex(sheet, params);
    sheet.deleteRow(rowIndex);
    return { status: 'success', _row: rowIndex };
}

/* ---------------------------------------------------------------- helpers */

function getSheet(sheetName) {
    var name = String(sheetName || DEFAULT_SHEET).trim();
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    var sheet = ss.getSheetByName(name);
    if (sheet) return sheet;

    // Sheets are commonly named "Sheet3" while the client asks for "sheet3".
    var wanted = name.toLowerCase();
    var all = ss.getSheets();
    for (var i = 0; i < all.length; i++) {
        if (all[i].getName().toLowerCase() === wanted) return all[i];
    }

    var defaults = DEFAULT_HEADERS[wanted];
    if (!defaults) throw new Error('Unknown sheet: ' + name);

    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, defaults.length).setValues([defaults]);
    return sheet;
}

function getHeaders(sheet, sheetName) {
    var lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
        var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
            .map(function (h) { return String(h).trim(); });
        if (headers.some(function (h) { return h !== ''; })) return headers;
    }

    var defaults = DEFAULT_HEADERS[String(sheetName || DEFAULT_SHEET).toLowerCase()];
    if (!defaults) throw new Error('Sheet has no header row: ' + sheet.getName());

    sheet.getRange(1, 1, 1, defaults.length).setValues([defaults]);
    return defaults.slice();
}

// Header names are matched case-insensitively so that "Nation" and "nation"
// both resolve, mirroring the lowercasing the client does.
function pickParam(params, header) {
    var key = String(header).trim();
    if (!key || RESERVED_PARAMS[key.toLowerCase()]) return undefined;

    if (Object.prototype.hasOwnProperty.call(params, key)) return params[key];

    var wanted = key.toLowerCase();
    for (var name in params) {
        if (!Object.prototype.hasOwnProperty.call(params, name)) continue;
        if (RESERVED_PARAMS[name.toLowerCase()]) continue;
        if (name.toLowerCase() === wanted) return params[name];
    }
    return undefined;
}

function requireRowIndex(sheet, params) {
    var rowIndex = parseInt(params._row, 10);
    if (isNaN(rowIndex) || rowIndex < 2) {
        throw new Error('Invalid _row: ' + params._row);
    }
    if (rowIndex > sheet.getLastRow()) {
        throw new Error('Row ' + rowIndex + ' is past the end of ' + sheet.getName() + '.');
    }
    return rowIndex;
}

// Apps Script hands POST bodies back as e.parameter (urlencoded) and repeated
// keys as e.parameters; take the first value of each and keep query params.
function flattenParams(e) {
    var out = {};
    if (!e) return out;
    if (e.parameter) {
        for (var key in e.parameter) {
            if (Object.prototype.hasOwnProperty.call(e.parameter, key)) out[key] = e.parameter[key];
        }
    }
    return out;
}

// Dates are emitted as yyyy-MM-dd so that a year cell accidentally stored as a
// date still yields the right number through the client's parseInt().
function normalizeCell(value) {
    if (value instanceof Date) {
        return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return value;
}

function isBlankRow(row) {
    return row.every(function (cell) {
        return cell === '' || cell === null || cell === undefined;
    });
}

function errorOf(err) {
    return { status: 'error', message: String((err && err.message) || err) };
}

function jsonOut(payload) {
    return ContentService
        .createTextOutput(JSON.stringify(payload))
        .setMimeType(ContentService.MimeType.JSON);
}
