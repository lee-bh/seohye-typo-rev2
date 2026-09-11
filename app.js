const API_URL = 'https://script.google.com/macros/s/AKfycbwsd2UULk5uY0yrrXPMvaom_pi8HV9QeFLbUrHdsmMsGkesZkL8NoIqNRNiqg2VOMs2/exec';

// State
let state = {
    items: [], // Sheet3 data
    sheet4Items: [], // Sheet4 data
    horizontalScale: 4, // Horizontal zoom scale (DEFAULT_SCALE)
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    isItemDragging: false,
    draggedDist: 0, // Pointer travel since the current drag started
    panDist: 0, // Pointer travel since the current pan started
    draggingEl: null,
    draggingItem: null,
    startY: 0,
    startLayer: 0,
    lastMouseX: 0,
    lastMouseY: 0,
    minYear: 1800,
    maxYear: 2025,
    modifiedSignatures: new Set()
};

function getSignature(item) {
    return `${item.yr}-${item.item}-${item.nation}`;
}

// DOM Elements
const app = document.getElementById('app');
const timelineContainer = document.getElementById('timeline-container');
const timelineContent = document.getElementById('timeline-content');
const loadingIndicator = document.getElementById('loading-indicator');

// Editing lives in admin.js, which fills these in. index.html loads this file
// alone and stays read-only: no modals, no writes, nothing to authorise.
const editHooks = {
    onDataLoaded: null, // () => void, after every successful load
    onItemClick: null, // (item) => void, a sheet3 card was clicked
    onPeriodClick: null, // (item) => void, a sheet4 label was clicked
    onPeriodMove: null // (item, newLayer) => Promise, a label was dragged
};

function isEditable() {
    return editHooks.onItemClick !== null;
}

// Constants
const LAYER_COUNT = 31; // sheet4 stacks periods across this many layers
const LAYER_HEIGHT = 40; // vertical distance between two layers
const LAYER_TOP_MARGIN = 80; // top of the content to layer 1's label
const LABEL_LINE_GAP = 20; // a label sits this far above its period line
const CLICK_SLOP = 5; // pointer travel still counted as a click, in px
const ITEM_WIDTH = 320; // sheet3 card width, mirrored into CSS as --item-width
const ITEM_GAP = 8; // minimum horizontal space between two cards in a row
const ITEM_ROW_HEIGHT = 40; // vertical distance between two packed rows
const MIN_SCALE = 0.5;
const MAX_SCALE = 10;
const DEFAULT_SCALE = 4;

// Layer geometry lives in these two functions alone: the render pass, the drag
// preview and the drop calculation all used to carry their own copy of the
// margin, and a 20px disagreement between them made every label jump the moment
// it was picked up.
function layerTop(layer) {
    return (layer - 1) * LAYER_HEIGHT + LAYER_TOP_MARGIN;
}

function layerFromTop(top) {
    return Math.round((top - LAYER_TOP_MARGIN) / LAYER_HEIGHT) + 1;
}

// Where the sheet3 cards begin, just below the last period layer. Derived from
// the layer geometry rather than the hardcoded 1410 it used to be, which drifted
// out of agreement with the layers it was meant to clear.
function sheet3Top() {
    return layerTop(LAYER_COUNT) + LABEL_LINE_GAP + 80;
}

