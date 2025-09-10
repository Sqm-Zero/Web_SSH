// ===== State =====
let stompClient = null;
let connected = false;
let isFullscreen = false;
let currentFileManagerServer = null; // 当前文件管理器连接的服务器
let currentPath = "/";               // 当前浏览路径
let selectedFile = null;             // 当前选中的文件/目录信息
let reconnectTimer = null;           // 自动重连倒计时计时器
let reconnectRemain = 0;             // 剩余秒数
let latencyTimer = null;             // 延迟定时器

const tabs = []; // {id, name, term, fitAddon, searchAddon}
let activeTab = null;
let selectedFiles = new Set(); // 用于存储多选的文件名
let lastSelectedFile = null; // 用于 Shift 选择

// ===== UI helpers =====
function switchPage(page, el) {
    document.querySelectorAll('.nav .item').forEach(n => n.classList.remove('active'));
    if (el) el.classList.add('active');
    ['ssh','dashboard','files','settings'].forEach(p => { // 确保 'dashboard' 在数组中
        const sec = document.getElementById('page-'+p);
        if (!sec) return;
        if (p === page) {
            sec.classList.remove('hidden');
            // 如果切换到仪表盘页面，刷新服务器列表
            if (p === 'dashboard') {
                // 确保 populateDashboardServerSelect 在 DOM 加载后可用
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', populateDashboardServerSelect);
                } else {
                    populateDashboardServerSelect();
                }
            }
        } else {
            sec.classList.add('hidden');
        }
    });
    // 移除或注释掉旧的 if (page === 'files') {...} 逻辑
}

const TERMINAL_THEMES = {
    dark: {
        background: '#0b0f1e',
        foreground: '#e5e7eb',
        cursor: '#e5e7eb',
        cursorAccent: '#0b0f1e',
        selection: 'rgba(59, 130, 246, 0.3)', // #3b82f6 with alpha
        black: '#000000',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#e5e7eb',
        brightBlack: '#64748b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#a78bfa',
        brightCyan: '#22d3ee',
        brightWhite: '#f8fafc'
    },
    light: {
        background: '#f1f5f9',
        foreground: '#1e293b',
        cursor: '#1e293b',
        cursorAccent: '#f1f5f9',
        selection: 'rgba(147, 197, 253, 0.3)', // #93c5fd with alpha
        black: '#000000',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#0891b2',
        white: '#1e293b',
        brightBlack: '#94a3b8',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#a78bfa',
        brightCyan: '#06b6d4',
        brightWhite: '#0f172a'
    }
};

function toggleTheme(){
    document.body.classList.toggle('theme-light');
    const themeIcon = document.querySelector('.side-actions .btn.ghost i');
    if (document.body.classList.contains('theme-light')) {
        themeIcon.className = 'fa fa-sun';
    } else {
        themeIcon.className = 'fa fa-moon';
    }
    const isLight = document.body.classList.contains('theme-light');
    localStorage.setItem('webssh-theme', isLight ? 'light' : 'dark');

    // --- 使用新的主题配置 ---
    const newTheme = isLight ? TERMINAL_THEMES.light : TERMINAL_THEMES.dark;
    tabs.forEach(tab => {
        if (tab.term) {
            // 使用 options.theme 而不是 setOption
            tab.term.options.theme = newTheme;
        }
    });
    applyBackgroundSettings();
}

function applyBackgroundSettings() {
    const bgType = localStorage.getItem('webssh-bg-type') || 'default';
    const bgImage = localStorage.getItem('webssh-bg-image'); // 存储的是 Data URL

    const body = document.body;
    const sidebar = document.querySelector('.sidebar');

    // 移除所有自定义背景类
    body.classList.remove('custom-bg-full');
    sidebar.classList.remove('custom-bg-sidebar');
    body.style.backgroundImage = '';
    sidebar.style.backgroundImage = '';

    if (bgType !== 'default' && bgImage) {
        if (bgType === 'full') {
            body.classList.add('custom-bg-full');
            body.style.backgroundImage = `url(${bgImage})`;
        } else if (bgType === 'sidebar') {
            sidebar.classList.add('custom-bg-sidebar');
            sidebar.style.backgroundImage = `url(${bgImage})`;
        }
    }
}

// --- 新增：清除背景图片 ---
function clearBackgroundImage() {
    localStorage.removeItem('webssh-bg-image');
    localStorage.setItem('webssh-bg-type', 'default');
    document.getElementById('backgroundType').value = 'default';
    document.getElementById('backgroundImageRow').style.display = 'none';
    applyBackgroundSettings();
    alertOk('背景图片已清除');
}

// --- 新增：应用所有设置 ---
function applySettings() {
    // 应用背景设置
    const bgType = document.getElementById('backgroundType').value;
    localStorage.setItem('webssh-bg-type', bgType);

    const fileInput = document.getElementById('backgroundImage');
    const file = fileInput.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const dataUrl = e.target.result;
            localStorage.setItem('webssh-bg-image', dataUrl);
            applyBackgroundSettings();
            alertOk('设置已应用');
        };
        reader.readAsDataURL(file);
    } else {
        // 如果没有选择新文件，仅应用类型设置
        applyBackgroundSettings();
        alertOk('设置已应用');
    }
}

function setConnState(text, spinning=false) {
    document.getElementById('stateText').textContent = text;
    document.getElementById('stateSpin').style.display = spinning ? 'inline-block' : 'none';
    const pill = document.getElementById('connState');
    pill.classList.remove('error','success','info');
    pill.classList.add(spinning ? 'info' : (connected? 'success' : 'error'));
}

// ===== 延迟探测 =====
function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(id));
}

async function pingLatency() {
    const el = document.getElementById('latencyText');
    if (!el) return;

    const candidates = [
        { url: '/api/ping', method: 'GET' },
        { url: '/actuator/health', method: 'HEAD' },
        { url: '/', method: 'HEAD' }
    ];

    let measured = null;
    for (const c of candidates) {
        try {
            const start = performance.now();
            const res = await fetchWithTimeout(c.url, { method: c.method, cache: 'no-store' }, 3000);
            const end = performance.now();
            if (res.ok) {
                measured = Math.max(1, Math.round(end - start));
                break;
            }
        } catch (e) {
            // 忽略，尝试下一个候选
        }
    }

    if (measured != null) {
        el.textContent = `延迟 ${measured} ms`;
    } else {
        el.textContent = '延迟 -- ms';
    }
}

function startLatencyProbe() {
    clearInterval(latencyTimer);
    // 初始立即测一次
    pingLatency();
    latencyTimer = setInterval(pingLatency, 10000);
}
function stopLatencyProbe() {
    clearInterval(latencyTimer);
    const el = document.getElementById('latencyText');
    if (el) el.textContent = '延迟 -- ms';
}

// ===== 自动重连倒计时 =====
function startReconnectCountdown(seconds = 5) {
    reconnectRemain = seconds;
    const wrap = document.getElementById('reconnectWrap');
    const text = document.getElementById('reconnectText');
    if (wrap) wrap.classList.remove('hidden');
    clearInterval(reconnectTimer);
    text && (text.textContent = `重连 ${reconnectRemain}s`);
    reconnectTimer = setInterval(() => {
        reconnectRemain -= 1;
        if (text) text.textContent = `重连 ${Math.max(0, reconnectRemain)}s`;
        if (reconnectRemain <= 0) {
            clearInterval(reconnectTimer);
            wrap && wrap.classList.add('hidden');
            // 触发重连：尝试重新建立 STOMP
            ensureStompConnected(() => {
                alertInfo('已尝试自动重连');
            });
        }
    }, 1000);
}
function cancelReconnectCountdown() {
    clearInterval(reconnectTimer);
    const wrap = document.getElementById('reconnectWrap');
    wrap && wrap.classList.add('hidden');
}

// ===== Saved servers (localStorage) =====
const KEY = 'webssh.savedServers.v1';
function refreshSaved(){ loadSavedServers(); alertInfo('已刷新已保存服务器列表'); }
function loadSavedServers(){
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    const sel = document.getElementById('savedServers');
    sel.innerHTML = '<option value="">选择已保存的服务器...</option>';
    list.forEach((s, idx) => {
        const o = document.createElement('option');
        o.value = idx; o.textContent = `${s.name || s.host}:${s.port} (${s.username})`;
        sel.appendChild(o);
    });
}
function loadServerConfig() {
    const sel = document.getElementById('savedServers');
    const idx = sel.selectedIndex;
    if (idx <= 0) return;

    // 先尝试读取远程服务器（fetchServers 填充时写入了 data-server）
    const opt = sel.options[idx];
    let server = null;
    if (opt && opt.dataset && opt.dataset.server) {
        try {
            server = JSON.parse(opt.dataset.server);
        } catch (e) {
            console.warn('解析远程服务器数据失败，回退到本地：', e);
        }
    }

    // 如果没有 data-server，则按本地存储回退
    if (!server) {
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        server = list[idx - 1]; // 第一个选项是提示，所以减1
    }

    if (!server) {
        alertWarn('未找到该服务器配置');
        return;
    }

    document.getElementById('host').value = server.host || '';
    document.getElementById('port').value = server.port || 22;
    document.getElementById('username').value = server.username || '';
    document.getElementById('password').value = server.password || '';
    document.getElementById('serverName').value = server.name || '';
    alertOk('已加载服务器配置');
}

