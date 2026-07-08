/**
 * LifeScrum — Personal Life Scrum Board
 */

const COLUMNS = ["Ice Box", "Emergency", "In Progress", "Unclear", "Complete"];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let state = {
    lanes: [],
    cards: [],
    sprints: [],
    meta: { currentSprint: '', lastVisitDate: '' },
    burndown: {}
};

let currentEditingId = null;
let draggingLaneId = null;
let laneMenuTarget = null;

// ============================================================
// PERSISTENCE
// ============================================================

function safeParse(key, fallback) {
    try {
        const val = JSON.parse(localStorage.getItem(key));
        return val === null || val === undefined ? fallback : val;
    } catch (e) {
        console.warn(`Corrupt data in "${key}" — resetting to default.`, e);
        return fallback;
    }
}

function loadData() {
    state.lanes = safeParse('scrum_lanes', null) || [
        { id: uuid(), name: 'Career & Skills', order: 0 },
        { id: uuid(), name: 'Income & Finance', order: 1 },
        { id: uuid(), name: 'Content & Brand', order: 2 },
        { id: uuid(), name: 'Projects & Builds', order: 3 },
        { id: uuid(), name: 'Faith & Discipline', order: 4 },
        { id: uuid(), name: 'Monthly Goals', order: 5 }
    ];
    state.cards = safeParse('scrum_cards', []);
    state.sprints = safeParse('scrum_sprints', []);
    state.meta = safeParse('scrum_meta', null) || {
        currentSprint: getCurrentSprintName(),
        lastVisitDate: todayISO()
    };
    state.burndown = safeParse('scrum_burndown', {});
}

let bootSaving = false; // true only during the automatic save in init()

function saveData(skipSnapshot) {
    localStorage.setItem('scrum_lanes', JSON.stringify(state.lanes));
    localStorage.setItem('scrum_cards', JSON.stringify(state.cards));
    localStorage.setItem('scrum_sprints', JSON.stringify(state.sprints));
    localStorage.setItem('scrum_meta', JSON.stringify(state.meta));
    if (!skipSnapshot) updateBurndownSnapshot();
    localStorage.setItem('scrum_burndown', JSON.stringify(state.burndown));

    // Only user-driven saves count as "new edits" for cross-device sync —
    // the page-load save must not outrank changes made on another device.
    if (!bootSaving) {
        localStorage.setItem('scrum_updated_at', new Date().toISOString());
        if (window.cloudSync) cloudSync.schedulePush();
    }
}

// ============================================================
// UTILS
// ============================================================

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function todayISO() {
    return new Date().toISOString().split('T')[0];
}

function getCurrentSprintName() {
    const d = new Date();
    return d.toLocaleString('default', { month: 'long', year: 'numeric' });
}

function getDaysRemaining() {
    const d = new Date();
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return lastDay - d.getDate();
}

function parseDateOnly(dateStr) {
    return new Date(dateStr + 'T00:00:00');
}

