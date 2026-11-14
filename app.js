const DAY_START = 7, DAY_END = 21;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtTime = t => { let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; };
const fmtHour = h => fmtTime(`${pad(h)}:00`).replace(':00', '');
const fmtDate = (s, long) => new Date(s + 'T00:00:00').toLocaleDateString('en-US',
    long ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } : { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
const shiftDate = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };

// ONE format for the whole system: ids are numbers, times are "HH:MM" (no seconds)
const normBooking = b => ({ ...b, id: +b.id, roomId: +b.roomId, start: String(b.start).slice(0, 5), end: String(b.end).slice(0, 5) });


async function api(action, body, query = '') {
    const opt = { credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) Object.assign(opt, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
        const res = await fetch(`api.php?action=${action}${query}`, opt);
        let data = {};
        try { data = await res.json(); } catch (e) { data = { error: 'The server sent an unexpected reply. Is PHP running?' }; }
        return { ok: res.ok, status: res.status, data };
    } catch (e) {
        return { ok: false, status: 0, data: { error: 'Cannot reach the server. Make sure PHP is running.' } };
    }
}
const apiError = r => (r.data.errors && r.data.errors.length) ? r.data.errors : (r.data.error || 'Something went wrong.');


let me = null, rooms = [];
let calBookings = [], mineBookings = [], adminData = { pending: [], others: [], report: [] };

const currentUser = () => me;
const roomName = id => (rooms.find(r => r.id === id) || { name: '?' }).name;


let view = 'calendar', calDate = todayStr(), prefill = {}, flashMsg = null;
const flash = (msg, type = 'ok') => { flashMsg = { msg, type }; };
const takeFlash = () => { const f = flashMsg; flashMsg = null; return f ? `<div class="alert alert-${f.type === 'error' ? 'error' : 'ok'}">${esc(f.msg)}</div>` : ''; };

function fixView() {
    if (!me && !['login', 'register'].includes(view)) view = 'login';
    if (me && ['login', 'register'].includes(view)) view = 'calendar';
    if (view === 'admin' && me && me.role !== 'admin') view = 'calendar';
}


async function loadView() {
    if (!me) return;
    let r = null;
    if (view === 'calendar') {
        r = await api('calendar', undefined, `&date=${encodeURIComponent(calDate)}`);
        if (r.ok) calBookings = r.data.bookings.map(normBooking);
    }
    else if (view === 'mine') {
        r = await api('mine');
        if (r.ok) mineBookings = r.data.bookings.map(normBooking);
    }
    else if (view === 'admin') {
        r = await api('admin');
        if (r.ok) adminData = {
            pending: r.data.pending.map(b => ({ ...normBooking(b), clash: !!b.clash })),
            others: r.data.others.map(normBooking),
            report: r.data.report
        };
    }
    if (!r) return;
    if (r.status === 401) { me = null; view = 'login'; flash('Please log in again.', 'error'); }
    else if (!r.ok) flash(r.data.error || 'Could not load the data.', 'error');
}

async function refresh() { await loadView(); render(); }

async function go(v, extra) {
    view = v; if (extra) prefill = extra;
    fixView();
    await loadView();
    render();
    window.scrollTo(0, 0);
}

function render() {
    fixView();
    const user = me;

    const link = (v, label) => `<a class="${view === v ? 'active' : ''}" onclick="go('${v}')">${label}</a>`;
    $('topbar').innerHTML = `<a class="brand" onclick="go('calendar')" style="cursor:pointer">Class<span>Sync</span></a>` + (user ? `
        <nav>${link('calendar', 'Room Calendar')}${link('book', 'Book a Room')}${link('mine', 'My Requests')}${user.role === 'admin' ? link('admin', 'Admin') : ''}</nav>
        <div class="who">${esc(user.name)} <small>(${esc(user.role)})</small><button class="btn small ghost" onclick="logout()">Log out</button></div>` : '');

    const views = { login: vLogin, register: vRegister, calendar: vCalendar, book: vBook, mine: vMine, admin: vAdmin };
    $('app').innerHTML = takeFlash() + views[view](user);
}


