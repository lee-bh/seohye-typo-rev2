/**
 * Editing layer for admin.html. Loaded after app.js, which renders the timeline
 * and leaves every write to the hooks filled in at the bottom of this file.
 *
 * The password is checked by the Apps Script backend, not here: a check in this
 * file would be worth nothing, since anyone can read it and the endpoint is
 * reachable directly. What this file does is take the password, hash it, and
 * send that hash with every write for the server to accept or refuse. The
 * password itself never leaves the browser.
 */

// Mixed into the password before hashing so a leaked hash cannot be looked up
// in a generic rainbow table. Must match PASSWORD_PREFIX in apps-script/Code.gs.
const PASSWORD_PREFIX = 'seohye-typo:';

// DOM Elements (admin.html only)
const modalOverlay = document.getElementById('modal-overlay');
const itemForm = document.getElementById('item-form');
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

// In memory only. It was kept in sessionStorage so a reload would not ask
// again, but sessionStorage survives reloads and is copied into any tab opened
// from this one, so the page let people straight in without a password. The
// token now lives for exactly as long as the page does.
let adminToken = null;
let started = false;

/* ------------------------------------------------------------------- auth */

async function hashPassword(password) {
    if (!crypto.subtle) {
        throw new Error('このページは https でのみ利用できます。');
    }

    const data = new TextEncoder().encode(PASSWORD_PREFIX + password);
    const digest = await crypto.subtle.digest('SHA-256', data);

    return [...new Uint8Array(digest)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// Asks the backend whether this token is the configured one. Nothing is written
// and nothing is unlocked until it answers yes.
async function verifyToken(token) {
    const params = new URLSearchParams({ action: 'auth', token });
    return fetchJson(`${API_URL}?${params}`);
}

async function attemptLogin(password) {
    const token = await hashPassword(password);
    const result = await verifyToken(token);

    if (result.status !== 'success') {
        throw new Error(result.message || 'パスワードが違います。');
    }

    adminToken = token;
    start();
}

function start() {
    loginOverlay.classList.add('hidden');
    document.body.classList.add('unlocked');

    if (started) return;
    started = true;
    init(); // app.js: loads the sheets and draws the timeline
}

// Called when the server refuses a token we thought was good -- the password
// was changed while this tab was open.
function lock(message) {
    adminToken = null;

    document.body.classList.remove('unlocked');
    loginOverlay.classList.remove('hidden');
    showLoginError(message);
}

function showLoginError(message) {
    loginError.textContent = message || '';
    loginError.classList.toggle('hidden', !message);
}

function setupLogin() {
    loginForm.onsubmit = async (e) => {
        e.preventDefault();
        showLoginError('');

        const input = document.getElementById('login-password');
        const submit = document.getElementById('login-submit');
        submit.disabled = true;

        try {
            await attemptLogin(input.value);
            input.value = '';
        } catch (error) {
            console.error('Login failed:', error);
            showLoginError(error.message);
        } finally {
            submit.disabled = false;
        }
    };

    // Reloading drops the token with the page, which is the whole point.
    document.getElementById('logout-btn').onclick = () => location.reload();
}

/* ------------------------------------------------------------- form fields */

// admin.html ships one fixed vocabulary for nation and category, but the sheet
// is the source of truth for which values actually exist. Any value the sheet
// uses that the dropdown lacks is added, so opening and saving a record cannot
// silently rewrite it to whichever option happens to come first.
function syncSelectOptions() {
    addMissingOptions(document.getElementById('edit-nation'), state.items.map(i => i.nation));
    addMissingOptions(document.getElementById('edit-category'), state.items.map(i => i.category));
}

function addMissingOptions(select, values) {
    if (!select) return;

    const known = new Set(Array.from(select.options).map(o => o.value));
    const added = [];

    values.forEach(raw => {
        const value = textValue(raw).trim();
        if (!value || known.has(value)) return;

        known.add(value);
        added.push(value);

        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.dataset.fromSheet = 'true';
        select.appendChild(option);
    });

    if (added.length) {
        console.warn(`Added to #${select.id} from the sheet (not in the fixed list):`, added);
    }
}

// Never fall back to the first option: an unmatched value is added as its own
// option, and a genuinely empty one leaves the required select unselected so
// the form asks for a choice instead of inventing one.
function setSelectValue(select, value) {
    const wanted = textValue(value).trim();
    if (!wanted) {
        select.selectedIndex = -1;
        return;
    }
    addMissingOptions(select, [wanted]);
    select.value = wanted;
}

/* ----------------------------------------------------------- modal & form */

function openEditModal(item) {
    const modalTitle = document.getElementById('modal-title');
    const deleteBtn = document.getElementById('delete-btn');

    if (item) {
        modalTitle.textContent = '項目編集';
        document.getElementById('edit-row').value = item._row;
        setSelectValue(document.getElementById('edit-nation'), item.nation);
        setSelectValue(document.getElementById('edit-category'), item.category);
        document.getElementById('edit-yr').value = textValue(item.yr);
        document.getElementById('edit-item').value = textValue(item.item);
        document.getElementById('edit-info').value = textValue(item.info);
        document.getElementById('edit-link').value = textValue(item.link);
        document.getElementById('edit-cite').value = textValue(item.cite);
        deleteBtn.classList.remove('hidden');

        deleteBtn.onclick = () => deleteItem(item._row);
    } else {
        modalTitle.textContent = '項目追加';
        itemForm.reset();
        document.getElementById('edit-row').value = '';
        deleteBtn.classList.add('hidden');
    }

    modalOverlay.classList.remove('hidden');
}

function openSheet4Modal(item) {
    const modalOverlayS4 = document.getElementById('modal-overlay-s4');
    const modalTitleS4 = document.getElementById('modal-title-s4');
    const deleteBtnS4 = document.getElementById('delete-btn-s4');
    const formS4 = document.getElementById('item-form-s4');

    if (item) {
        modalTitleS4.textContent = '時代区分（編集）';
        document.getElementById('edit-row-s4').value = item._row;
        document.getElementById('edit-country-s4').value = textValue(item.country);
        document.getElementById('edit-theme-s4').value = textValue(item.theme);
        document.getElementById('edit-begin-s4').value = textValue(item.begin);
        document.getElementById('edit-end-s4').value = textValue(item.end);
        document.getElementById('edit-layer-s4').value = textValue(item.layer);
        document.getElementById('edit-title-s4').value = textValue(item.title);
        deleteBtnS4.classList.remove('hidden');

        deleteBtnS4.onclick = () => deleteItem(item._row, 'sheet4');
    } else {
        modalTitleS4.textContent = '時代区分（新規）';
        formS4.reset();
        document.getElementById('edit-row-s4').value = '';
        deleteBtnS4.classList.add('hidden');
    }

    modalOverlayS4.classList.remove('hidden');
}

// Saving used to hide the sheet3 overlay only, so a sheet4 period stayed on
// screen behind its own modal after it had already been written.
function closeModals() {
    ['modal-overlay', 'modal-overlay-s4', 'modal-overlay-about'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
}

function setupForm() {
    document.getElementById('close-modal').onclick = () => {
        modalOverlay.classList.add('hidden');
    };

    document.getElementById('close-modal-s4').onclick = () => {
        document.getElementById('modal-overlay-s4').classList.add('hidden');
    };

    // Overlay clicks (the about overlay is handled in app.js)
    window.addEventListener('click', (e) => {
        if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
        const s4Overlay = document.getElementById('modal-overlay-s4');
        if (e.target === s4Overlay) s4Overlay.classList.add('hidden');
    });

    document.getElementById('add-item-btn').onclick = () => openEditModal(null);
    document.getElementById('add-sheet4-btn').onclick = () => openSheet4Modal(null);
    document.getElementById('reload-btn').onclick = () => loadData();

    const submitHandler = (form) => async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        await sendData(data._row ? 'update' : 'create', data);
    };

    itemForm.onsubmit = submitHandler(itemForm);

    const formS4 = document.getElementById('item-form-s4');
    formS4.onsubmit = submitHandler(formS4);
}

/* ----------------------------------------------------------------- writes */

// Every write goes through here, so the token is attached in exactly one place
// and a refused token is handled the same way wherever it happens.
async function postToSheet(action, fields) {
    const params = new URLSearchParams();
    for (const key in fields) {
        params.append(key, fields[key]);
    }
    params.append('action', action);
    params.append('token', adminToken || '');

    const result = await fetchJson(API_URL, { method: 'POST', body: params });

    if (result.status !== 'success' && result.code === 'unauthorized') {
        lock('パスワードが変更されました。もう一度入力してください。');
        throw new Error(result.message);
    }
    if (result.status !== 'success') {
        throw new Error(result.message || '保存に失敗しました。');
    }

    return result;
}

/* Writes report what they changed, so the page applies the change to the
   records it already holds rather than re-reading both sheets. Re-reading cost
   another round trip after every drag, save and delete -- the pause that made
   editing feel heavy. Use 再取得 to pull the sheets again, which is also what
   to do if someone else is editing at the same time. */

async function updateItemLayer(row, newLayer) {
    showLoading(true);
    try {
        await postToSheet('update', { sheet: 'sheet4', _row: row, layer: newLayer });
        // app.js has already set the item's layer; redraw where the sheet agrees.
        renderTimeline();
    } catch (error) {
        console.error('Update error:', error);
        alert(error.message);
        await loadData(); // Put the dragged label back where the sheet says it is
    } finally {
        showLoading(false);
    }
}

function sheetItems(sheetName) {
    return sheetName === 'sheet4' ? state.sheet4Items : state.items;
}

// The submitted fields, minus the ones that route the request.
function recordFields(data) {
    const fields = {};
    Object.keys(data).forEach(key => {
        if (['action', 'sheet', '_row', 'token'].indexOf(key) === -1) fields[key] = data[key];
    });
    return fields;
}

function applyLocalWrite(action, data, result) {
    const sheetName = data.sheet === 'sheet4' ? 'sheet4' : 'sheet3';
    const items = sheetItems(sheetName);

    if (action === 'create') {
        const row = parseInt(result && result.data && result.data._row, 10);
        if (!row) return false; // deployment predates the reported row number
        items.push(Object.assign(recordFields(data), { _row: row }));
        return true;
    }

    const row = parseInt(data._row, 10);
    const item = items.find(i => i._row === row);
    if (!item) return false;

    Object.assign(item, recordFields(data));
    return true;
}

function applyLocalDelete(sheetName, row) {
    const items = sheetItems(sheetName);
    const index = items.findIndex(i => i._row === row);
    if (index !== -1) items.splice(index, 1);

    // Deleting a row closes the gap in the sheet, so every record below it
    // moves up one. Leaving the old numbers would edit the wrong record next.
    items.forEach(item => {
        if (item._row > row) item._row -= 1;
    });
}

function redrawAfterWrite() {
    syncSelectOptions();
    calculateBounds();
    renderTimeline();
}

async function sendData(action, data) {
    showLoading(true);
    closeModals();

    try {
        const result = await postToSheet(action, data);

        // Mark the record so it stands out in the timeline
        state.modifiedSignatures.add(getSignature(data));

        if (applyLocalWrite(action, data, result)) redrawAfterWrite();
        else await loadData();
    } catch (error) {
        console.error('Save error:', error);
        alert(error.message);
    } finally {
        showLoading(false);
    }
}

async function deleteItem(row, sheetName = 'sheet3') {
    if (!confirm('この項目を削除しますか？')) return;

    showLoading(true);
    closeModals();

    try {
        await postToSheet('delete', { sheet: sheetName, _row: row });

        applyLocalDelete(sheetName, parseInt(row, 10));
        redrawAfterWrite();
    } catch (error) {
        console.error('Delete error:', error);
        alert(error.message);
    } finally {
        showLoading(false);
    }
}

/* ------------------------------------------------------------------ start */

// Filling these in is what makes app.js treat the timeline as editable: cards
// become clickable and period labels become draggable.
editHooks.onDataLoaded = syncSelectOptions;
editHooks.onItemClick = openEditModal;
editHooks.onPeriodClick = openSheet4Modal;
editHooks.onPeriodMove = (item, newLayer) => updateItemLayer(item._row, newLayer);

setupForm();
setupLogin();