// --- 新增：日志面板控制 ---
function toggleLogPanel() {
    const logPanel = document.getElementById('logPanel');
    if (logPanel) { // 安全检查
        logPanel.classList.toggle('hidden');
        if (!logPanel.classList.contains('hidden')) {
            const logMessages = document.getElementById('logMessages');
            if (logMessages) {
                logMessages.scrollTop = logMessages.scrollHeight;
            }
        }
    }
}

// --- 新增：添加日志到面板 ---
function addLogToPanel(type, msg) {
    const logPanel = document.getElementById('logPanel');
    const logMessages = document.getElementById('logMessages');
    // 只有当日志面板存在时才添加日志
    if (logPanel && logMessages) {
        const now = new Date();
        const timestamp = `[${now.toLocaleTimeString()}]`;

        const logEntry = document.createElement('div');
        logEntry.className = `log-message log-${type}`;
        logEntry.innerHTML = `<span class="log-timestamp">${timestamp}</span> ${msg}`;

        logMessages.appendChild(logEntry);

        const maxLogs = 100;
        while (logMessages.children.length > maxLogs) {
            logMessages.removeChild(logMessages.firstChild);
        }

        logMessages.scrollTop = logMessages.scrollHeight;
    }
    // 如果没有日志面板，则静默忽略
}

// --- 修改：Alert 函数现在也写入日志面板 ---
function alertInfo(msg) {
    // 可以保留短暂提示，或者移除
    console.log("[INFO]", msg); // 至少在控制台记录
    addLogToPanel('info', msg); // 如果有日志面板则添加
}
function alertOk(msg) {
    console.log("[OK]", msg);
    addLogToPanel('success', msg);
}
function alertWarn(msg) {
    // pushAlert('warn', msg);
    console.warn("[WARN]", msg);
    addLogToPanel('warn', msg);
}
function alertErr(msg) {
    // pushAlert('error', msg);
    console.error("[ERROR]", msg);
    addLogToPanel('error', msg);
}

// ===== STOMP connect / flow =====
function ensureStompConnected(onReady){
    if (stompClient && connected) return onReady && onReady();
    setConnState('正在连接...', true);
    const socket = new SockJS('/ssh-ws');
    stompClient = Stomp.over(socket);
    // 生产建议：stompClient.debug = null;
    stompClient.connect({}, () => {
        connected = true;
        setConnState('已连接');
        cancelReconnectCountdown();
        startLatencyProbe();
        // 连接成功后立即刷新一次延迟显示
        setTimeout(pingLatency, 50);
        // 订阅服务端输出
        stompClient.subscribe('/user/queue/output', (msg) => {
            try {
                const body = JSON.parse(msg.body);
                if (body.type === 'output' && body.data != null) appendOutput(body.data);
                if (body.type === 'connected') alertOk(body.message || 'SSH 连接建立成功');
                if (body.type === 'error') alertErr(body.message || '错误');
            } catch(e) { console.error(e); }
        });
        if (onReady) onReady();
    }, (err) => {
        connected = false;
        setConnState('连接失败');
        alertErr('STOMP 连接失败：' + (err && err.body || err));
        stopLatencyProbe();
        startReconnectCountdown(5);
    });
}

function connectSSH(){
    const host = document.getElementById('host').value.trim();
    const port = parseInt(document.getElementById('port').value, 10) || 22;
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (!host || !username) { return alertWarn('请填写主机与用户名'); }
    ensureStompConnected(() => {
        stompClient.send('/app/ssh/connect', {}, JSON.stringify({ host, port, username, password }));
        document.getElementById('disconnectBtn').disabled = false;
        // 保存服务器配置（异步处理）
        /*saveServerIfNeeded(host, port, username, password).then(() => {
            if (!activeTab) createNewTab();
        });*/
        saveToLocal(host, port, username, password);
        if (!activeTab) createNewTab();
    });
}

// 保存到本地存储
function saveToLocal(host, port, username, password){
    const name = document.getElementById('serverName').value.trim() || `${host}:${port}`;
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    // 检查是否已存在，避免重复 (可选，提升用户体验)
    const existingIndex = list.findIndex(s => s.host === host && s.port === port && s.username === username);
    const serverObj = { host, port, username, password, name };
    if (existingIndex >= 0) {
        list[existingIndex] = serverObj; // 更新现有条目
        alertInfo('已更新本地保存的服务器配置');
    } else {
        list.push(serverObj); // 新增条目
        alertOk('已保存到本地');
    }
    localStorage.setItem(KEY, JSON.stringify(list));
    loadSavedServers(); // 更新下拉列表
}

// 保存到服务器
async function saveToServer(host, port, username, password) { // 可以考虑不传 password
    try {
        const name = document.getElementById('serverName').value.trim();
        // 注意：出于安全考虑，通常不建议将密码保存到服务器，除非有强加密措施。
        // 这里为了兼容性保留，但强烈建议后端和前端都只保存 host/port/username/name
        const serverData = { name: name || `${host}:${port}`, host, port, username, password };

        const response = await fetch('/api/servers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serverData)
        });
        const result = await response.json();

        if (result.success) {
            alertOk('已保存到服务器');
            // 同时也更新本地列表，保持同步
            // 注意：如果服务器返回了 ID，最好用服务器返回的完整数据更新本地
            saveToLocal(host, port, username, ''); // 本地也保存，但密码留空或也保存（取决于策略）
            return true;
        } else {
            alertErr('保存到服务器失败: ' + result.message);
            return false;
        }
    } catch (error) {
        alertErr('保存到服务器失败: ' + error.message);
        return false;
    }
}

// 手动保存到服务器
function manuallySaveToServer() {
    const host = document.getElementById('host').value.trim();
    const port = parseInt(document.getElementById('port').value, 10) || 22;
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value; // 通常不建议手动保存密码
    if (!host || !username) {
        alertWarn('请先填写主机地址和用户名');
        return;
    }
    saveToServer(host, port, username, password);
}

function disconnectSSH(){
    if (!stompClient) return;
    stompClient.send('/app/ssh/disconnect', {}, JSON.stringify({}));
    document.getElementById('disconnectBtn').disabled = true;
    alertInfo('已发送断开请求');
    // 主动断开后也停止延迟探测
    stopLatencyProbe();
}

async function testConnection() {
    const host = document.getElementById('host').value.trim();
    const port = parseInt(document.getElementById('port').value, 10) || 22;
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (!host || !username) return alertWarn('请填写主机与用户名');
    try {
        const res = await fetch('/api/servers/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, username, password })
        });
        const data = await res.json();
        if (data.success) {
            alertOk('连接测试成功');
        } else {
            alertErr('连接测试失败: ' + data.message);
        }
    } catch (err) {
        alertErr('请求失败: ' + err.message);
    }
}

async function fetchServers() {
    try {
        const res = await fetch('/api/servers');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const servers = await res.json();

        // === 添加这部分：将远程服务器填充到首页下拉列表 ===
        // 注意：这里需要决定是 *替换* 本地列表还是 *合并* 本地列表
        // 当前逻辑：用远程列表替换下拉列表内容
        const sel = document.getElementById('savedServers');
        if (sel) { // 确保元素存在
            sel.innerHTML = '<option value="">选择已保存的服务器...</option>';
            servers.forEach((s, idx) => {
                // 注意：这里的 value 和 loadSavedServers 略有不同，
                // 可以用索引，也可以用服务器ID，关键是要和 loadServerConfig 匹配
                // 这里暂时用索引加一个偏移量来区分远程和本地？或者用不同的标识？
                // 简单起见，先用索引，但 loadServerConfig 需要能处理
                // 更好的方式可能是统一数据结构或在 option 上加属性标识来源
                const opt = document.createElement('option');
                opt.value = `remote_${s.id}`; // 使用 remote_ 前缀和服务器ID区分
                opt.textContent = `${s.name || s.host}:${s.port} (${s.username})`;
                opt.dataset.server = JSON.stringify(s); // 存储完整数据
                sel.appendChild(opt);
            });
        }
        // ======================================================

        return servers;
    } catch (err) {
        console.error('加载服务器列表失败:', err);
        alertErr('无法连接服务器列表: ' + err.message);
        // 失败时仍可加载本地缓存
        loadSavedServers(); // 回退到加载本地
        return []; // 返回空数组
    }
}