// Spreadsheet text goes into innerHTML; a stray < in a title would otherwise
// swallow the rest of the card.
function escapeHtml(value) {
    return textValue(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

// One year in pixels at the current zoom. Derived in three places before, which
// is one divergence away from items and grid lines disagreeing on where a year
// sits.
function getPixelsPerYear() {
    const totalTime = state.maxYear - state.minYear;
    if (totalTime <= 0) return 1;
    return (window.innerWidth / totalTime) * state.horizontalScale;
}

// Initialize
async function init() {
    setupInteractions();
    await loadData();
    centerView();
}

// Data Fetching
async function loadData() {
    showLoading(true);
    try {
        // Fetch Sheet3
        const res1 = await fetch(`${API_URL}?action=read&sheet=sheet3`);
        const json1 = await res1.json();

        // Fetch Sheet4
        const res2 = await fetch(`${API_URL}?action=read&sheet=sheet4`);
        const json2 = await res2.json();

        if (json1.status === 'success' && json2.status === 'success') {
            state.items = parseRows(json1.data.headers, json1.data.rows, json1.data.rowNumbers);
            state.sheet4Items = parseRows(json2.data.headers, json2.data.rows, json2.data.rowNumbers);

            console.log('Sheet3 items:', state.items);
            console.log('Sheet4 items:', state.sheet4Items);

            if (editHooks.onDataLoaded) editHooks.onDataLoaded();
            calculateBounds();
            renderTimeline();
        } else {
            console.error('Error loading data:', json1.message || json2.message);
            alert('Failed to load data. Please check console.');
        }
    } catch (error) {
        console.error('Fetch error:', error);
        console.warn('Using mock data due to fetch error');
        useMockData();
    } finally {
        showLoading(false);
    }
}

function parseRows(headers, rows, rowNumbers) {
    return rows.map((row, index) => {
        const item = {};
        headers.forEach((header, i) => {
            item[header.toLowerCase()] = row[i];
        });

        // The backend reports the real sheet row for each record. Older
        // deployments do not, so fall back to guessing from the array index --
        // which is only correct while the sheet holds no blank rows.
        const reported = rowNumbers && rowNumbers[index];
        item._row = parseInt(reported, 10) || index + 2;
        return item;
    });
}

// Missing spreadsheet cells arrive as undefined; assigning that to an input
// would put the literal string "undefined" into the field, and saving would
// write it back to the sheet.
function textValue(value) {
    return value === undefined || value === null ? '' : String(value);
}

function useMockData() {
    state.items = [
        { _row: 2, nation: '한국', category: '서체', yr: 1443, item: 'Hunminjeongeum', info: 'Creation of Hangul', link: '', cite: 'Annals' },
        { _row: 3, nation: '중국', category: '기술', yr: 1040, item: 'Bi Sheng', info: 'Movable Type', link: '', cite: 'History' },
        { _row: 4, nation: '일본', category: '서체', yr: 1957, item: 'Helvetica', info: 'Not Asian but test', link: '', cite: 'Wiki' },
        { _row: 5, nation: '한국', category: '경향', yr: 2000, item: 'Digital Era', info: 'Web fonts', link: '', cite: 'News' }
    ];
    state.sheet4Items = [
        { country: '한국', theme: '왕조', begin: 1392, end: 1910, layer: 1, title: '조선시대' },
        { country: '한국', theme: '활자', begin: 1403, end: 1420, layer: 2, title: '계미자' },
        { country: '한국', theme: '활자', begin: 1434, end: 1450, layer: 2, title: '갑인자' },
        { country: '중국', theme: '왕조', begin: 1368, end: 1644, layer: 3, title: '명나라' },
        { country: '중국', theme: '왕조', begin: 1644, end: 1912, layer: 4, title: '청나라' },
        { country: '일본', theme: '막부', begin: 1603, end: 1868, layer: 5, title: '에도 막부' },
        { country: '테스트', theme: '테스트', begin: 1950, end: null, layer: 6, title: '종료년도 없음 테스트' }
    ];
    if (editHooks.onDataLoaded) editHooks.onDataLoaded();
    calculateBounds();
    renderTimeline();
}

function calculateBounds() {
    const allItems = [...state.items, ...state.sheet4Items];
    if (allItems.length === 0) {
        state.minYear = 1800;
        state.maxYear = 2030;
        return;
    }

    const years = [];
    state.items.forEach(i => {
        const y = parseInt(i.yr);
        if (!isNaN(y) && y > 0) years.push(y);
    });
    state.sheet4Items.forEach(i => {
        const b = parseInt(i.begin);
        // Handle 'current' as 2026
        let endValue = i.end;
        if (endValue === 'current') {
            endValue = 2026;
        }
        let e = parseInt(endValue);
        if (!isNaN(b) && b > 0) {
            years.push(b);
            if (isNaN(e)) e = b + 1;
            years.push(e);
        }
    });

    if (years.length === 0) {
        state.minYear = 1800;
        state.maxYear = 2030;
        return;
    }
    state.minYear = Math.min(...years) - 10;
    state.maxYear = Math.max(...years) + 10;
}

// Rendering
function renderTimeline() {
    timelineContent.innerHTML = '';

    const pixelsPerYear = getPixelsPerYear();

    // 1. Render Sheet4 (Top Section - 31 layers)
    renderSheet4(pixelsPerYear);

    // 2. Render Sheet3 (Bottom Section)
    renderSheet3(pixelsPerYear);

    renderGrid();
}

function renderSheet4(pixelsPerYear) {
    // Render one horizontal guide line per layer
    for (let i = 1; i <= LAYER_COUNT; i++) {
        const guide = document.createElement('div');
        guide.className = 'layer-guide-line';
        guide.style.top = `${layerTop(i) + LABEL_LINE_GAP}px`;
        timelineContent.appendChild(guide);
    }

    state.sheet4Items.forEach(item => {
        const begin = parseInt(item.begin);
        // Handle 'current' as 2026
        let endValue = item.end;
        if (endValue === 'current') {
            endValue = 2026;
        }
        let end = parseInt(endValue);
        const layer = parseInt(item.layer) || 1;

        if (isNaN(begin)) return;
        if (isNaN(end)) end = begin + 1;

        const xStart = (begin - state.minYear) * pixelsPerYear;
        const xEnd = (end - state.minYear) * pixelsPerYear;
        const y = layerTop(layer);

        // Line
        const line = document.createElement('div');
        line.className = 'sheet4-line';
        line.id = `line-${item._row}`; // Add ID to update line position during drag
        line.style.left = `${xStart}px`;
        line.style.top = `${y + LABEL_LINE_GAP}px`;
        line.style.width = `${xEnd - xStart}px`;
        timelineContent.appendChild(line);

        // Label
        const label = document.createElement('div');
        label.className = 'sheet4-label';
        label.style.left = `${xStart}px`;
        label.style.top = `${y}px`;
        label.innerHTML = `
            <span class="s2-country">${escapeHtml(item.country)}</span>
            <span class="s2-title">${escapeHtml(item.title)}</span>
        `;

        // DRAG AND DROP & CLICK
        if (isEditable()) label.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            state.isItemDragging = true;
            state.draggedDist = 0; // Reset distance
            state.draggingEl = label;
            state.draggingItem = item;
            state.startY = e.clientY;
            state.startLayer = layer;
            label.classList.add('dragging');
        });

        timelineContent.appendChild(label);
    });
}