function vLogin() {
    return `<div class="card narrow"><h1>Log in</h1><div id="err"></div>
    <form onsubmit="return doLogin(event)">
        <label>Email<input type="email" id="email" required autofocus></label>
        <label>Password<input type="password" id="pass" required></label>
        <button class="btn" type="submit">Log in</button>
    </form>
    <p class="muted">No account yet? <a onclick="go('register')">Sign up</a></p></div>`;
}

function vRegister() {
    return `<div class="card narrow"><h1>Sign up</h1><div id="err"></div>
    <form onsubmit="return doRegister(event)">
        <div class="row">
            <label>First name<input type="text" id="fname" required maxlength="40" autocomplete="given-name"></label>
            <label>Last name<input type="text" id="lname" required maxlength="40" autocomplete="family-name"></label>
        </div>
        <label>Email<input type="email" id="email" required></label>
        <label>Password (6+ characters)<input type="password" id="pass" required minlength="6"></label>
        <label>Confirm password<input type="password" id="pass2" required minlength="6"></label>
        <button class="btn" type="submit">Create account</button>
    </form>
    <p class="muted">Already have an account? <a onclick="go('login')">Log in</a></p></div>`;
}

function vCalendar() {
    const isToday = calDate === todayStr();
    const day = calBookings;
    const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
    const sortedRooms = [...rooms].sort((a, b) => a.name.localeCompare(b.name));
    const now = nowTime(), curHour = new Date().getHours();

    const rows = sortedRooms.map(r => {
        const list = day.filter(b => b.roomId === r.id);
        const busyNow = isToday && list.some(b => b.status === 'approved' && now >= b.start && now < b.end);
        const cells = hours.map(h => {
            const s = `${pad(h)}:00`, e = `${pad(h + 1)}:00`;
            const b = list.find(b => s < b.end && e > b.start);
            if (!b) {
                const past = calDate < todayStr() || (isToday && h < curHour);
                return `<td class="cell free ${past ? 'past' : ''}">${past ? '' :
                    `<a onclick="go('book',{room:${r.id},date:'${calDate}',start:'${s}'})" title="Book ${esc(r.name)}">+</a>`}</td>`;
            }
            return `<td class="cell ${b.status === 'approved' ? 'booked' : 'pending'}" title="${esc(b.purpose)} — ${esc(b.userName)} (${b.status})"></td>`;
        }).join('');
        return `<tr><th class="room-col">${esc(r.name)}<small>${r.capacity} seats · ${esc(r.equipment)}</small>
            ${isToday ? `<span class="chip ${busyNow ? 'booked' : 'free'} tiny">${busyNow ? 'In use now' : 'Free now'}</span>` : ''}</th>${cells}</tr>`;
    }).join('');

    const listRows = sortedRooms.flatMap(r => day.filter(b => b.roomId === r.id).sort((a, b) => a.start.localeCompare(b.start)).map(b => `
        <tr><td>${esc(r.name)}</td><td>${fmtTime(b.start)} – ${fmtTime(b.end)}</td><td>${esc(b.purpose)}</td><td>${esc(b.userName)}</td>
        <td><span class="badge ${b.status}">${b.status === 'approved' ? 'Approved' : 'Waiting'}</span></td></tr>`)).join('');

    return `<div class="page-head"><h1>Room Calendar</h1>
        <div class="date-nav no-print">
            <button class="btn small ghost" onclick="setDate('${shiftDate(calDate, -1)}')">&larr; Prev</button>
            <input type="date" value="${calDate}" onchange="setDate(this.value)">
            <button class="btn small ghost" onclick="setDate('${shiftDate(calDate, 1)}')">Next &rarr;</button>
            <button class="btn small ghost" onclick="setDate('${todayStr()}')">Today</button>
        </div></div>
    <p class="muted"><strong>${fmtDate(calDate, true)}</strong> — click a green cell to book that room and hour.</p>
    <div class="legend"><span class="chip free">Free</span><span class="chip pending">Waiting for approval</span><span class="chip booked">Booked</span></div>
    <div class="grid-wrap"><table class="schedule"><thead><tr><th class="room-col">Room</th>${hours.map(h => `<th class="hr"><span class="tick">${fmtHour(h)}</span>${h === DAY_END - 1 ? `<span class="tick end">${fmtHour(DAY_END)}</span>` : ''}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <h2>Bookings on this day</h2>
    <table class="list"><thead><tr><th>Room</th><th>Time</th><th>Purpose</th><th>Booked by</th><th>Status</th></tr></thead><tbody>
        ${listRows || '<tr><td colspan="5" class="muted">No bookings yet — every room is free this day.</td></tr>'}</tbody></table>`;
}

function vBook() {
    const p = prefill || {};
    const start = p.start || '08:00';
    const end = p.end || `${pad(Math.min(+start.slice(0, 2) + 1, 21))}:${start.slice(3)}`;
    const sortedRooms = [...rooms].sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="card"><h1>Book a Room</h1><div id="err"></div>
    <form onsubmit="return doBook(event)">
        <label>Room<select id="room" required><option value="">— choose a room —</option>
            ${sortedRooms.map(r => `<option value="${r.id}" ${p.room === r.id ? 'selected' : ''}>${esc(r.name)} (${r.capacity} seats – ${esc(r.equipment)})</option>`).join('')}</select></label>
        <div class="row">
            <label>Date<input type="date" id="date" required min="${todayStr()}" value="${esc(p.date || todayStr())}"></label>
            <label>Start time<input type="time" id="start" required min="07:00" max="21:00" step="900" value="${esc(start)}"></label>
            <label>End time<input type="time" id="end" required min="07:00" max="21:00" step="900" value="${esc(end)}"></label>
        </div>
        <label>Class / purpose<input type="text" id="purpose" required maxlength="120" placeholder="e.g. IT 201 – Web Development" value="${esc(p.purpose || '')}"></label>
        <button class="btn" type="submit">Send request</button>
        <button class="btn ghost" type="button" onclick="go('calendar')">Cancel</button>
    </form></div>`;
}