// ===== Xterm tabs =====
function createNewTab(name){
    const tabId = 'tab-' + Date.now();
    const terminalSettings = loadTerminalSettings();
    // 创建终端时不设置 theme
    const term = new Terminal({
        cursorBlink: true,
        fontSize: terminalSettings.fontSize,
    });
    const fitAddon = new FitAddon.FitAddon();
    const searchAddon = new SearchAddon.SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);

    // --- 新增：根据当前全局主题立即设置终端主题 ---
    const isLight = document.body.classList.contains('theme-light');
    term.options.theme = isLight ? TERMINAL_THEMES.light : TERMINAL_THEMES.dark; // 应用初始主题

    // Tabs UI
    const tabEl = document.createElement('div');
    tabEl.className = 'tab active';
    tabEl.dataset.id = tabId;
    tabEl.innerHTML = `<i class="fa fa-terminal"></i><span>${name || 'SSH'}</span> <i class="fa fa-xmark close"></i>`;
    tabEl.addEventListener('click', (e) => {
        if (e.target && e.target.classList.contains('close')) { closeTab(tabId); e.stopPropagation(); return; }
        activateTab(tabId);
    });
    document.getElementById('terminalTabs').appendChild(tabEl);

    const pane = document.createElement('div');
    pane.className = 'term-pane';
    pane.id = tabId;
    document.getElementById('terminalStage').appendChild(pane);

    term.open(pane);
    fitAddon.fit();

    // 输入 → 发送到后端
    term.onData(data => {
        if (stompClient && connected) {
            stompClient.send('/app/ssh/input', {}, JSON.stringify({ data }));
        }
    });

    tabs.push({ id: tabId, name: name || 'SSH', term, fitAddon, searchAddon });
    activateTab(tabId);

    // 添加resize监听，确保终端适应窗口
    window.addEventListener('resize', () => {
        if (isFullscreen) {
            fitAddon.fit();
        } else {
            fitActiveTerminal();
        }
        updateStatus(term);
        // 可选：告诉后端窗口大小
        if (stompClient && connected) {
            stompClient.send('/app/ssh/resize', {}, JSON.stringify({ cols: term.cols, rows: term.rows }));
        }
    });
}

function activateTab(tabId){
    activeTab = tabId;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.id === tabId));
    document.querySelectorAll('.term-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
    const t = tabs.find(x => x.id === tabId);
    if (t) {
        t.fitAddon.fit();
        updateStatus(t.term);
    }
}

function closeTab(tabId){
    const idx = tabs.findIndex(x => x.id === tabId);
    if (idx === -1) return;
    const t = tabs[idx];
    t.term.dispose();
    document.querySelector(`.tab[data-id="${tabId}"]`)?.remove();
    document.getElementById(tabId)?.remove();
    tabs.splice(idx,1);
    if (activeTab === tabId) {
        if (tabs.length) activateTab(tabs[tabs.length-1].id); else activeTab = null;
    }
}

// 全屏终端功能
/* function fitActiveTerminal(){
     const t = getActive();
     if (!t) return;
     // 如果当前是全屏模式，直接适配全屏
     if (isFullscreen) {
         t.fitAddon.fit();
         updateStatus(t.term);
         return;
     }
     // 否则适配当前窗口
     t.fitAddon.fit();
     updateStatus(t.term);
     // 发送窗口大小调整消息到后端
     if (stompClient && connected) {
         stompClient.send('/app/ssh/resize', {}, JSON.stringify({
             cols: t.term.cols,
             rows: t.term.rows
         }));
     }
 }*/
// 重写适配窗口函数为切换全屏 (恢复原始功能)
function fitActiveTerminal() {
    toggleFullscreen();
}

// 切换全屏模式
function toggleFullscreen() {
    const terminalContainer = document.getElementById('terminal-container');
    if (!isFullscreen) {
        // 进入全屏模式
        terminalContainer.classList.add('fullscreen-terminal');
        document.querySelector('[onclick="fitActiveTerminal()"]').innerHTML = '<i class="fa fa-compress"></i> 退出全屏';
        isFullscreen = true;
    } else {
        // 退出全屏模式
        terminalContainer.classList.remove('fullscreen-terminal');
        document.querySelector('[onclick="fitActiveTerminal()"]').innerHTML = '<i class="fa fa-expand"></i> 全屏终端';
        isFullscreen = false;
    }
    // 适配终端大小
    setTimeout(() => {
        const t = getActive();
        if (t) {
            t.fitAddon.fit();
            updateStatus(t.term);
            // 发送窗口大小调整消息到后端
            if (stompClient && connected) {
                stompClient.send('/app/ssh/resize', {}, JSON.stringify({
                    cols: t.term.cols,
                    rows: t.term.rows
                }));
            }
        }
    }, 100);
}

function clearActive(){
    const t = getActive();
    if (!t) return;
    t.term.clear();
}

// ===== 搜索栏与搜索功能 =====
function showSearchBar() {
    const bar = document.getElementById('termSearchBar');
    if (!bar) return;
    bar.classList.remove('hidden');
    const input = document.getElementById('termSearchInput');
    if (input) {
        input.focus();
        input.select();
    }
}

function hideSearchBar() {
    const bar = document.getElementById('termSearchBar');
    if (!bar) return;
    bar.classList.add('hidden');
}

function doSearchNext() {
    const t = getActive();
    if (!t) return;
    const q = document.getElementById('termSearchInput')?.value || '';
    if (!q) return;
    try { t.searchAddon.findNext(q); } catch (e) { console.warn(e); }
}

function doSearchPrev() {
    const t = getActive();
    if (!t) return;
    const q = document.getElementById('termSearchInput')?.value || '';
    if (!q) return;
    try { t.searchAddon.findPrevious(q); } catch (e) { console.warn(e); }
}

function getActive(){
    return tabs.find(x => x.id === activeTab);
}

function appendOutput(text){
    const t = getActive();
    if (!t) return;
    t.term.write(text);
    updateStatus(t.term);
}

function updateStatus(term){
    document.getElementById('statusLeft').textContent = connected ? '在线' : '离线';
    document.getElementById('statusRight').textContent = `行: ${term.rows}, 列: ${term.cols}`;
}

// ===== 文件管理功能 (优化版) =====