function renderSheet3(pixelsPerYear) {
    const topOffset = sheet3Top();

    // Sort items by year
    const sortedItems = [...state.items].sort((a, b) => (parseInt(a.yr) || 0) - (parseInt(b.yr) || 0));

    // Pack the sorted cards into rows: each one drops into the first row whose
    // previous card has already ended before this card starts. Stacking by array
    // index instead gave every card a row of its own, a diagonal staircase
    // 45px * n tall in which nothing about a period's density was readable.
    const rowEnds = [];

    sortedItems.forEach(item => {
        const el = document.createElement('div');
        el.className = 'timeline-item';

        if (state.modifiedSignatures.has(getSignature(item))) {
            el.classList.add('modified-item');
        }

        let year = parseInt(item.yr);
        if (isNaN(year)) year = state.minYear;

        const x = (year - state.minYear) * pixelsPerYear;

        let row = rowEnds.findIndex(end => end <= x);
        if (row === -1) row = rowEnds.length;
        rowEnds[row] = x + ITEM_WIDTH + ITEM_GAP;

        const y = topOffset + row * ITEM_ROW_HEIGHT;

        el.style.left = `${x}px`;
        el.style.top = `${y}px`;

        el.innerHTML = `
            <div class="item-title">${escapeHtml(item.yr)} ${escapeHtml(item.item) || 'Unknown'} <span class="tag">${escapeHtml(item.nation)}</span> <span class="tag">${escapeHtml(item.category)}</span></div>
            <div class="item-desc">${escapeHtml(item.info)}</div>
        `;

        if (isEditable()) el.addEventListener('click', (e) => {
            e.stopPropagation();
            // Dragging the canvas by an item still pans it, and the click that
            // follows would otherwise open this record's editor on release.
            if (state.panDist > CLICK_SLOP) return;
            editHooks.onItemClick(item);
        });

        timelineContent.appendChild(el);
    });
}

