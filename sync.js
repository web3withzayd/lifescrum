/**
 * LifeScrum — Cloud Sync (Supabase)
 *
 * Local-first: the board always works from localStorage. When signed in,
 * the whole board state is mirrored to a single row in the `boards` table
 * and kept live across devices via Supabase Realtime.
 *
 * Merge strategy: last-write-wins on the whole board, with one guard —
 * a "pristine" local board (no cards, no archived sprints) never
 * overwrites an existing cloud board.
 */

const cloudSync = (() => {
    const LOCAL_TS_KEY = 'scrum_updated_at';

    let sb = null;
    let user = null;
    let pushTimer = null;
    let lastPushedAt = null;
    let channel = null;

    // Timestamps come back from Postgres in a different ISO format than the
    // client writes, so always compare numerically.
    const ts = (s) => (s ? Date.parse(s) || 0 : 0);

    const isConfigured = () =>
        window.SUPABASE_URL && window.SUPABASE_ANON_KEY &&
        !window.SUPABASE_URL.includes('YOUR-') && !window.SUPABASE_ANON_KEY.includes('YOUR-');

    // ---------- UI ----------

    function syncBtn() { return document.getElementById('btn-sync'); }

    function setStatus(cls, label) {
        const btn = syncBtn();
        if (!btn) return;
        btn.className = `btn-ghost btn-sync ${cls}`;
        btn.innerHTML = label;
    }

    function refreshButton() {
        if (!isConfigured()) { setStatus('sync-off', '☁ Sync: set up'); return; }
        if (!user) { setStatus('sync-off', '☁ Sign in to sync'); return; }
        setStatus('sync-on', '☁ Synced');
    }

    function showSetupModal() {
        showModal(`
            <h2>Enable Cloud Sync</h2>
            <p>Cloud sync isn't configured yet. Open <b>config.js</b> and paste your
            Supabase project URL and anon key, then redeploy.</p>
            <p style="color:var(--text-muted);font-size:13px;">Full instructions are in the README.</p>
        `);
    }

    function showSignInModal() {
        showModal(`
            <h2>⚔ Sync Your Board</h2>
            <p style="color:var(--text-muted);font-size:13.5px;">Enter your email and we'll send you a
            magic sign-in link — no password needed. Your board then follows you to any device.</p>
            <div class="sync-form">
                <input type="email" id="sync-email" placeholder="you@example.com" autocomplete="email">
                <button id="sync-send-link" class="btn-primary">Send magic link</button>
            </div>
            <div id="sync-form-msg" class="sync-form-msg"></div>
        `);
        const emailInput = document.getElementById('sync-email');
        emailInput.focus();
        const send = async () => {
            const email = emailInput.value.trim();
            const msg = document.getElementById('sync-form-msg');
            if (!email || !email.includes('@')) { msg.innerText = 'Enter a valid email address.'; return; }
            msg.innerText = 'Sending…';
            const { error } = await sb.auth.signInWithOtp({
                email,
                options: { emailRedirectTo: window.location.origin + window.location.pathname }
            });
            msg.innerText = error
                ? `Error: ${error.message}`
                : '✅ Check your email and click the link — this tab will sync once you\'re in.';
        };
        document.getElementById('sync-send-link').onclick = send;
        emailInput.onkeydown = (e) => { if (e.key === 'Enter') send(); };
    }

    function showAccountModal() {
        showModal(`
            <h2>☁ Cloud Sync</h2>
            <p>Signed in as <b>${escapeHTML(user.email)}</b></p>
            <p style="color:var(--text-muted);font-size:13px;">Your board is saved to the cloud automatically
            and live-updates on every device where you're signed in.</p>
            <button id="sync-signout" class="btn-ghost" style="margin-top:8px;">Sign out</button>
        `);
        document.getElementById('sync-signout').onclick = async () => {
            await sb.auth.signOut();
            closeModal();
        };
    }

    // ---------- STATE <-> CLOUD ----------

    function snapshot() {
        return {
            lanes: state.lanes,
            cards: state.cards,
            sprints: state.sprints,
            meta: state.meta,
            burndown: state.burndown
        };
    }

    function isPristineLocal() {
        return state.cards.length === 0 && state.sprints.length === 0;
    }

    function applyRemote(data, remoteTs) {
        localStorage.setItem('scrum_lanes', JSON.stringify(data.lanes || []));
        localStorage.setItem('scrum_cards', JSON.stringify(data.cards || []));
        localStorage.setItem('scrum_sprints', JSON.stringify(data.sprints || []));
        localStorage.setItem('scrum_meta', JSON.stringify(data.meta || null));
        localStorage.setItem('scrum_burndown', JSON.stringify(data.burndown || {}));
        localStorage.setItem(LOCAL_TS_KEY, remoteTs);
        loadData();
        reindexLanes();
        renderHeader();
        renderBoard();
        checkSprintRollover();
    }

    async function pushNow() {
        if (!sb || !user) return;
        setStatus('sync-busy', '☁ Syncing…');
        const now = new Date().toISOString();
        const { error } = await sb.from('boards').upsert({
            user_id: user.id,
            data: snapshot(),
            updated_at: now
        });
        if (error) {
            console.error('Cloud push failed:', error);
            setStatus('sync-err', '☁ Sync error');
            return;
        }
        lastPushedAt = now;
        localStorage.setItem(LOCAL_TS_KEY, now);
        setStatus('sync-on', '☁ Synced');
    }

    function schedulePush() {
        if (!sb || !user) return;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(pushNow, 900);
    }

    async function pull() {
        if (!sb || !user) return;
        const { data: row, error } = await sb.from('boards')
            .select('data, updated_at')
            .eq('user_id', user.id)
            .maybeSingle();
        if (error) { console.error('Cloud pull failed:', error); setStatus('sync-err', '☁ Sync error'); return; }

        const localTs = ts(localStorage.getItem(LOCAL_TS_KEY));
        if (!row) {
            await pushNow();                                  // first device: seed the cloud
        } else if (ts(row.updated_at) > localTs || isPristineLocal()) {
            applyRemote(row.data, row.updated_at);            // cloud is newer (or this device is fresh)
            setStatus('sync-on', '☁ Synced');
        } else if (localTs > ts(row.updated_at)) {
            await pushNow();                                  // local edits made while signed out
        } else {
            setStatus('sync-on', '☁ Synced');
        }
    }

    function subscribeRealtime() {
        if (channel) sb.removeChannel(channel);
        channel = sb.channel('board-sync')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'boards', filter: `user_id=eq.${user.id}` },
                (payload) => {
                    const row = payload.new;
                    if (!row || ts(row.updated_at) === ts(lastPushedAt)) return;   // echo of our own write
                    if (ts(row.updated_at) > ts(localStorage.getItem(LOCAL_TS_KEY))) {
                        applyRemote(row.data, row.updated_at);
                    }
                })
            .subscribe();
    }

    // ---------- INIT ----------

    async function init() {
        const btn = syncBtn();
        refreshButton();

        if (!isConfigured()) {
            btn.onclick = showSetupModal;
            return;
        }

        sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

        btn.onclick = () => (user ? showAccountModal() : showSignInModal());

        sb.auth.onAuthStateChange(async (event, session) => {
            const wasUser = user;
            user = session ? session.user : null;
            refreshButton();
            if (user && (!wasUser || wasUser.id !== user.id)) {
                closeModal();
                await pull();
                subscribeRealtime();
            }
            if (!user && channel) { sb.removeChannel(channel); channel = null; }
        });

        // Catch changes made on other devices while this tab was in the background.
        window.addEventListener('focus', () => { if (user) pull(); });
    }

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', init)
        : init();

    return { schedulePush };
})();