// 预定义文件类型图标映射 (提升性能)
const FILE_TYPE_ICONS = {
    // 图片
    'image': ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'],
    // 文档
    'document': ['txt', 'log', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
    // 压缩包
    'archive': ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
    // 视频
    'video': ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm'],
    // 音频
    'audio': ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
    // 代码
    'code': ['js', 'ts', 'html', 'css', 'java', 'py', 'cpp', 'c', 'h', 'php', 'rb', 'go', 'rs', 'sh', 'sql']
};

// 获取文件图标类名
function getFileIconClass(filename, isDirectory) {
    if (isDirectory) {
        return 'fa fa-folder';
    }

    const ext = filename.split('.').pop().toLowerCase();
    for (const [type, extensions] of Object.entries(FILE_TYPE_ICONS)) {
        if (extensions.includes(ext)) {
            switch (type) {
                case 'image': return 'fa fa-image';
                case 'document': return 'fa fa-file-alt';
                case 'archive': return 'fa fa-file-archive';
                case 'video': return 'fa fa-file-video';
                case 'audio': return 'fa fa-file-audio';
                case 'code': return 'fa fa-file-code';
                default: break; // 继续循环
            }
        }
    }
    // 默认文件图标
    return 'fa fa-file';
}

// 为特定服务器打开文件管理器
function openFileManagerForServer(server) {
    currentFileManagerServer = server;
    document.getElementById('fileManagerServerName').textContent = server.name || `${server.host}:${server.port}`;
    currentPath = "/";
    updatePathDisplay(currentPath); // 更新路径显示
    document.getElementById('fileManagerModal').classList.remove('hidden');
    listFiles();
}

// 更新路径显示
function updatePathDisplay(path) {
    const displayElement = document.getElementById('currentPathDisplay');
    const inputElement = document.getElementById('currentPathInput');
    displayElement.textContent = path;
    displayElement.title = `点击跳转到: ${path}`;
    inputElement.value = path; // 同步输入框值
}

// 激活路径输入框
function activatePathInput() {
    const displayElement = document.getElementById('currentPathDisplay');
    const inputElement = document.getElementById('currentPathInput');
    displayElement.classList.add('hidden');
    inputElement.classList.remove('hidden');
    inputElement.focus();
    inputElement.select(); // 选中所有文本方便编辑
}

// 停用路径输入框
function deactivatePathInput() {
    const displayElement = document.getElementById('currentPathDisplay');
    const inputElement = document.getElementById('currentPathInput');
    displayElement.classList.remove('hidden');
    inputElement.classList.add('hidden');
}

// 列出文件 (优化版)
async function listFiles(path = currentPath) {
    if (!currentFileManagerServer) {
        alertErr('未选择服务器');
        return;
    }
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '<div class="alert info">正在加载文件列表...</div>';

    currentPath = path;
    updatePathDisplay(currentPath);

    // 清除之前的多选状态
    selectedFiles.clear();
    lastSelectedFile = null;
    updateMultiSelectToolbar();

    try {
        const response = await fetch(`/api/servers/${currentFileManagerServer.id}/files?path=${encodeURIComponent(path)}`);
        const result = await response.json();
        if (!result.success) {
            fileList.innerHTML = `<div class="alert error">加载失败: ${result.message}</div>`;
            return;
        }
        const files = result.data || [];
        displayFilesOptimized(files);
    } catch (error) {
        fileList.innerHTML = `<div class="alert error">请求失败: ${error.message}</div>`;
    }
}

// 文件列表显示函数，支持多选
function displayFilesOptimized(files) {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';
    if (files.length === 0) {
        fileList.innerHTML = '<div class="alert info">此目录为空</div>';
        updateMultiSelectToolbar(); // 确保工具栏状态正确
        return;
    }

    const fragment = document.createDocumentFragment();
    files.forEach(file => {
        const card = document.createElement('div');
        card.className = `file-card ${file.isDirectory ? 'directory' : 'file'}`;
        card.dataset.name = file.name;
        card.dataset.isDirectory = file.isDirectory;
        // 添加数据属性存储详细信息 (如果后端提供了)
        if (file.size !== undefined) card.dataset.size = file.size;
        if (file.lastModified) card.dataset.lastModified = file.lastModified;
        if (file.permissions) card.dataset.permissions = file.permissions;

        const iconClass = getFileIconClass(file.name, file.isDirectory);
        card.innerHTML = `
            <div class="icon"><i class="${iconClass}"></i></div>
            <div class="name">${file.name}</div>
        `;
        fragment.appendChild(card);
    });
    fileList.appendChild(fragment);

    // 更新选中状态 (如果之前有选中)
    updateFileCardSelectionUI();

    // 使用事件委托处理点击、右键菜单和多选
    fileList.removeEventListener('click', handleFileClick);
    fileList.removeEventListener('contextmenu', handleFileContextMenu);
    fileList.addEventListener('click', handleFileClick);
    fileList.addEventListener('contextmenu', handleFileContextMenu);
}

// 文件点击事件处理函数 (事件委托)
function handleFileClick(e) {
    document.getElementById('fileContextMenu').classList.remove('show');

    let targetCard = e.target.closest('.file-card');
    if (!targetCard) return;

    const filename = targetCard.dataset.name;
    const isCtrlPressed = e.ctrlKey || e.metaKey; // 兼容 Mac
    const isShiftPressed = e.shiftKey;

    if (isShiftPressed && lastSelectedFile) {
        // Shift 选择: 选择从 lastSelectedFile 到当前文件的范围
        performShiftSelect(filename);
    } else if (isCtrlPressed) {
        // Ctrl 选择: 切换单个文件选中状态
        if (selectedFiles.has(filename)) {
            selectedFiles.delete(filename);
        } else {
            selectedFiles.add(filename);
        }
        lastSelectedFile = filename;
    } else {
        // 普通点击: 清除之前选择，只选中当前文件
        selectedFiles.clear();
        selectedFiles.add(filename);
        lastSelectedFile = filename;
    }

    updateFileCardSelectionUI();
    updateMultiSelectToolbar();
}

// 执行 Shift 选择
function performShiftSelect(currentFilename) {
    const allCards = Array.from(document.querySelectorAll('#fileList .file-card'));
    const allNames = allCards.map(card => card.dataset.name);
    const lastIndex = allNames.indexOf(lastSelectedFile);
    const currentIndex = allNames.indexOf(currentFilename);

    if (lastIndex === -1 || currentIndex === -1) return; // 安全检查

    const [start, end] = lastIndex < currentIndex ? [lastIndex, currentIndex] : [currentIndex, lastIndex];

    selectedFiles.clear();
    for (let i = start; i <= end; i++) {
        selectedFiles.add(allNames[i]);
    }
}

// 更新文件卡片的 UI 选中状态
function updateFileCardSelectionUI() {
    document.querySelectorAll('#fileList .file-card').forEach(card => {
        const name = card.dataset.name;
        if (selectedFiles.has(name)) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
}

// 更新多选工具栏
function updateMultiSelectToolbar() {
    const toolbar = document.getElementById('fileMultiSelectToolbar');
    const countSpan = document.getElementById('selectedCount');
    const count = selectedFiles.size;

    if (count > 0) {
        toolbar.classList.remove('hidden');
        countSpan.textContent = `已选择 ${count} 项`;
    } else {
        toolbar.classList.add('hidden');
        countSpan.textContent = '已选择 0 项';
    }
}

// 清除文件选择
function clearFileSelection() {
    selectedFiles.clear();
    lastSelectedFile = null;
    updateFileCardSelectionUI();
    updateMultiSelectToolbar();
    document.getElementById('fileContextMenu').classList.remove('show');
}

// 批量删除
async function bulkDeleteSelectedFiles() {
    if (selectedFiles.size === 0 || !currentFileManagerServer) {
        alertWarn('请先选择文件或目录');
        return;
    }

    const count = selectedFiles.size;
    if (!confirm(`确定要删除选中的 ${count} 项吗?`)) {
        return;
    }

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    // 创建一个包含所有删除 Promise 的数组
    const deletePromises = Array.from(selectedFiles).map(filename => {
        const fullPath = currentPath === '/' ? `/${filename}` : `${currentPath}/${filename}`;
        const isDirectory = document.querySelector(`.file-card[data-name="${CSS.escape(filename)}"]`).dataset.isDirectory === 'true';

        return fetch(`/api/servers/${currentFileManagerServer.id}/file`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: fullPath, isDirectory: isDirectory })
        })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    successCount++;
                } else {
                    failCount++;
                    errors.push(`${filename}: ${result.message}`);
                }
            })
            .catch(error => {
                failCount++;
                errors.push(`${filename}: ${error.message}`);
            });
    });

    try {
        // 等待所有删除操作完成
        await Promise.all(deletePromises);

        if (failCount === 0) {
            alertOk(`成功删除 ${successCount} 项`);
        } else {
            const errorMsg = `删除完成。成功: ${successCount}, 失败: ${failCount}。\n部分错误:\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}`;
            alertErr(errorMsg);
        }

        clearFileSelection(); // 清除选择
        listFiles(currentPath); // 刷新列表

    } catch (error) {
        alertErr('批量删除过程中发生未知错误: ' + error.message);
    }
}