function formatDDMMM(dateStr) {
    const d = parseDateOnly(dateStr);
    return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_SHORT[d.getMonth()]}`;
}

function formatFullDate(dateStr) {
    const d = parseDateOnly(dateStr.split('T')[0]);
    return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.innerText = str || '';
    return div.innerHTML;
}

function reindexLanes() {
    state.lanes.sort((a, b) => a.order - b.order).forEach((l, i) => l.order = i);
}

// ============================================================
// INIT
// ============================================================

function init() {
    loadData();
    reindexLanes();
    renderHeader();
    renderBoard();
    setupEventListeners();
    checkSprintRollover();
    bootSaving = true;
    saveData();
    bootSaving = false;
}

function checkSprintRollover() {
    const currentActual = getCurrentSprintName();
    if (state.meta.currentSprint && state.meta.currentSprint !== currentActual) {
        showRolloverModal(state.meta.currentSprint, currentActual);
    } else if (!state.meta.currentSprint) {
        state.meta.currentSprint = currentActual;
    }
}

function updateBurndownSnapshot() {
    const today = todayISO();
    const snapshot = {};
    state.lanes.forEach(lane => {
        snapshot[lane.id] = state.cards.filter(c => c.laneId === lane.id && c.column !== 'Complete').length;
    });
    state.burndown[today] = snapshot;
}

// ============================================================
// RENDERING — HEADER
// ============================================================

const XP_PER_QUEST = 50;
const XP_PER_LEVEL = 250;

function getTotalCompleted() {
    const archived = state.sprints.reduce((n, s) => n + s.cards.length, 0);
    return archived + state.cards.filter(c => c.column === 'Complete').length;
}

function renderHeader() {
    document.getElementById('sprint-display').innerText = `Sprint: ${state.meta.currentSprint}`;
    document.getElementById('days-remaining').innerText = `⚔ ${getDaysRemaining()} days remaining`;

    const xp = getTotalCompleted() * XP_PER_QUEST;
    const level = Math.floor(xp / XP_PER_LEVEL) + 1;
    document.getElementById('level-badge').innerText = `Lv. ${level}`;
    document.getElementById('xp-fill').style.width = `${((xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100}%`;
}

function showQuestToast() {
    let toast = document.getElementById('quest-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'quest-toast';
        toast.className = 'quest-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<div class="qt-title">⚔ QUEST COMPLETE</div><div class="qt-xp">+${XP_PER_QUEST} XP</div>`;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ============================================================
// RENDERING — BOARD
// ============================================================

function renderBoard() {
    const board = document.getElementById('scrum-board');
    board.innerHTML = '';

    const corner = document.createElement('div');
    corner.className = 'corner-cell';
    board.appendChild(corner);

    COLUMNS.forEach(col => {
        const h = document.createElement('div');
        h.className = `col-header col-${col.toLowerCase().replace(/\s+/g, '-')}`;
        h.innerText = col;
        board.appendChild(h);
    });

    state.lanes.sort((a, b) => a.order - b.order).forEach(lane => {
        board.appendChild(createLaneLabel(lane));

        COLUMNS.forEach(col => {
            const cell = document.createElement('div');
            cell.className = 'board-cell';
            cell.dataset.laneId = lane.id;
            cell.dataset.column = col;

            const addIcon = document.createElement('div');
            addIcon.className = 'cell-add-btn';
            addIcon.innerHTML = '+';
            addIcon.onclick = (e) => { e.stopPropagation(); openDrawerForNew(lane.id, col); };
            cell.appendChild(addIcon);

            cell.ondragover = (e) => {
                if (draggingLaneId) return;
                e.preventDefault();
                cell.classList.add('drag-over');
            };
            cell.ondragleave = () => cell.classList.remove('drag-over');
            cell.ondrop = (e) => handleCardDrop(e, lane.id, col);

            const cellCards = state.cards.filter(c => c.laneId === lane.id && c.column === col);
            cellCards.forEach(card => cell.appendChild(createCardElement(card)));

            board.appendChild(cell);
        });
    });
}

function createLaneLabel(lane) {
    const label = document.createElement('div');
    label.className = 'lane-label';
    label.draggable = true;
    label.dataset.laneId = lane.id;

    const activeCount = state.cards.filter(c => c.laneId === lane.id && c.column !== 'Complete').length;

    const top = document.createElement('div');
    top.className = 'lane-label-top';
    top.innerHTML = `
        <span class="lane-name-text">${escapeHTML(lane.name)}</span>
        <span class="lane-badge">${activeCount}</span>
        <span class="lane-menu-trigger" title="Lane options">&#8942;</span>
    `;
    label.appendChild(top);

    const chart = document.createElement('div');
    chart.className = 'lane-chart-trigger';
    chart.innerHTML = '📈 Burndown';
    chart.onclick = (e) => { e.stopPropagation(); showBurndown(lane); };
    label.appendChild(chart);

    top.querySelector('.lane-menu-trigger').onclick = (e) => {
        e.stopPropagation();
        openLaneMenu(lane, e.currentTarget);
    };

    // Lane reordering drag
    label.ondragstart = (e) => {
        draggingLaneId = lane.id;
        e.dataTransfer.setData('application/lane-id', lane.id);
        setTimeout(() => label.classList.add('dragging-lane'), 0);
    };
    label.ondragend = () => {
        draggingLaneId = null;
        label.classList.remove('dragging-lane');
    };
    label.ondragover = (e) => {
        if (!draggingLaneId || draggingLaneId === lane.id) return;
        e.preventDefault();
    };
    label.ondrop = (e) => {
        if (!draggingLaneId || draggingLaneId === lane.id) return;
        e.preventDefault();
        reorderLanes(draggingLaneId, lane.id);
    };

    return label;
}

function reorderLanes(draggedId, targetId) {
    const sorted = state.lanes.slice().sort((a, b) => a.order - b.order);
    const fromIdx = sorted.findIndex(l => l.id === draggedId);
    const toIdx = sorted.findIndex(l => l.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = sorted.splice(fromIdx, 1);
    sorted.splice(toIdx, 0, moved);
    sorted.forEach((l, i) => l.order = i);
    saveData();
    renderBoard();
}

function createCardElement(card) {
    const el = document.createElement('div');
    el.className = `card ${card.priority} ${card.column === 'Complete' ? 'card-complete' : ''}`;
    el.draggable = true;
    el.dataset.cardId = card.id;

    const notePreview = card.note ? card.note.substring(0, 60) : '';
    const dateBadge = card.dueDate ? createDueBadgeHTML(card.dueDate) : '';

    el.innerHTML = `
        <span class="pri-dot dot-${card.priority}"></span><span class="card-title">${escapeHTML(card.title)}</span>
        ${notePreview ? `<div class="card-note">${escapeHTML(notePreview)}${card.note.length > 60 ? '…' : ''}</div>` : ''}
        ${dateBadge}
    `;

    el.onclick = () => openDrawerForEdit(card.id);
    el.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', card.id);
        const sourceCell = el.closest('.board-cell');
        if (sourceCell) sourceCell.classList.add('ghost-source');
        setTimeout(() => el.classList.add('dragging'), 0);
    };
    el.ondragend = () => {
        el.classList.remove('dragging');
        document.querySelectorAll('.ghost-source').forEach(c => c.classList.remove('ghost-source'));
    };

    return el;
}

function createDueBadgeHTML(dateStr) {
    const due = parseDateOnly(dateStr);
    const today = parseDateOnly(todayISO());
    const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));

    let styleClass = '';
    if (diffDays < 0) styleClass = 'due-overdue';
    else if (diffDays <= 3) styleClass = 'due-soon';

    return `<div class="due-badge ${styleClass}">${formatDDMMM(dateStr)}</div>`;
}