function vMine() {
    const rows = [...mineBookings].sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
    const label = { pending: 'Waiting', approved: 'Approved ✔', rejected: 'Not approved' };
    const upcoming = rows.filter(b => b.status === 'approved' && b.date >= todayStr()).length;
    return `<div class="page-head"><h1>My Requests</h1><button class="btn" onclick="go('book',{})">+ New request</button></div>
    ${upcoming ? `<div class="alert alert-ok">🎉 You have ${upcoming} approved booking${upcoming > 1 ? 's' : ''} coming up.</div>` : ''}
    <table class="list"><thead><tr><th>Date</th><th>Time</th><th>Room</th><th>Purpose</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(b => `<tr><td>${fmtDate(b.date)}</td><td>${fmtTime(b.start)} – ${fmtTime(b.end)}</td><td>${esc(roomName(b.roomId))}</td><td>${esc(b.purpose)}</td>
        <td><span class="badge ${b.status}">${label[b.status]}</span></td>
        <td>${b.status === 'pending' ? `<button class="btn small ghost" onclick="cancelRequest(${b.id})">Cancel</button>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">You have no requests yet.</td></tr>'}
    </tbody></table>`;
}

function vAdmin() {
    const { pending, others, report } = adminData;

    return `<h1>Admin – Manage Requests</h1>
    <h2>Waiting for your answer (${pending.length})</h2>
    <table class="list"><thead><tr><th>Date</th><th>Time</th><th>Room</th><th>Requested by</th><th>Purpose</th><th>Answer</th></tr></thead><tbody>
    ${pending.map(b => {
        return `<tr><td>${fmtDate(b.date)}</td><td>${fmtTime(b.start)} – ${fmtTime(b.end)}</td><td>${esc(roomName(b.roomId))}</td>
        <td>${esc(b.userName)}</td>
        <td>${esc(b.purpose)}${b.clash ? '<br><small class="warn">⚠ Conflicts with an approved booking</small>' : ''}</td>
        <td class="actions"><button class="btn small" ${b.clash ? 'disabled' : ''} onclick="answer(${b.id},'approved')">Yes</button>
            <button class="btn small danger" onclick="answer(${b.id},'rejected')">No</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">No requests waiting. 🎉</td></tr>'}</tbody></table>

    <h2>Room use report</h2>
    <table class="list"><thead><tr><th>Room</th><th>Approved bookings</th><th>Total hours booked</th></tr></thead><tbody>
    ${report.map(r => `<tr><td>${esc(r.name)}</td><td>${Number(r.total)}</td><td>${Number(r.hours).toFixed(1)} h</td></tr>`).join('')}</tbody></table>

    <h2>Recent answered requests</h2>
    <table class="list"><thead><tr><th>Date</th><th>Time</th><th>Room</th><th>Requested by</th><th>Purpose</th><th>Status</th></tr></thead><tbody>
    ${others.map(b => `<tr><td>${fmtDate(b.date)}</td><td>${fmtTime(b.start)} – ${fmtTime(b.end)}</td><td>${esc(roomName(b.roomId))}</td>
        <td>${esc(b.userName)}</td><td>${esc(b.purpose)}</td>
        <td><span class="badge ${b.status}">${b.status === 'approved' ? 'Approved' : 'Not approved'}</span></td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">Nothing yet.</td></tr>'}</tbody></table>`;
}


const showErr = (msgs) => { $('err').innerHTML = [].concat(msgs).map(m => `<div class="alert alert-error">${esc(m)}</div>`).join(''); };
const setDate = d => { if (d) { calDate = d; refresh(); } };

async function doLogin(ev) {
    ev.preventDefault();
    const r = await api('login', { email: $('email').value.trim(), password: $('pass').value });
    if (!r.ok) { showErr(apiError(r)); return false; }
    me = r.data.user;
    await go('calendar');
    return false;
}

async function doRegister(ev) {
    ev.preventDefault();
    const firstName = $('fname').value.trim(), lastName = $('lname').value.trim(), email = $('email').value.trim().toLowerCase();
    const p1 = $('pass').value, p2 = $('pass2').value, errors = [];
    if (!firstName) errors.push('Please enter your first name.');
    if (!lastName) errors.push('Please enter your last name.');
    if (p1.length < 6) errors.push('Password must be at least 6 characters.');
    if (p1 !== p2) errors.push('Passwords do not match.');
    if (errors.length) { showErr(errors); return false; }
    const r = await api('register', { firstName, lastName, email, password: p1, password2: p2 });
    if (!r.ok) { showErr(apiError(r)); return false; }
    flash('Account created! You can log in now.');
    await go('login');
    return false;
}

async function logout() {
    await api('logout', {});
    me = null; prefill = {};
    await go('login');
}

async function doBook(ev) {
    ev.preventDefault();
    const roomId = +$('room').value, date = $('date').value, start = $('start').value, end = $('end').value, purpose = $('purpose').value.trim();
    prefill = { room: roomId, date, start, end, purpose };   // keep what was typed if something fails
    const errors = [];
    if (!rooms.some(r => r.id === roomId)) errors.push('Please choose a room.');
    if (!date) errors.push('Please choose a date.');
    else if (date < todayStr()) errors.push('You cannot book a date that already passed.');
    if (!start || !end) errors.push('Please choose a valid start and end time.');
    else {
        if (end <= start) errors.push('End time must be after the start time.');
        if (start < '07:00' || end > '21:00') errors.push('Rooms can be booked from 7:00 AM to 9:00 PM only.');
        if (date === todayStr() && start < nowTime()) errors.push('That start time already passed today.');
    }
    if (!purpose) errors.push('Please enter the class or purpose.');
    if (errors.length) { showErr(errors); return false; }

    // the server does the real checks, including the overlap check
    const r = await api('book', { roomId, date, start, end, purpose });
    if (!r.ok) {
        if (r.status === 401) { me = null; flash('Please log in again.', 'error'); await go('login'); }
        else showErr(apiError(r));
        return false;
    }
    prefill = {};
    flash('Request sent! The admin will check it. You can see the answer in My Requests.');
    await go('mine');
    return false;
}

async function cancelRequest(id) {
    if (!confirm('Cancel this request?')) return;
    const r = await api('cancel', { id });
    flash(r.ok ? 'Request cancelled.' : (r.data.error || 'Could not cancel.'), r.ok ? 'ok' : 'error');
    await refresh();
}

async function answer(id, status) {
    const r = await api('answer', { id, status });
    if (r.ok) flash(status === 'approved' ? 'Request approved.' : 'Request marked as not approved.');
    else flash(r.data.error || 'Could not save the answer.', 'error');
    await refresh();
}

(async function init() {
    const r = await api('me');
    if (r.ok) {
        me = r.data.user;
        rooms = r.data.rooms.map(x => ({ ...x, id: +x.id, capacity: +x.capacity }));
    }
    else flash(r.data.error || 'Cannot reach the server.', 'error');
    await go(me ? 'calendar' : 'login');
})();