// 批量下载 (简单实现：逐个触发下载)
function bulkDownloadSelectedFiles() {
    if (selectedFiles.size === 0 || !currentFileManagerServer) {
        alertWarn('请先选择文件');
        return;
    }

    let fileCount = 0;
    selectedFiles.forEach(filename => {
        // 检查是否为文件 (简单检查)
        const card = document.querySelector(`.file-card[data-name="${CSS.escape(filename)}"]`);
        if (card && card.dataset.isDirectory !== 'true') {
            fileCount++;
            const fullPath = currentPath === '/' ? `/${filename}` : `${currentPath}/${filename}`;
            const url = `/api/servers/${currentFileManagerServer.id}/download?path=${encodeURIComponent(fullPath)}`;
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    });

    if (fileCount === 0) {
        alertWarn('请选择至少一个文件进行下载');
    } else {
        alertOk(`已触发下载 ${fileCount} 个文件。浏览器可能会阻止多个下载弹窗，请允许。`);
    }
}

// 文件右键菜单事件处理函数 (事件委托)
function handleFileContextMenu(e) {
    e.preventDefault();

    let targetCard = e.target.closest('.file-card');
    if (!targetCard) return;

    const filename = targetCard.dataset.name;
    // 如果右键点击的文件未被选中，则清空选择并选中它
    if (!selectedFiles.has(filename)) {
        selectedFiles.clear();
        selectedFiles.add(filename);
        lastSelectedFile = filename;
        updateFileCardSelectionUI();
        updateMultiSelectToolbar();
    }
    // 如果已经选中（包括多选），则保持当前选择

    // 更新 selectedFile 为当前右键点击的文件，以便上下文菜单操作针对它
    selectedFile = {
        name: filename,
        isDirectory: targetCard.dataset.isDirectory === 'true',
        // 可以从 dataset 获取其他信息
        size: targetCard.dataset.size,
        lastModified: targetCard.dataset.lastModified,
        permissions: targetCard.dataset.permissions
    };

    // 高亮当前右键点击的卡片 (可选)
    document.querySelectorAll('.file-card').forEach(c => c.classList.remove('context-menu-target'));
    targetCard.classList.add('context-menu-target'); // 需要添加对应 CSS

    const menu = document.getElementById('fileContextMenu');
    menu.style.top = `${e.clientY}px`;
    menu.style.left = `${e.clientX}px`;
    menu.classList.add('show');
}

// 显示文件信息 (简单版本，使用 alert)
function showFileInfo() {
    // 隐藏上下文菜单
    document.getElementById('fileContextMenu').classList.remove('show');

    if (!selectedFile) {
        alertWarn('请先选择一个文件或目录');
        console.warn("showFileInfo called, but selectedFile is null/undefined.");
        return;
    }

    const modal = document.getElementById('fileInfoModal');
    const titleElement = document.getElementById('fileInfoTitle');
    const nameElement = document.getElementById('infoFileName');
    const typeElement = document.getElementById('infoFileType');
    const sizeElement = document.getElementById('infoFileSize');
    const modifiedElement = document.getElementById('infoFileModified');
    const permissionsElement = document.getElementById('infoFilePermissions');

    // 基本的安全检查
    if (!modal || !titleElement || !nameElement || !typeElement || !sizeElement || !modifiedElement || !permissionsElement) {
        alertErr('文件信息模态框元素未找到');
        console.error("File info modal elements not found in DOM.");
        return;
    }

    // 设置模态框标题
    titleElement.textContent = `文件属性: ${selectedFile.name}`;

    // 填充模态框内容
    nameElement.textContent = selectedFile.name || '-';

    typeElement.textContent = selectedFile.isDirectory ? '目录' : '文件';

    if (selectedFile.size !== undefined && selectedFile.size !== null) {
        sizeElement.textContent = formatFileSize(selectedFile.size);
    } else {
        sizeElement.textContent = '未知';
    }

    // --- 修复时间戳显示 ---
    if (selectedFile.lastModified !== undefined && selectedFile.lastModified !== null) {
        let date;
        // 尝试处理不同格式的时间戳
        if (typeof selectedFile.lastModified === 'number') {
            // 假设是毫秒时间戳
            date = new Date(selectedFile.lastModified);
        } else if (typeof selectedFile.lastModified === 'string') {
            // 尝试解析字符串时间戳
            const num = Number(selectedFile.lastModified);
            if (!isNaN(num)) {
                // 如果字符串能转成数字，假设是毫秒时间戳
                date = new Date(num);
            } else {
                // 否则尝试解析 ISO 字符串或其他格式
                date = new Date(selectedFile.lastModified);
            }
        } else {
            // 其他情况，直接尝试用 Date 构造函数
            date = new Date(selectedFile.lastModified);
        }

        if (date && !isNaN(date.getTime())) {
            modifiedElement.textContent = date.toLocaleString(); // 使用本地化格式
        } else {
            modifiedElement.textContent = `格式无效 (${selectedFile.lastModified})`;
        }
    } else {
        modifiedElement.textContent = '未知';
    }
    // --- /修复时间戳显示 ---

    permissionsElement.textContent = selectedFile.permissions || '未知';

    // 显示模态框
    modal.classList.remove('hidden');
}

// 关闭文件信息模态框
function closeFileInfoModal() {
    const modal = document.getElementById('fileInfoModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 全局点击事件监听器，用于隐藏上下文菜单和处理路径输入
document.removeEventListener('click', handleGlobalClick); // 移除可能的旧监听器
document.addEventListener('click', handleGlobalClick);

function handleGlobalClick(e) {
    // 隐藏上下文菜单 (如果点击的不是菜单本身或文件卡片)
    if (!e.target.closest('.file-context-menu') && !e.target.closest('.file-card')) {
        document.getElementById('fileContextMenu').classList.remove('show');
        // 可选：取消选中文件
        // selectedFile = null;
        // document.querySelectorAll('.file-card').forEach(c => c.classList.remove('selected'));
    }

    // 处理路径输入框失去焦点 (如果点击的不是路径相关元素)
    const pathDisplay = document.getElementById('currentPathDisplay');
    const pathInput = document.getElementById('currentPathInput');
    if (!pathDisplay.contains(e.target) && !pathInput.contains(e.target)) {
        // 如果输入框是可见的，则尝试跳转并隐藏它
        if (!pathInput.classList.contains('hidden')) {
            const newPath = pathInput.value.trim();
            if (newPath && newPath !== currentPath) {
                listFiles(newPath); // 尝试跳转到新路径
            }
            deactivatePathInput(); // 无论如何都隐藏输入框
        }
    }
}

// 路径输入框按键处理
document.getElementById('currentPathInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        const newPath = this.value.trim();
        if (newPath && newPath !== currentPath) {
            listFiles(newPath); // 尝试跳转到新路径
        }
        deactivatePathInput(); // 跳转后隐藏输入框
    } else if (e.key === 'Escape') {
        // ESC 键取消编辑
        deactivatePathInput();
        updatePathDisplay(currentPath); // 恢复显示原始路径
    }
});

// 刷新文件管理器
function refreshFileManager() {
    listFiles(currentPath);
}

// 返回上级目录 (保持不变)
function goToParentDirectory() {
    if (currentPath === '/') return;

    const parts = currentPath.split('/').filter(p => p);
    parts.pop(); // 移除最后一个部分
    const newPath = parts.length > 0 ? '/' + parts.join('/') : '/';

    listFiles(newPath);
}

// ===== 文件操作函数 (保持不变或微调) =====

// 刷新文件页面的服务器列表
async function refreshFilesPage() {
    const container = document.getElementById('filesServerList');
    container.innerHTML = '<div class="alert info">正在加载服务器列表...</div>';

    try {
        const servers = await fetchServers();

        if (servers.length === 0) {
            container.innerHTML = '<div class="alert warn">暂无服务器配置，请先在 SSH 连接页面添加服务器。</div>';
            return;
        }

        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'grid cols-2';

        servers.forEach(server => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                    <div class="card-hd">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <i class="fa fa-server"></i>
                            <b>${server.name || `${server.host}:${server.port}`}</b>
                        </div>
                    </div>
                    <div class="card-bd">
                        <div style="margin-bottom: 15px;">
                            <div><strong>地址:</strong> ${server.host}:${server.port}</div>
                            <div><strong>用户:</strong> ${server.username}</div>
                        </div>
                        <div class="text-right">
                            <button class="btn primary" onclick='openFileManagerForServer(${JSON.stringify(server).replace(/'/g, "\\'")})'>
                                <i class="fa fa-folder-open"></i> 管理文件
                            </button>
                        </div>
                    </div>
                `;
            grid.appendChild(card);
        });

        container.appendChild(grid);
    } catch (error) {
        container.innerHTML = `<div class="alert error">加载服务器列表失败: ${error.message}</div>`;
    }
}

// 关闭文件管理器
function closeFileManager() {
    document.getElementById('fileManagerModal').classList.add('hidden');
    currentFileManagerServer = null;
    selectedFile = null;
    selectedFiles.clear(); // 清除多选
    lastSelectedFile = null;
    updateMultiSelectToolbar(); // 隐藏工具栏
    document.getElementById('fileContextMenu').classList.remove('show');
}

// 下载选中的文件
function downloadSelectedFile() {
    if (!selectedFile || !currentFileManagerServer) {
        alertWarn('请先选择一个文件');
        // 隐藏菜单
        document.getElementById('fileContextMenu').classList.remove('show');
        return;
    }

    if (selectedFile.isDirectory) {
        alertWarn('不能下载目录');
        // 隐藏菜单
        document.getElementById('fileContextMenu').classList.remove('show');
        return;
    }

    const fullPath = currentPath === '/' ? `/${selectedFile.name}` : `${currentPath}/${selectedFile.name}`;
    const url = `/api/servers/${currentFileManagerServer.id}/download?path=${encodeURIComponent(fullPath)}`;

    // 创建一个隐藏的下载链接并点击它
    const link = document.createElement('a');
    link.href = url;
    link.download = selectedFile.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 隐藏菜单
    document.getElementById('fileContextMenu').classList.remove('show');
}

// 删除选中的文件/目录
async function deleteSelectedFile() {
    if (!selectedFile || !currentFileManagerServer) {
        alertWarn('请先选择一个文件或目录');
        // 隐藏菜单
        document.getElementById('fileContextMenu').classList.remove('show');
        return;
    }

    if (!confirm(`确定要删除 "${selectedFile.name}" 吗?`)) {
        // 隐藏菜单
        document.getElementById('fileContextMenu').classList.remove('show');
        return;
    }

    const fullPath = currentPath === '/' ? `/${selectedFile.name}` : `${currentPath}/${selectedFile.name}`;

    try {
        // 注意：这里假设后端 Controller 已经修改为使用 @RequestBody DeleteRequest
        const response = await fetch(`/api/servers/${currentFileManagerServer.id}/file`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: fullPath,
                isDirectory: selectedFile.isDirectory
            })
        });

        const result = await response.json();
        if (result.success) {
            alertOk('删除成功');
            listFiles(currentPath); // 刷新当前目录
        } else {
            alertErr('删除失败: ' + result.message);
        }
    } catch (error) {
        alertErr('请求失败: ' + error.message);
    }

    // 隐藏菜单
    document.getElementById('fileContextMenu').classList.remove('show');
}

// 重命名选中的文件/目录
async function renameSelectedFile() {
    if (!selectedFile || !currentFileManagerServer) {
        alertWarn('请先选择一个文件或目录');
        // 隐藏菜单
        document.getElementById('fileContextMenu').classList.remove('show');
        return;
    }

    const newName = prompt('请输入新的名称:', selectedFile.name);
    if (!newName || newName === selectedFile.name) {
        // 隐藏菜单
        document.getElementById('fileContextMenu').classList.remove('show');
        return;
    }

    const oldPath = currentPath === '/' ? `/${selectedFile.name}` : `${currentPath}/${selectedFile.name}`;
    const newPath = currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;

    try {
        // 注意：这里假设后端 Controller 已经修改为使用 @RequestBody RenameRequest
        const response = await fetch(`/api/servers/${currentFileManagerServer.id}/rename`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                oldPath: oldPath,
                newPath: newPath
            })
        });

        const result = await response.json();
        if (result.success) {
            alertOk('重命名成功');
            listFiles(currentPath); // 刷新当前目录
        } else {
            alertErr('重命名失败: ' + result.message);
        }
    } catch (error) {
        alertErr('请求失败: ' + error.message);
    }

    // 隐藏菜单
    document.getElementById('fileContextMenu').classList.remove('show');
}

// 显示上传模态框
function showUploadModal() {
    if (!currentFileManagerServer) {
        alertErr('未选择服务器');
        return;
    }
    document.getElementById('uploadPath').value = currentPath;
    document.getElementById("uploadModal").classList.remove("hidden");
}

// 关闭上传模态框
function closeUploadModal() {
    document.getElementById('uploadModal').classList.add('hidden');
    document.getElementById('uploadFiles').value = '';
}

// 处理文件上传
async function handleUpload() {
    const fileInput = document.getElementById('uploadFiles');
    const uploadPath = document.getElementById('uploadPath').value;
    const files = fileInput.files;

    if (files.length === 0) {
        alertWarn('请选择要上传的文件');
        return;
    }

    if (!currentFileManagerServer) {
        alertErr('未选择服务器');
        return;
    }

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }
    formData.append('path', uploadPath);

    try {
        const response = await fetch(`/api/servers/${currentFileManagerServer.id}/upload`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (data.success) {
            alertOk(`成功上传 ${files.length} 个文件`);
            closeUploadModal();
            listFiles(uploadPath); // 刷新文件列表
        } else {
            alertErr('上传失败: ' + data.message);
        }
    } catch (err) {
        alertErr('请求失败: ' + err.message);
    }
}

// --- 在脚本开头或合适位置定义默认设置 ---
const DEFAULT_TERMINAL_SETTINGS = {
    fontFamily: 'monospace',
    fontSize: 14
};

// --- 添加保存和加载设置的函数 ---
function saveTerminalSettings() {
    const settings = {
        fontFamily: document.getElementById('terminalFontFamily').value,
        fontSize: parseInt(document.getElementById('terminalFontSize').value, 10)
    };
    localStorage.setItem('webssh-terminal-settings', JSON.stringify(settings));
}

function loadTerminalSettings() {
    const savedSettings = localStorage.getItem('webssh-terminal-settings');
    let settings;
    if (savedSettings) {
        try {
            settings = JSON.parse(savedSettings);
        } catch (e) {
            console.error("Failed to parse saved terminal settings:", e);
            settings = DEFAULT_TERMINAL_SETTINGS;
        }
    } else {
        settings = DEFAULT_TERMINAL_SETTINGS;
    }
    document.getElementById('terminalFontFamily').value = settings.fontFamily;
    document.getElementById('terminalFontSize').value = settings.fontSize;
    return settings;
}

// --- 添加应用设置的函数 ---
function applyTerminalSettings() {
    saveTerminalSettings(); // 保存到 localStorage
    alertOk('设置已保存。新终端将使用新设置。');
    // 注意：要将设置应用到已存在的终端，需要更新所有 tabs 中的 term.options
    // 这是一个更复杂的操作，通常需要重新创建终端或逐一更新。
    // 这里仅保存设置，供后续新建的终端使用。
    // 如果需要更新现有终端，可以考虑添加一个 "重新加载所有终端" 的功能。
}

// 显示新建目录模态框
function showCreateDirModal() {
    if (!currentFileManagerServer) {
        alertErr('未选择服务器');
        return;
    }
    document.getElementById('newDirName').value = '';
    document.getElementById('createDirModal').classList.remove('hidden');
}

// 关闭新建目录模态框
function closeCreateDirModal() {
    document.getElementById('createDirModal').classList.add('hidden');
}

// 创建目录
async function createDirectory() {
    if (!currentFileManagerServer) {
        alertErr('未选择服务器');
        return;
    }

    const dirName = document.getElementById('newDirName').value.trim();
    if (!dirName) {
        alertWarn('请输入目录名称');
        return;
    }

    const fullPath = currentPath === '/' ? `/${dirName}` : `${currentPath}/${dirName}`;

    try {
        const response = await fetch(`/api/servers/${currentFileManagerServer.id}/mkdir`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: fullPath })
        });

        const result = await response.json();
        if (result.success) {
            alertOk('目录创建成功');
            closeCreateDirModal();
            listFiles(currentPath); // 刷新当前目录
        } else {
            alertErr('创建目录失败: ' + result.message);
        }
    } catch (error) {
        alertErr('请求失败: ' + error.message);
    }
}

// ===== 仪表盘功能 (Dashboard Functions) =====

// 仪表盘状态
let currentDashboardServerId = null;

// 修改 switchPage 函数以支持仪表盘
// (找到您现有的 switchPage 函数并替换或修改它)
/*
function switchPage(page, el) {
    document.querySelectorAll('.nav .item').forEach(n => n.classList.remove('active'));
    if (el) el.classList.add('active');
    ['ssh','dashboard','files','settings'].forEach(p => { // 确保 'dashboard' 在数组中
        const sec = document.getElementById('page-'+p);
        if (!sec) return;
        if (p === page) {
            sec.classList.remove('hidden');
            // 如果切换到仪表盘页面，刷新服务器列表
            if (p === 'dashboard') {
                 // 确保 populateDashboardServerSelect 在 DOM 加载后可用
                 if (document.readyState === 'loading') {
                     document.addEventListener('DOMContentLoaded', populateDashboardServerSelect);
                 } else {
                     populateDashboardServerSelect();
                 }
            }
        } else {
            sec.classList.add('hidden');
        }
    });
    // 移除或注释掉旧的 if (page === 'files') {...} 逻辑
}
*/

// 如果您不想修改原始的 switchPage，可以添加一个专门用于仪表盘的函数
/*function switchToDashboard(el) {
    switchPage('dashboard', el);
    // 确保 populateDashboardServerSelect 在 DOM 加载后可用
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', populateDashboardServerSelect);
    } else {
        populateDashboardServerSelect();
    }
}*/

// 填充仪表盘服务器选择下拉框
async function populateDashboardServerSelect() {
    const selectElement = document.getElementById('dashboardServerSelect');
    if (!selectElement) {
        console.warn("Dashboard server select element not found.");
        return; // 如果页面未加载或元素不存在，则退出
    }
    const currentSelection = selectElement.value;
    selectElement.innerHTML = '<option value="">加载中...</option>';

    try {
        const servers = await fetchServers(); // 使用已有的函数获取服务器列表
        selectElement.innerHTML = '<option value="">选择服务器...</option>';
        servers.forEach(server => {
            const option = document.createElement('option');
            option.value = server.id;
            // 检查 server.name 是否为 null 或空字符串
            option.textContent = server.name ? server.name : `${server.host}:${server.port}`;
            selectElement.appendChild(option);
        });
        // 恢复之前的选择（如果服务器列表没有变化）
        if (currentSelection && servers.some(s => s.id == currentSelection)) {
            selectElement.value = currentSelection;
        }
    } catch (error) {
        console.error('填充仪表盘服务器列表失败:', error);
        selectElement.innerHTML = '<option value="">加载失败</option>';
        alertErr('无法加载服务器列表用于仪表盘: ' + error.message);
    }
}

// 加载并显示仪表盘数据
async function loadDashboardData() {
    const serverId = document.getElementById('dashboardServerSelect').value;
    const contentDiv = document.getElementById('dashboardContent');

    if (!serverId) {
        contentDiv.innerHTML = `
            <div class="dashboard-error">
                <i class="fa fa-exclamation-circle"></i>
                <p>请先选择一个服务器。</p>
            </div>
        `;
        return;
    }

    currentDashboardServerId = serverId;
    contentDiv.innerHTML = `
        <div class="dashboard-loading">
            <i class="fa fa-spinner fa-spin"></i>
            <p>正在加载仪表盘数据...</p>
        </div>
    `;

    try {
        // 并行获取指标和服务状态
        const [metricsRes, servicesRes] = await Promise.all([
            fetch(`/api/dashboard/server/${serverId}/metrics`),
            fetch(`/api/dashboard/server/${serverId}/services`)
            // 如果实现了历史数据，可以在这里添加 fetch(`/api/dashboard/server/${serverId}/history`)
        ]);

        if (!metricsRes.ok) {
            throw new Error(`获取指标失败 (HTTP ${metricsRes.status})`);
        }
        if (!servicesRes.ok) {
            throw new Error(`获取服务状态失败 (HTTP ${servicesRes.status})`);
        }

        const metricsData = await metricsRes.json();
        const servicesData = await servicesRes.json();

        if (!metricsData.success) {
            throw new Error(`获取指标失败: ${metricsData.message || '未知错误'}`);
        }
        if (!servicesData.success) {
            throw new Error(`获取服务状态失败: ${servicesData.message || '未知错误'}`);
        }

        renderDashboard(metricsData.data, servicesData.data); // 传递 .data

    } catch (error) {
        console.error('加载仪表盘数据失败:', error);
        contentDiv.innerHTML = `
            <div class="dashboard-error">
                <i class="fa fa-exclamation-triangle"></i>
                <p>加载仪表盘数据失败:</p>
                <p>${error.message}</p>
                <button class="btn ghost mt-16" onclick="loadDashboardData()"><i class="fa fa-sync"></i> 重试</button>
            </div>
        `;
    }
}

// 渲染仪表盘内容
// 渲染仪表盘内容 (增强版 - 支持 Docker 容器详情)
function renderDashboard(metrics, services) {
    const contentDiv = document.getElementById('dashboardContent');
    if (!metrics || typeof metrics !== 'object') {
        console.error("Invalid metrics data:", metrics);
        contentDiv.innerHTML = `<div class="dashboard-error"><i class="fa fa-exclamation-circle"></i><p>接收到无效的指标数据格式。</p></div>`;
        return;
    }
    if (!services || typeof services !== 'object') {
        console.error("Invalid services data:", services);
        contentDiv.innerHTML = `<div class="dashboard-error"><i class="fa fa-exclamation-circle"></i><p>接收到无效的服务状态数据格式。</p></div>`;
        return;
    }

    // --- 生成服务列表的 HTML，为 Docker 添加特殊 ID 和类 ---
    let serviceListHtml = '';
    let hasServices = false;
    for (const [serviceName, status] of Object.entries(services)) {
        if (serviceName === 'success' || serviceName === 'message') continue;
        hasServices = true;

        let serviceIcon = 'fa-cog';
        const lowerName = serviceName.toLowerCase();
        if (lowerName.includes('mysql') || lowerName.includes('sql')) serviceIcon = 'fa-database';
        else if (lowerName.includes('redis')) serviceIcon = 'fa-bolt';
        else if (lowerName.includes('docker')) serviceIcon = 'fa-box'; // Docker 图标

        let displayStatus = '未知';
        let statusClass = 'unknown';
        const lowerStatus = (status || '').toString().toLowerCase().trim();
        if (lowerStatus === 'active' || lowerStatus === 'running') {
            displayStatus = '运行中';
            statusClass = 'active';
        } else if (lowerStatus === 'inactive' || lowerStatus === 'dead' || lowerStatus === 'failed') {
            displayStatus = '已停止';
            statusClass = 'inactive';
        } else if (lowerStatus !== '') {
            displayStatus = lowerStatus;
        }

        // --- 为 Docker 服务项添加特殊属性 ---
        const isDocker = lowerName.includes('docker');
        const dataAttrs = isDocker ? `id="docker-service-item" class="docker-service-item" data-server-id="${currentDashboardServerId}"` : '';

        serviceListHtml += `
            <li class="service-status-item" ${dataAttrs}>
                <span class="service-name"><i class="fa ${serviceIcon}"></i> ${serviceName}</span>
                <span class="service-status ${statusClass}">${displayStatus}</span>
            </li>
        `;
    }
    if (!hasServices) {
        serviceListHtml = '<li class="service-status-item"><span>未配置监控服务</span></li>';
    }

    contentDiv.innerHTML = `
        <div class="dashboard-grid">
            <!-- CPU Widget -->
            <div class="dashboard-widget">
                <div class="dashboard-widget-header">
                    <h3><i class="fa fa-microchip"></i> CPU 使用率</h3>
                </div>
                <div class="dashboard-widget-content">
                    <div id="cpuChart" class="dashboard-chart-container"></div>
                </div>
            </div>

            <!-- Memory Widget -->
            <div class="dashboard-widget">
                <div class="dashboard-widget-header">
                    <h3><i class="fa fa-memory"></i> 内存使用率</h3>
                </div>
                <div class="dashboard-widget-content">
                    <div id="memoryChart" class="dashboard-chart-container"></div>
                </div>
            </div>

            <!-- Disk Widget -->
            <div class="dashboard-widget">
                <div class="dashboard-widget-header">
                    <h3><i class="fa fa-hard-drive"></i> 磁盘使用率</h3>
                </div>
                <div class="dashboard-widget-content">
                    <div id="diskChart" class="dashboard-chart-container"></div>
                </div>
            </div>

            <!-- Services Widget -->
            <div class="dashboard-widget">
                <div class="dashboard-widget-header">
                    <h3><i class="fa fa-cogs"></i> 服务状态</h3>
                </div>
                <div class="dashboard-widget-content">
                    <ul id="serviceStatusList" class="service-status-list">
                        ${serviceListHtml}
                    </ul>
                    <!-- Docker Containers Detail Section (初始隐藏) -->
                    <div id="dockerContainersDetail" class="docker-containers-detail hidden">
                        <div class="detail-header">
                            <h4><i class="fa fa-boxes"></i> Docker 容器</h4>
                            <button class="btn ghost btn-sm" id="refreshDockerBtn"><i class="fa fa-sync"></i> 刷新</button>
                        </div>
                        <div id="dockerContainersList" class="containers-list">
                            <div class="alert info">点击加载容器信息...</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // --- 初始化 ECharts 图表 ---
    let cpuChart, memoryChart, diskChart;
    try {
        cpuChart = echarts.init(document.getElementById('cpuChart'));
        memoryChart = echarts.init(document.getElementById('memoryChart'));
        diskChart = echarts.init(document.getElementById('diskChart'));
    } catch (initError) {
        console.error("初始化 ECharts 失败:", initError);
        contentDiv.innerHTML = `<div class="dashboard-error"><i class="fa fa-exclamation-circle"></i><p>ECharts 初始化失败。请检查库是否正确加载。</p></div>`;
        return;
    }

    // --- 配置并设置图表数据 ---
    const createGaugeOption = (title, value) => ({
        series: [{
            type: 'gauge',
            startAngle: 180,
            endAngle: 0,
            min: 0,
            max: 100,
            splitNumber: 5,
            axisLine: {
                lineStyle: {
                    width: 15,
                    color: [
                        [0.6, '#67e0e3'],
                        [0.8, '#ff9f7f'],
                        [1, '#ff6767']
                    ]
                }
            },
            pointer: {
                icon: 'path://M2.9,0.7L2.9,0.7c1.4,0,2.6,1.2,2.6,2.6v115c0,1.4-1.2,2.6-2.6,2.6l0,0c-1.4,0-2.6-1.2-2.6-2.6V3.3C0.3,1.9,1.4,0.7,2.9,0.7z',
                width: 8,
                length: '70%',
                offsetCenter: [0, '8%']
            },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: {
                show: true,
                distance: 25,
                color: '#999',
                fontSize: 12
            },
            detail: {
                show: true,
                offsetCenter: [0, '30%'],
                fontSize: 20,
                formatter: '{value}%',
                color: 'inherit'
            },
            title: {
                show: true,
                offsetCenter: [0, '70%'],
                fontSize: 14,
                color: '#999'
            },
            data: [{ value: value, name: title }]
        }]
    });

    const cpuValue = (metrics.cpu !== undefined && metrics.cpu >= 0) ? metrics.cpu : 0;
    const memValue = (metrics.memory !== undefined && metrics.memory >= 0) ? metrics.memory : 0;
    const diskValue = (metrics.disk !== undefined && metrics.disk >= 0) ? metrics.disk : 0;

    cpuChart.setOption(createGaugeOption('CPU', cpuValue));
    memoryChart.setOption(createGaugeOption('内存', memValue));
    diskChart.setOption(createGaugeOption('磁盘', diskValue));

    // --- 设置窗口大小调整监听器 ---
    const handleResize = () => {
        if (cpuChart) cpuChart.resize();
        if (memoryChart) memoryChart.resize();
        if (diskChart) diskChart.resize();
    };
    window.addEventListener('resize', handleResize);


    // --- 添加 Docker 交互逻辑 ---
    const dockerServiceItem = document.getElementById('docker-service-item');
    const dockerDetailSection = document.getElementById('dockerContainersDetail');
    const dockerListContainer = document.getElementById('dockerContainersList');
    const refreshDockerBtn = document.getElementById('refreshDockerBtn');

    if (dockerServiceItem && dockerDetailSection) {
        // 点击 Docker 服务项切换详情显示
        dockerServiceItem.addEventListener('click', async function() {
            // 切换显示/隐藏
            dockerDetailSection.classList.toggle('hidden');

            // 如果变为可见，则加载数据
            if (!dockerDetailSection.classList.contains('hidden')) {
                const serverId = this.dataset.serverId;
                if (serverId) {
                    await loadDockerContainers(serverId, dockerListContainer, refreshDockerBtn);
                }
            }
        });

        // 点击刷新按钮
        if (refreshDockerBtn) {
            refreshDockerBtn.addEventListener('click', async function() {
                const serverId = dockerServiceItem.dataset.serverId;
                if (serverId) {
                    await loadDockerContainers(serverId, dockerListContainer, refreshDockerBtn);
                }
            });
        }
    }
}