// ============================================================
// DRAG & DROP — CARDS
// ============================================================

function handleCardDrop(e, laneId, column) {
    e.preventDefault();
    const cell = e.currentTarget;
    cell.classList.remove('drag-over');
    document.querySelectorAll('.ghost-source').forEach(c => c.classList.remove('ghost-source'));

    const cardId = e.dataTransfer.getData('text/plain');
    if (!cardId) return;
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;

    card.laneId = laneId;
    setCardColumn(card, column);
    saveData();
    renderBoard();

    const newEl = document.querySelector(`.card[data-card-id="${cardId}"]`);
    if (newEl) newEl.classList.add('dropped');
}

function setCardColumn(card, column) {
    const wasComplete = card.column === 'Complete';
    card.column = column;
    if (column === 'Complete') {
        if (!wasComplete) {
            card.completedDate = todayISO();
            showQuestToast();
            renderHeader();
        }
    } else {
        card.completedDate = null;
        if (wasComplete) renderHeader();
    }
}

// ============================================================
// DRAWER
// ============================================================

function openDrawerForNew(laneId, column) {
    currentEditingId = null;
    document.getElementById('drawer-title').value = '';
    document.getElementById('drawer-note').value = '';
    document.getElementById('drawer-due-date').value = '';
    updateDrawerDropdowns(laneId, column);
    setDrawerPriority('normal');
    document.getElementById('btn-save-card').style.display = 'block';
    document.getElementById('btn-delete-card').style.display = 'none';
    document.getElementById('drawer-meta').innerText = '';

    openDrawer();
    document.getElementById('drawer-title').focus();
}

function openDrawerForEdit(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    currentEditingId = cardId;

    document.getElementById('drawer-title').value = card.title;
    document.getElementById('drawer-note').value = card.note || '';
    document.getElementById('drawer-due-date').value = card.dueDate || '';
    updateDrawerDropdowns(card.laneId, card.column);
    setDrawerPriority(card.priority);

    document.getElementById('btn-save-card').style.display = 'none';
    document.getElementById('btn-delete-card').style.display = 'block';
    document.getElementById('drawer-meta').innerText =
        `Created ${formatFullDate(card.createdDate)} · Sprint: ${card.sprint}`;

    openDrawer();
}