function renderGrid() {
    const axis = document.getElementById('timeline-axis');
    axis.innerHTML = '';

    // Grid range: Union of data range and 1800-2030
    const minGridYear = Math.min(state.minYear, 1800);
    const maxGridYear = Math.max(state.maxYear, 2030);

    const startYear = Math.floor(minGridYear / 10) * 10;
    const endYear = Math.ceil(maxGridYear / 10) * 10;
    const step = 10;

    const pixelsPerYear = getPixelsPerYear();

    for (let y = startYear; y <= endYear; y += step) {
        const line = document.createElement('div');
        line.className = 'grid-line';

        // X calculation
        const x = (y - state.minYear) * pixelsPerYear;

        line.style.left = `${x}px`;
        axis.appendChild(line);

        // Add year label
        const label = document.createElement('div');
        label.className = 'grid-year-label';
        label.textContent = y;
        label.style.left = `${x}px`;
        axis.appendChild(label);
    }
}

// Every pointer currently down on the timeline, so a second finger can be told
// apart from the first. Pointer events cover mouse, touch and pen alike; the
// mouse-only handlers this replaces left the timeline completely inert on
// phones and tablets.
const activePointers = new Map();
let pinch = null;

// Interactions
function setupInteractions() {
    // Drag Interaction
    timelineContainer.addEventListener('pointerdown', (e) => {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.size === 2) {
            beginPinch();
            state.isDragging = false;
            return;
        }
        if (activePointers.size > 2) return;

        state.isDragging = true;
        state.panDist = 0;
        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;
        timelineContainer.style.cursor = 'grabbing';
    });

    window.addEventListener('pointermove', (e) => {
        if (activePointers.has(e.pointerId)) {
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }

        if (pinch && activePointers.size >= 2) {
            applyPinch();
            return;
        }

        if (state.isItemDragging) {
            // Travel from where the drag started, not a running sum of that
            // distance -- accumulating it made a one-pixel tremor read as a
            // deliberate drag within a few mousemove events.
            const deltaY = e.clientY - state.startY;
            state.draggedDist = Math.abs(deltaY);

            const currentY = layerTop(state.startLayer) + deltaY;

            state.draggingEl.style.top = `${currentY}px`;

            // Sync line position
            const line = document.getElementById(`line-${state.draggingItem._row}`);
            if (line) line.style.top = `${currentY + LABEL_LINE_GAP}px`;

            return;
        }

        if (!state.isDragging) return;

        const deltaX = e.clientX - state.lastMouseX;
        const deltaY = e.clientY - state.lastMouseY;

        state.panDist += Math.abs(deltaX) + Math.abs(deltaY);
        state.offsetX += deltaX;
        state.offsetY += deltaY;

        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;

        updateTransform();
    });

    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);

    async function endPointer(e) {
        activePointers.delete(e.pointerId);

        if (activePointers.size < 2) pinch = null;

        // Lifting one finger of a pinch hands the pan back to the other one;
        // without re-anchoring, the next move would jump by their separation.
        if (activePointers.size === 1) {
            const [remaining] = activePointers.values();
            state.lastMouseX = remaining.x;
            state.lastMouseY = remaining.y;
            state.panDist = 0;
            state.isDragging = true;
            return;
        }

        if (state.isItemDragging) {
            state.isItemDragging = false;
            const label = state.draggingEl;
            const item = state.draggingItem;
            label.classList.remove('dragging');

            // Calculate final layer
            const finalY = parseFloat(label.style.top);
            let newLayer = layerFromTop(finalY);
            newLayer = Math.max(1, Math.min(LAYER_COUNT, newLayer));

            if (newLayer !== parseInt(item.layer)) {
                item.layer = newLayer;
                await editHooks.onPeriodMove(item, newLayer);
            } else if (state.draggedDist < CLICK_SLOP) {
                // It was a click, not a significant drag
                editHooks.onPeriodClick(item);
            } else {
                // Snap back if no change but was a drag
                renderTimeline();
            }

            state.draggingEl = null;
            state.draggingItem = null;
            return;
        }

        state.isDragging = false;
        timelineContainer.style.cursor = 'grab';
    }

    // Buttons
    document.getElementById('reset-view').onclick = () => {
        state.horizontalScale = DEFAULT_SCALE;
        renderTimeline();
        centerView();
    };

    document.getElementById('about-btn').onclick = () => {
        document.getElementById('modal-overlay-about').classList.remove('hidden');
    };

    document.getElementById('close-modal-about').onclick = () => {
        document.getElementById('modal-overlay-about').classList.add('hidden');
    };

    const aboutOverlay = document.getElementById('modal-overlay-about');
    aboutOverlay.addEventListener('click', (e) => {
        if (e.target === aboutOverlay) aboutOverlay.classList.add('hidden');
    });

    // Wheel zoom (horizontal only)
    timelineContainer.addEventListener('wheel', (e) => {
        e.preventDefault();

        const zoomSpeed = 0.001;
        const zoomFactor = 1 + (-e.deltaY * zoomSpeed);
        const rect = timelineContainer.getBoundingClientRect();

        zoomTo(state.horizontalScale * zoomFactor, e.clientX - rect.left);
    }, { passive: false });

    // Re-render on resize
    window.addEventListener('resize', scheduleRender);
}