// --- 新增：加载并显示 Docker 容器列表 ---
async function loadDockerContainers(serverId, containerElement, refreshButtonElement) {
    if (!containerElement || !refreshButtonElement) return;

    const originalBtnHtml = refreshButtonElement.innerHTML;
    refreshButtonElement.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
    refreshButtonElement.disabled = true;

    containerElement.innerHTML = '<div class="alert info">正在加载容器列表...</div>';

    try {
        const response = await fetch(`/api/dashboard/server/${serverId}/docker/containers`);
        const data = await response.json();

        if (data.success && Array.isArray(data.data)) {
            displayDockerContainers(data.data, containerElement);
        } else {
            throw new Error(data.message || '获取容器列表失败');
        }
    } catch (error) {
        console.error("加载 Docker 容器失败:", error);
        containerElement.innerHTML = `<div class="alert error">加载容器列表失败: ${error.message}</div>`;
    } finally {
        refreshButtonElement.innerHTML = originalBtnHtml;
        refreshButtonElement.disabled = false;
    }
}

// --- 渲染 Docker 容器列表 ---
function displayDockerContainers(containers, containerElement) {
    if (!Array.isArray(containers) || containers.length === 0) {
        containerElement.innerHTML = '<div class="alert info">没有找到容器。</div>';
        return;
    }

    let html = `
        <div class="container-grid-header">
            <div>名称/ID</div>
            <div>镜像</div>
            <div>状态</div>
            <div>端口</div>
        </div>
        <div class="container-grid">
    `;

    containers.forEach(container => {
        const isRunning = container.isRunning;
        const statusClass = isRunning ? 'status-running' : 'status-stopped';
        const statusText = isRunning ? '运行中' : '已停止';

        // 处理端口显示
        let portsDisplay = '无';
        if (container.ports && container.ports.length > 0) {
            // 简单显示，实际可以进一步解析
            portsDisplay = container.ports.join(', ');
        }

        html += `
            <div class="container-row ${isRunning ? 'running' : 'stopped'}">
                <div class="container-cell" title="${container.name} (${container.id})">
                    <div class="container-name">${container.name}</div>
                    <div class="container-id">${container.id}</div>
                </div>
                <div class="container-cell" title="${container.image}">${container.image}</div>
                <div class="container-cell">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="container-cell" title="${portsDisplay}">${portsDisplay}</div>
            </div>
        `;
    });

    html += '</div>'; // Close .container-grid
    containerElement.innerHTML = html;
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    // 恢复主题设置
    const savedTheme = localStorage.getItem('webssh-theme');
    if (savedTheme === 'light') {
        document.body.classList.add('theme-light');
        document.querySelector('.side-actions .btn.ghost i').className = 'fa fa-sun';
    }
    // 恢复背景设置
    const savedBgType = localStorage.getItem('webssh-bg-type') || 'default';
    document.getElementById('backgroundType').value = savedBgType;
    if (savedBgType !== 'default') {
        document.getElementById('backgroundImageRow').style.display = 'grid';
    }
    applyBackgroundSettings(); // 应用背景
    fetchServers();
    refreshFilesPage();
    loadTerminalSettings();
    // 创建默认终端标签
    setTimeout(createNewTab, 500);

    // 为路径显示区域添加点击事件以激活输入框
    document.getElementById('currentPathDisplay').addEventListener('click', activatePathInput);

    // --- 新增：为文件列表容器添加键盘事件监听 (用于 Ctrl+A 全选等) ---
    const fileGridContainer = document.getElementById('fileGridContainer');
    if (fileGridContainer) {
        fileGridContainer.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                // 全选
                selectedFiles.clear();
                document.querySelectorAll('#fileList .file-card').forEach(card => {
                    selectedFiles.add(card.dataset.name);
                });
                if (selectedFiles.size > 0) {
                    // 设置 lastSelectedFile 为最后一个选中的
                    lastSelectedFile = Array.from(selectedFiles)[selectedFiles.size - 1];
                }
                updateFileCardSelectionUI();
                updateMultiSelectToolbar();
            }
        });
        // 确保容器可以获取焦点
        fileGridContainer.setAttribute('tabindex', '0');
    }
});