function updateDrawerDropdowns(selectedLaneId, selectedCol) {
    const laneSelect = document.getElementById('drawer-lane-select');
    laneSelect.innerHTML = '';
    state.lanes.sort((a, b) => a.order - b.order).forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.innerText = l.name;
        if (l.id === selectedLaneId) opt.selected = true;
        laneSelect.appendChild(opt);
    });
    document.getElementById('drawer-column-select').value = selectedCol;
}

function setDrawerPriority(pri) {
    document.querySelectorAll('.pri-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.priority === pri);
    });
}

function getDrawerData() {
    return {
        title: document.getElementById('drawer-title').value.trim(),
        note: document.getElementById('drawer-note').value,
        priority: (document.querySelector('.pri-btn.active') || {}).dataset?.priority || 'normal',
        laneId: document.getElementById('drawer-lane-select').value,
        column: document.getElementById('drawer-column-select').value,
        dueDate: document.getElementById('drawer-due-date').value || null,
    };
}

function saveCurrentFromDrawer() {
    const data = getDrawerData();
    if (!data.title) return false;

    if (currentEditingId) {
        const card = state.cards.find(c => c.id === currentEditingId);
        if (!card) return false;
        card.title = data.title;
        card.note = data.note;
        card.priority = data.priority;
        card.laneId = data.laneId;
        card.dueDate = data.dueDate;
        setCardColumn(card, data.column);
    } else {
        const newCard = {
            id: uuid(),
            title: data.title,
            note: data.note,
            priority: data.priority,
            laneId: data.laneId,
            column: data.column,
            dueDate: data.dueDate,
            createdDate: todayISO(),
            sprint: state.meta.currentSprint,
            completedDate: data.column === 'Complete' ? todayISO() : null
        };
        state.cards.push(newCard);
        currentEditingId = newCard.id;
        if (newCard.column === 'Complete') {
            showQuestToast();
            renderHeader();
        }
    }

    saveData();
    renderBoard();
    return true;
}

function createNewCardFromDrawer() {
    if (saveCurrentFromDrawer()) {
        closeDrawer();
    } else {
        // Empty title — show why the save didn't happen instead of failing silently.
        const titleInput = document.getElementById('drawer-title');
        titleInput.placeholder = 'Name your quest first…';
        titleInput.classList.remove('input-error');
        void titleInput.offsetWidth;
        titleInput.classList.add('input-error');
        titleInput.focus();
    }
}

function deleteCurrentCard() {
    if (!currentEditingId) return;
    showConfirm('Delete this card? This cannot be undone.', () => {
        state.cards = state.cards.filter(c => c.id !== currentEditingId);
        saveData();
        renderBoard();
        closeDrawer();
    });
}

function openDrawer() {
    document.getElementById('drawer-overlay').style.display = 'block';
    document.getElementById('card-drawer').classList.add('open');
}

function closeDrawer() {
    document.getElementById('drawer-overlay').style.display = 'none';
    document.getElementById('card-drawer').classList.remove('open');
    currentEditingId = null;
}

// ============================================================
// CONFIRM DIALOG
// ============================================================

function showConfirm(message, onConfirm) {
    document.getElementById('confirm-message').innerText = message;
    document.getElementById('confirm-overlay').style.display = 'block';
    document.getElementById('confirm-dialog').style.display = 'block';

    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    const cleanup = () => {
        document.getElementById('confirm-overlay').style.display = 'none';
        document.getElementById('confirm-dialog').style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
    };

    okBtn.onclick = () => { cleanup(); onConfirm(); };
    cancelBtn.onclick = cleanup;
    document.getElementById('confirm-overlay').onclick = cleanup;
}

function hideConfirm() {
    document.getElementById('confirm-overlay').style.display = 'none';
    document.getElementById('confirm-dialog').style.display = 'none';
}

// ============================================================
// LANE MENU (rename / delete)
// ============================================================

function openLaneMenu(lane, anchorEl) {
    laneMenuTarget = lane;
    const menu = document.getElementById('lane-menu');
    const rect = anchorEl.getBoundingClientRect();
    menu.style.display = 'flex';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
}

function closeLaneMenu() {
    document.getElementById('lane-menu').style.display = 'none';
    laneMenuTarget = null;
}

