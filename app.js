const API_URL = 'https://script.google.com/macros/s/AKfycbwsd2UULk5uY0yrrXPMvaom_pi8HV9QeFLbUrHdsmMsGkesZkL8NoIqNRNiqg2VOMs2/exec';

// State
let state = {
    items: [], // Sheet3 data
    sheet4Items: [], // Sheet4 data
    horizontalScale: 4, // Horizontal zoom scale
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    isItemDragging: false,
    draggedDist: 0, // Track drag distance
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
const modalOverlay = document.getElementById('modal-overlay');
const itemForm = document.getElementById('item-form');
const loadingIndicator = document.getElementById('loading-indicator');

// Constants
const PIXELS_PER_YEAR = 20; // Base width for one year
const Y_SPREAD = 400; // Vertical spread range

// Initialize
async function init() {
    console.log('Current Scale:', PIXELS_PER_YEAR);
    setupInteractions();
    setupForm();
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
            state.items = parseRows(json1.data.headers, json1.data.rows);
            state.sheet4Items = parseRows(json2.data.headers, json2.data.rows);

            console.log('Sheet3 items:', state.items);
            console.log('Sheet4 items:', state.sheet4Items);

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

function parseRows(headers, rows) {
    return rows.map((row, index) => {
        const item = {};
        headers.forEach((header, i) => {
            item[header.toLowerCase()] = row[i];
        });
        item._row = index + 2; // Sheet row index (1-based, header is 1)
        return item;
    });
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

    // Calculate dynamic pixelsPerYear based on viewport and horizontal scale
    const totalTime = state.maxYear - state.minYear;
    const screenWidth = window.innerWidth;
    const basePixelsPerYear = screenWidth / totalTime;
    const pixelsPerYear = basePixelsPerYear * state.horizontalScale;

    // 1. Render Sheet4 (Top Section - 31 layers)
    renderSheet4(pixelsPerYear);

    // 2. Render Sheet3 (Bottom Section)
    renderSheet3(pixelsPerYear);

    renderGrid();
}

function renderSheet4(pixelsPerYear) {
    const layerHeight = 40;
    const topMargin = 80;

    // Render 31 Horizontal Guide Lines
    for (let i = 0; i < 31; i++) {
        const guide = document.createElement('div');
        guide.className = 'layer-guide-line';
        guide.style.top = `${i * layerHeight + topMargin + 20}px`;
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
        const y = (layer - 1) * layerHeight + topMargin;

        // Line
        const line = document.createElement('div');
        line.className = 'sheet4-line';
        line.id = `line-${item._row}`; // Add ID to update line position during drag
        line.style.left = `${xStart}px`;
        line.style.top = `${y + 20}px`;
        line.style.width = `${xEnd - xStart}px`;
        timelineContent.appendChild(line);

        // Label
        const label = document.createElement('div');
        label.className = 'sheet4-label';
        label.style.left = `${xStart}px`;
        label.style.top = `${y}px`;
        label.innerHTML = `
            <span class="s2-country">${item.country}</span>
            <span class="s2-title">${item.title}</span>
        `;

        // DRAG AND DROP & CLICK
        label.addEventListener('mousedown', (e) => {
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
    const sheet3TopOffset = 1410; // Increased for 31 layers (31 * 40 + 60 + margin)

    // Sort items by year
    const sortedItems = [...state.items].sort((a, b) => (parseInt(a.yr) || 0) - (parseInt(b.yr) || 0));

    sortedItems.forEach((item, index) => {
        const el = document.createElement('div');
        el.className = 'timeline-item';

        if (state.modifiedSignatures.has(getSignature(item))) {
            el.classList.add('modified-item');
        }

        let year = parseInt(item.yr);
        if (isNaN(year)) year = state.minYear;

        const x = (year - state.minYear) * pixelsPerYear;
        const y = sheet3TopOffset + (index * 45); // Simple vertical stacking

        el.style.left = `${x}px`;
        el.style.top = `${y}px`;

        const info = item.info || '';
        el.innerHTML = `
            <div class="item-title">${item.yr || ''} ${item.item || 'Unknown'} <span class="tag">${item.nation}</span> <span class="tag">${item.category}</span></div>
            <div class="item-desc">${info}</div>
        `;

        el.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(item);
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

    // We need to calculate X based on the same formula as items (including horizontalScale)
    const totalTime = state.maxYear - state.minYear;
    const screenWidth = window.innerWidth;
    const basePixelsPerYear = screenWidth / totalTime;
    const pixelsPerYear = basePixelsPerYear * state.horizontalScale;

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

// Interactions
function setupInteractions() {
    // Drag Interaction
    timelineContainer.addEventListener('mousedown', (e) => {
        state.isDragging = true;
        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;
        timelineContainer.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (state.isItemDragging) {
            const deltaYRaw = e.clientY - state.startY;
            state.draggedDist += Math.abs(deltaYRaw);

            const deltaY = deltaYRaw;
            const currentY = ((state.draggingItem.layer - 1) * 40 + 60) + deltaY;

            state.draggingEl.style.top = `${currentY}px`;

            // Sync line position
            const line = document.getElementById(`line-${state.draggingItem._row}`);
            if (line) line.style.top = `${currentY + 20}px`;

            return;
        }

        if (!state.isDragging) return;

        const deltaX = e.clientX - state.lastMouseX;
        const deltaY = e.clientY - state.lastMouseY;

        state.offsetX += deltaX;
        state.offsetY += deltaY;

        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;

        updateTransform();
    });

    window.addEventListener('mouseup', async (e) => {
        if (state.isItemDragging) {
            state.isItemDragging = false;
            const label = state.draggingEl;
            const item = state.draggingItem;
            label.classList.remove('dragging');

            // Calculate final layer
            const layerHeight = 40;
            const topMargin = 60;
            const finalY = parseFloat(label.style.top);
            let newLayer = Math.round((finalY - topMargin) / layerHeight) + 1;

            // Clamp 1-31
            newLayer = Math.max(1, Math.min(31, newLayer));

            if (newLayer !== parseInt(item.layer)) {
                item.layer = newLayer;
                await updateItemLayer(item._row, newLayer);
            } else if (state.draggedDist < 5) {
                // It was a click, not a significant drag
                openSheet4Modal(item);
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
    });

    // Buttons
    document.getElementById('zoom-in').style.display = 'none';
    document.getElementById('zoom-out').style.display = 'none';
    document.getElementById('reset-view').onclick = () => {
        state.offsetX = 0;
        state.offsetY = 0;
        state.horizontalScale = 4;
        renderTimeline();
        updateTransform();
    };
    document.getElementById('reset-view').style.display = 'flex'; // Show reset button

    document.getElementById('add-sheet4-btn').onclick = () => {
        openSheet4Modal(null);
    };

    document.getElementById('about-btn').onclick = () => {
        document.getElementById('modal-overlay-about').classList.remove('hidden');
    };

    document.getElementById('add-item-btn').onclick = () => {
        openEditModal(null);
    };

    // Wheel zoom (horizontal only)
    timelineContainer.addEventListener('wheel', (e) => {
        e.preventDefault();

        const zoomSpeed = 0.001;
        const delta = -e.deltaY;
        const zoomFactor = 1 + delta * zoomSpeed;

        // Get mouse position relative to container
        const rect = timelineContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;

        // Calculate the timeline position under the mouse before zoom
        const totalTime = state.maxYear - state.minYear;
        const screenWidth = window.innerWidth;
        const basePixelsPerYear = screenWidth / totalTime;
        const currentPixelsPerYear = basePixelsPerYear * state.horizontalScale;

        // Position in timeline coordinates (before offset)
        const timelineX = mouseX - state.offsetX;

        // Update horizontal scale
        const newHorizontalScale = Math.max(0.5, Math.min(10, state.horizontalScale * zoomFactor));

        if (newHorizontalScale !== state.horizontalScale) {
            // Calculate new pixels per year
            const newPixelsPerYear = basePixelsPerYear * newHorizontalScale;

            // Adjust offset to keep the point under mouse stationary
            const scaleDiff = newPixelsPerYear / currentPixelsPerYear;
            const newTimelineX = timelineX * scaleDiff;
            state.offsetX = mouseX - newTimelineX;

            state.horizontalScale = newHorizontalScale;
            renderTimeline();
            updateTransform();
        }
    }, { passive: false });

    // Re-render on resize
    window.addEventListener('resize', () => {
        renderTimeline();
    });
}

function updateTransform() {
    timelineContent.style.transform = `translate(${state.offsetX}px, ${state.offsetY}px)`;

    // Axis moves only in X
    const axis = document.getElementById('timeline-axis');
    if (axis) {
        axis.style.transform = `translate(${state.offsetX}px, 0)`;
    }
}

// Modal & Form
function openEditModal(item) {
    const modalTitle = document.getElementById('modal-title');
    const deleteBtn = document.getElementById('delete-btn');

    if (item) {
        modalTitle.textContent = 'Edit Item';
        document.getElementById('edit-row').value = item._row;
        document.getElementById('edit-nation').value = item.nation;
        document.getElementById('edit-category').value = item.category;
        document.getElementById('edit-yr').value = item.yr;
        document.getElementById('edit-item').value = item.item;
        document.getElementById('edit-info').value = item.info;
        document.getElementById('edit-link').value = item.link;
        document.getElementById('edit-cite').value = item.cite;
        deleteBtn.classList.remove('hidden');

        deleteBtn.onclick = () => deleteItem(item._row);
    } else {
        modalTitle.textContent = 'Add New Item';
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
        modalTitleS4.textContent = '시대상 수정';
        document.getElementById('edit-row-s4').value = item._row;
        document.getElementById('edit-country-s4').value = item.country;
        document.getElementById('edit-theme-s4').value = item.theme;
        document.getElementById('edit-begin-s4').value = item.begin;
        document.getElementById('edit-end-s4').value = item.end;
        document.getElementById('edit-layer-s4').value = item.layer;
        document.getElementById('edit-title-s4').value = item.title;
        deleteBtnS4.classList.remove('hidden');

        deleteBtnS4.onclick = () => deleteItem(item._row, 'sheet4');
    } else {
        modalTitleS4.textContent = '시대상 추가';
        formS4.reset();
        document.getElementById('edit-row-s4').value = '';
        deleteBtnS4.classList.add('hidden');
    }

    modalOverlayS4.classList.remove('hidden');
}

function setupForm() {
    // Sheet1 Close
    document.getElementById('close-modal').onclick = () => {
        modalOverlay.classList.add('hidden');
    };

    // Sheet4 Close
    document.getElementById('close-modal-s4').onclick = () => {
        document.getElementById('modal-overlay-s4').classList.add('hidden');
    };

    // About Close
    document.getElementById('close-modal-about').onclick = () => {
        document.getElementById('modal-overlay-about').classList.add('hidden');
    };

    // Overlay clicks
    window.addEventListener('click', (e) => {
        if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
        const s4Overlay = document.getElementById('modal-overlay-s4');
        if (e.target === s4Overlay) s4Overlay.classList.add('hidden');
        const aboutOverlay = document.getElementById('modal-overlay-about');
        if (e.target === aboutOverlay) aboutOverlay.classList.add('hidden');
    });

    // Sheet1 Submit
    itemForm.onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(itemForm);
        const data = Object.fromEntries(formData.entries());
        const action = data._row ? 'update' : 'create';
        await sendData(action, data);
    };

    // Sheet4 Submit
    const formS4 = document.getElementById('item-form-s4');
    formS4.onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(formS4);
        const data = Object.fromEntries(formData.entries());
        const action = data._row ? 'update' : 'create';
        await sendData(action, data);
    };
}

async function updateItemLayer(row, newLayer) {
    showLoading(true);
    try {
        const params = new URLSearchParams();
        params.append('action', 'update');
        params.append('sheet', 'sheet4');
        params.append('_row', row);
        params.append('layer', newLayer);

        const response = await fetch(`${API_URL}`, {
            method: 'POST',
            body: params
        });

        const result = await response.json();
        if (result.status === 'success') {
            alert('변경완료');
            await loadData(); // Reload for accuracy
        } else {
            alert('Error: ' + result.message);
            renderTimeline(); // Reset view
        }
    } catch (error) {
        console.error('Update error:', error);
        alert('Failed to update layer.');
        renderTimeline();
    } finally {
        showLoading(false);
    }
}

async function sendData(action, data) {
    showLoading(true);
    modalOverlay.classList.add('hidden');

    try {
        // Convert data to URLSearchParams for POST body
        const params = new URLSearchParams();
        for (const key in data) {
            params.append(key, data[key]);
        }

        const response = await fetch(`${API_URL}?action=${action}`, {
            method: 'POST',
            body: params
        });

        const result = await response.json();
        if (result.status === 'success') {
            // Add signature to modified set
            // data contains the fields we need
            state.modifiedSignatures.add(getSignature(data));

            await loadData(); // Reload to see changes
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        console.error('Save error:', error);
        alert('Failed to save. Check console.');
    } finally {
        showLoading(false);
    }
}

async function deleteItem(row, sheetName = 'sheet3') {
    if (!confirm('Are you sure you want to delete this item?')) return;

    showLoading(true);
    modalOverlay.classList.add('hidden');
    document.getElementById('modal-overlay-s4').classList.add('hidden');

    try {
        const params = new URLSearchParams();
        params.append('_row', row);
        params.append('sheet', sheetName);

        const response = await fetch(`${API_URL}?action=delete`, {
            method: 'POST',
            body: params
        });

        const result = await response.json();
        if (result.status === 'success') {
            await loadData();
        } else {
            alert('Error: ' + result.message);
        }
    } catch (error) {
        console.error('Delete error:', error);
        alert('Failed to delete.');
    } finally {
        showLoading(false);
    }
}

function showLoading(show) {
    if (show) loadingIndicator.classList.remove('hidden');
    else loadingIndicator.classList.add('hidden');
}

// Start
init();