function beginPinch() {
    const [a, b] = [...activePointers.values()];
    const rect = timelineContainer.getBoundingClientRect();

    pinch = {
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startScale: state.horizontalScale,
        lastMid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }
    };
}

function applyPinch() {
    const [a, b] = [...activePointers.values()];
    const rect = timelineContainer.getBoundingClientRect();
    const midX = (a.x + b.x) / 2 - rect.left;
    const midY = (a.y + b.y) / 2 - rect.top;

    // Two fingers moving together pan; two fingers spreading zoom. Handling the
    // pan first means a pinch that barely changes separation still drags.
    state.offsetX += midX - pinch.lastMid.x;
    state.offsetY += midY - pinch.lastMid.y;
    pinch.lastMid = { x: midX, y: midY };

    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    zoomTo(pinch.startScale * (dist / pinch.startDist), midX);
    updateTransform();
}

// Zoom horizontally around a fixed point, given in container coordinates, so
// the year under the cursor or under the pinch centre stays put.
function zoomTo(scale, anchorX) {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    if (next === state.horizontalScale) return;

    const before = getPixelsPerYear();
    const timelineX = anchorX - state.offsetX;

    state.horizontalScale = next;
    state.offsetX = anchorX - timelineX * (getPixelsPerYear() / before);

    scheduleRender();
}

// A zoom gesture fires far more often than the screen refreshes, and each
// render rebuilds every node in the timeline. Coalesce them into one per frame.
let renderHandle = null;

function scheduleRender() {
    if (renderHandle !== null) return;

    renderHandle = requestAnimationFrame(() => {
        renderHandle = null;
        renderTimeline();
        updateTransform();
    });
}

// Called once after the first load and by the reset button: puts the middle of
// the data range in the middle of the viewport. It was referenced at the end of
// init() but never defined, so every startup ended in a TypeError and the view
// opened wherever the origin happened to fall.
function centerView() {
    const midYear = (state.minYear + state.maxYear) / 2;
    state.offsetX = window.innerWidth / 2 - (midYear - state.minYear) * getPixelsPerYear();
    state.offsetY = 0;
    updateTransform();
}

function updateTransform() {
    timelineContent.style.transform = `translate(${state.offsetX}px, ${state.offsetY}px)`;

    // Axis moves only in X
    const axis = document.getElementById('timeline-axis');
    if (axis) {
        axis.style.transform = `translate(${state.offsetX}px, 0)`;
    }
}

function showLoading(show) {
    if (show) loadingIndicator.classList.remove('hidden');
    else loadingIndicator.classList.add('hidden');
}

// Start. admin.html holds this back until the password has been accepted;
// index.html has nothing to unlock and starts straight away.
if (!document.body.classList.contains('admin-mode')) {
    init();
}