function renameLane(lane) {
    const labelEl = document.querySelector(`.lane-label[data-lane-id="${lane.id}"] .lane-name-text`);
    if (!labelEl) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = lane.name;
    input.maxLength = 60;
    input.style.cssText = 'width:100%;background:var(--panel-light);border:1px solid var(--accent2);color:#fff;border-radius:6px;padding:2px 6px;font-weight:700;font-family:Inter,sans-serif;font-size:14px;';
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    let cancelled = false;

    const commit = () => {
        if (cancelled) return;
        const val = input.value.trim();
        if (val) lane.name = val;
        saveData();
        renderBoard();
    };

    input.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancelled = true; renderBoard(); }
    };
    input.onblur = commit;
}

function deleteLane(lane) {
    const count = state.cards.filter(c => c.laneId === lane.id).length;
    showConfirm(`Delete ${lane.name}? All ${count} cards in this lane will be permanently deleted.`, () => {
        state.cards = state.cards.filter(c => c.laneId !== lane.id);
        state.lanes = state.lanes.filter(l => l.id !== lane.id);
        reindexLanes();
        saveData();
        renderBoard();
    });
}

// ============================================================
// GENERIC MODAL
// ============================================================

function showModal(html) {
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-overlay').style.display = 'block';
    document.getElementById('modal-container').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('modal-container').style.display = 'none';
}

// ============================================================
// SPRINT SUMMARY
// ============================================================

function showSprintSummary() {
    let html = '<h2>Sprint Summary</h2>';

    html += '<h3>Per-lane progress</h3>';
    state.lanes.sort((a, b) => a.order - b.order).forEach(l => {
        const cards = state.cards.filter(c => c.laneId === l.id);
        const done = cards.filter(c => c.column === 'Complete').length;
        const total = cards.length;
        const pct = total ? (done / total) * 100 : 0;
        html += `
            <div class="progress-row">
                <div class="progress-label"><span>${escapeHTML(l.name)}</span><span>${done} / ${total}</span></div>
                <div class="progress-container"><div class="progress-bar" style="width:${pct}%"></div></div>
            </div>`;
    });

    const complete = state.cards.filter(c => c.column === 'Complete');
    html += `<h3>Complete (${complete.length})</h3>`;
    html += complete.length
        ? complete.map(c => `<div class="summary-list-item">${escapeHTML(c.title)}</div>`).join('')
        : '<div class="summary-list-item">No cards completed yet.</div>';

    const other = state.cards.filter(c => c.column !== 'Complete');
    html += `<h3>In progress across board (${other.length})</h3>`;
    html += other.length
        ? other.map(c => `<div class="summary-list-item">${escapeHTML(c.title)} — <span style="color:var(--text-muted)">${c.column}</span></div>`).join('')
        : '<div class="summary-list-item">Nothing here.</div>';

    showModal(html);
}

// ============================================================
// PAST SPRINTS
// ============================================================

function showPastSprints() {
    const body = document.getElementById('past-sprints-body');
    const sprintsDesc = state.sprints.slice().reverse();

    if (!sprintsDesc.length) {
        body.innerHTML = '<p style="color:var(--text-muted);">No archived sprints yet.</p>';
    } else {
        body.innerHTML = sprintsDesc.map((s, idx) => {
            const byLane = {};
            s.cards.forEach(c => {
                const laneName = (state.lanes.find(l => l.id === c.laneId) || {}).name || 'Deleted lane';
                if (!byLane[laneName]) byLane[laneName] = [];
                byLane[laneName].push(c);
            });

            const groups = Object.keys(byLane).map(laneName => `
                <div class="archived-lane-group">
                    <h4>${escapeHTML(laneName)}</h4>
                    ${byLane[laneName].map(c => `
                        <div class="archived-card">
                            <span class="ac-title">${escapeHTML(c.title)}</span>
                            <span class="ac-meta">${c.priority}${c.dueDate ? ' · due ' + formatDDMMM(c.dueDate) : ''}${c.completedDate ? ' · done ' + formatDDMMM(c.completedDate) : ''}</span>
                        </div>
                    `).join('')}
                </div>
            `).join('');

            return `
                <div class="sprint-entry" data-idx="${idx}">
                    <div class="sprint-entry-header">
                        <span>${escapeHTML(s.sprint)}</span>
                        <span style="color:var(--text-muted);font-weight:400;">${s.cards.length} cards archived</span>
                    </div>
                    <div class="sprint-entry-body">${groups || '<p style="color:var(--text-muted);">No cards.</p>'}</div>
                </div>
            `;
        }).join('');

        body.querySelectorAll('.sprint-entry-header').forEach(h => {
            h.onclick = () => h.closest('.sprint-entry').classList.toggle('expanded');
        });
    }

    document.getElementById('past-sprints-overlay').style.display = 'block';
}