// 背景类型选择变化事件 ---
document.getElementById('backgroundType').addEventListener('change', function() {
    const row = document.getElementById('backgroundImageRow');
    if (this.value !== 'default') {
        row.style.display = 'grid';
    } else {
        row.style.display = 'none';
    }
});

// ESC键退出全屏
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && isFullscreen) {
        toggleFullscreen();
    }
});

// 全局快捷键
document.addEventListener('keydown', function(e) {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const mod = isMac ? e.metaKey : e.ctrlKey;

    // 搜索 (Ctrl/Cmd + F)
    if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        showSearchBar();
        return;
    }

    // 清屏 (Ctrl/Cmd + K)
    if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        clearActive();
        return;
    }

    // 搜索导航：Enter / Shift+Enter 当搜索栏可见时
    const bar = document.getElementById('termSearchBar');
    if (bar && !bar.classList.contains('hidden')) {
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            doSearchPrev();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            doSearchNext();
            return;
        }
    }

    // 标签切换 Alt + ArrowLeft/Right or Alt + ArrowUp/Down
    if (e.altKey && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
        e.preventDefault();
        if (!tabs.length) return;
        const idx = tabs.findIndex(t => t.id === activeTab);
        if (idx === -1) return;
        const dir = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1;
        const next = (idx + dir + tabs.length) % tabs.length;
        activateTab(tabs[next].id);
        return;
    }
});

// 为路径显示区域添加点击事件以激活输入框
document.getElementById('currentPathDisplay').addEventListener('click', activatePathInput);