function closePastSprints() {
    document.getElementById('past-sprints-overlay').style.display = 'none';
}

// ============================================================
// SPRINT ROLLOVER
// ============================================================

function showRolloverModal(oldSprint, newSprint) {
    const rows = state.lanes.sort((a, b) => a.order - b.order).map(l => {
        const cards = state.cards.filter(c => c.laneId === l.id && c.sprint === oldSprint);
        const done = cards.filter(c => c.column === 'Complete').length;
        return `<li>${escapeHTML(l.name)}: ${done} / ${cards.length} completed</li>`;
    }).join('');

    const body = document.getElementById('rollover-body');
    body.innerHTML = `
        <h2>${escapeHTML(oldSprint)} Sprint ended</h2>
        <ul style="text-align:left; line-height:1.8;">${rows}</ul>
        <button id="btn-start-new-sprint" class="btn-primary">Start ${escapeHTML(newSprint)}</button>
    `;

    document.getElementById('rollover-modal').style.display = 'flex';

    document.getElementById('btn-start-new-sprint').onclick = () => {
        const completedCards = state.cards.filter(c => c.column === 'Complete');
        state.sprints.push({
            sprint: oldSprint,
            archivedDate: todayISO(),
            cards: completedCards.map(c => ({ ...c }))
        });

        // Emergency cards, and everything not Complete, roll over untouched.
        state.cards = state.cards.filter(c => c.column !== 'Complete');

        state.meta.currentSprint = newSprint;
        state.meta.lastVisitDate = todayISO();
        saveData();

        document.getElementById('rollover-modal').style.display = 'none';
        renderHeader();
        renderBoard();
    };
}

// ============================================================
// BURNDOWN
// ============================================================

function showBurndown(lane) {
    showModal(`
        <h2>${escapeHTML(lane.name)} — Burndown</h2>
        <canvas id="burndownChart" width="420" height="220" style="width:100%;background:rgba(255,255,255,0.02);border-radius:8px;"></canvas>
        <div class="burndown-meta">
            <div class="progress-row" id="burndownProgress"></div>
            <div class="streak-line" id="burndownStreak"></div>
        </div>
    `);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const history = [];
    for (let i = 1; i <= daysInMonth; i++) {
        const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        history.push(state.burndown[key]?.[lane.id] ?? null);
    }

    const knownValues = history.filter(v => v !== null);
    const idealStart = knownValues.length ? knownValues[0] : 0;
    const maxCards = Math.max(...knownValues, idealStart, 1);

    drawBurndownChart(document.getElementById('burndownChart'), history, idealStart, daysInMonth, maxCards);

    const done = state.cards.filter(c => c.laneId === lane.id && c.column === 'Complete').length;
    const total = state.cards.filter(c => c.laneId === lane.id).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    document.getElementById('burndownProgress').innerHTML = `
        <div class="progress-label"><span>Complete</span><span>${done} / ${total} (${pct}%)</span></div>
        <div class="progress-container"><div class="progress-bar" style="width:${pct}%"></div></div>
    `;

    document.getElementById('burndownStreak').innerText = `🔥 ${computeStreak(lane.id)}-day streak`;
}

function drawBurndownChart(canvas, history, idealStart, daysInMonth, maxCards) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const padding = { left: 34, right: 12, top: 12, bottom: 22 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, h - padding.bottom);
    ctx.lineTo(w - padding.right, h - padding.bottom);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px Inter, sans-serif';
    ctx.fillText(String(maxCards), 4, padding.top + 8);
    ctx.fillText('0', 12, h - padding.bottom + 4);
    ctx.fillText('1', padding.left - 2, h - padding.bottom + 14);
    ctx.fillText(String(daysInMonth), w - padding.right - 12, h - padding.bottom + 14);

    const xForDay = (i) => padding.left + (i / (daysInMonth - 1)) * plotW;
    const yForVal = (v) => padding.top + plotH - (v / maxCards) * plotH;

    // Ideal dashed line
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xForDay(0), yForVal(idealStart));
    ctx.lineTo(xForDay(daysInMonth - 1), yForVal(0));
    ctx.stroke();
    ctx.setLineDash([]);

    // Actual line
    ctx.strokeStyle = '#00E5FF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    let started = false;
    history.forEach((val, i) => {
        if (val === null) return;
        const x = xForDay(i);
        const y = yForVal(val);
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    });
    ctx.stroke();

    // Points
    ctx.fillStyle = '#00E5FF';
    history.forEach((val, i) => {
        if (val === null) return;
        const x = xForDay(i);
        const y = yForVal(val);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    });
}

function computeStreak(laneId) {
    let streak = 0;
    let cursor = new Date();
    for (let i = 0; i < 365; i++) {
        const key = cursor.toISOString().split('T')[0];
        const hadCompletion = state.cards.some(c => c.laneId === laneId && c.completedDate === key);
        if (hadCompletion) {
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        } else {
            break;
        }
    }
    return streak;
}

// ============================================================
// EVENT SETUP
// ============================================================

function setupEventListeners() {
    // Drawer auto-save on edit
    ['drawer-title', 'drawer-note', 'drawer-due-date', 'drawer-lane-select', 'drawer-column-select'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            if (currentEditingId) saveCurrentFromDrawer();
        });
    });

    document.getElementById('drawer-title').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!currentEditingId) createNewCardFromDrawer();
        }
    });

    document.getElementById('drawer-note').addEventListener('input', () => {
        if (currentEditingId) saveCurrentFromDrawer();
    });

    document.getElementById('btn-clear-due').onclick = () => {
        document.getElementById('drawer-due-date').value = '';
        if (currentEditingId) saveCurrentFromDrawer();
    };

    document.querySelectorAll('.pri-btn').forEach(btn => {
        btn.onclick = () => {
            setDrawerPriority(btn.dataset.priority);
            if (currentEditingId) saveCurrentFromDrawer();
        };
    });

    document.getElementById('btn-save-card').onclick = createNewCardFromDrawer;
    document.getElementById('btn-delete-card').onclick = deleteCurrentCard;
    document.getElementById('btn-close-drawer').onclick = closeDrawer;
    document.getElementById('drawer-overlay').onclick = closeDrawer;

    // Add lane
    const addLaneBtn = document.getElementById('btn-add-lane');
    const inlineWrap = document.getElementById('add-lane-inline');
    const inlineInput = document.getElementById('add-lane-input');

    addLaneBtn.onclick = () => {
        addLaneBtn.style.display = 'none';
        inlineWrap.style.display = 'block';
        inlineInput.value = '';
        inlineInput.focus();
    };

    function cancelAddLane() {
        inlineWrap.style.display = 'none';
        addLaneBtn.style.display = 'block';
    }

    inlineInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const name = inlineInput.value.trim();
            if (name) {
                state.lanes.push({ id: uuid(), name, order: state.lanes.length });
                saveData();
                renderBoard();
            }
            cancelAddLane();
        } else if (e.key === 'Escape') {
            cancelAddLane();
        }
    });
    inlineInput.addEventListener('blur', cancelAddLane);

    // Lane menu
    document.getElementById('lane-menu-rename').onclick = () => {
        const lane = laneMenuTarget;
        closeLaneMenu();
        if (lane) renameLane(lane);
    };
    document.getElementById('lane-menu-delete').onclick = () => {
        const lane = laneMenuTarget;
        closeLaneMenu();
        if (lane) deleteLane(lane);
    };
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('lane-menu');
        if (menu.style.display === 'flex' && !menu.contains(e.target)) closeLaneMenu();
    });

    // Header buttons
    document.getElementById('btn-summary').onclick = showSprintSummary;
    document.getElementById('btn-past-sprints').onclick = showPastSprints;
    document.getElementById('past-sprints-close').onclick = closePastSprints;

    document.getElementById('modal-close').onclick = closeModal;
    document.getElementById('modal-overlay').onclick = closeModal;

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        const tag = document.activeElement.tagName;
        const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

        if (e.key === 'Escape') {
            closeDrawer();
            closeModal();
            hideConfirm();
            closePastSprints();
            closeLaneMenu();
            return;
        }

        if (e.key.toLowerCase() === 'n' && !isTyping) {
            e.preventDefault();
            const sortedLanes = state.lanes.slice().sort((a, b) => a.order - b.order);
            if (sortedLanes.length) {
                openDrawerForNew(sortedLanes[0].id, 'Ice Box');
            }
        }
    });
}

// ============================================================
// START
// ============================================================

init();
