// 简洁 STOMP 版：单会话 demo，可扩展多 tab
let stompClient = null;
let term, fitAddon;

function initTerminal() {
    term = new Terminal({
        fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
        cursorBlink: true
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();
    document.getElementById('terminalStats').innerText = `行: ${term.rows}, 列: ${term.cols}`;

    term.onData(data => {
        sendCommand(data);
    });

    window.addEventListener('resize', () => {
        fitAddon.fit();
        throttleResize();
    });
}
initTerminal();

let resizeTimer = null;
function throttleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const cols = term.cols;
        const rows = term.rows;
        if (stompClient && stompClient.connected) {
            stompClient.send('/app/ssh/resize', {}, JSON.stringify({ cols, rows }));
        }
        document.getElementById('terminalStats').innerText = `行: ${rows}, 列: ${cols}`;
    }, 200);
}

function showAlert(msg, type='success') {
    const el = document.createElement('div');
    el.className = 'alert ' + (type === 'danger' ? 'alert-danger' : 'alert-success');
    el.innerText = msg;
    const box = document.getElementById('alertContainer');
    box.innerHTML = '';
    box.appendChild(el);
}

function setStatus(text) {
    document.getElementById('statusText').innerText = text;
    document.getElementById('statusBar').innerText = text;
}

function appendOutput(text) {
    term.write(text);
}

function connectSSH() {
    const host = document.getElementById('host').value.trim();
    const port = parseInt(document.getElementById('port').value, 10) || 22;
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    const sock = new SockJS('/ssh-ws');
    stompClient = Stomp.over(sock);
    // 如需关闭日志：
    // stompClient.debug = null;

    stompClient.connect({}, frame => {
        setStatus('已连接（STOMP）');

        // 订阅状态/错误
        stompClient.subscribe('/user/queue/reply', msg => {
            const data = JSON.parse(msg.body);
            showAlert(data.message, data.type === 'error' ? 'danger' : 'success');
        });

        // 订阅输出
        stompClient.subscribe('/user/queue/output', msg => {
            const data = JSON.parse(msg.body);
            if (data.type === 'output') appendOutput(data.data);
        });

        // 建立 SSH 连接
        stompClient.send('/app/ssh/connect', {}, JSON.stringify({ host, port, username, password }));

        document.getElementById('disconnectBtn').disabled = false;
    }, err => {
        setStatus('连接失败');
        showAlert('WebSocket/STOMP 连接失败', 'danger');
        console.error(err);
    });
}

function sendCommand(data) {
    if (!stompClient || !stompClient.connected) return;
    stompClient.send('/app/ssh/command', {}, JSON.stringify({ command: data }));
}

function disconnectSSH() {
    if (stompClient && stompClient.connected) {
        stompClient.send('/app/ssh/disconnect', {});
        stompClient.disconnect(() => {
            setStatus('已断开');
            showAlert('已断开连接', 'success');
            document.getElementById('disconnectBtn').disabled = true;
        });
    }
}

// “测试连接”只是简单尝试握手
function testConnection() {
    if (stompClient && stompClient.connected) {
        showAlert('当前已连接，无需再次测试');
        return;
    }
    const sock = new SockJS('/ssh-ws');
    const client = Stomp.over(sock);
    client.connect({}, () => {
        client.disconnect();
        showAlert('WebSocket/STOMP 握手正常');
    }, () => showAlert('WebSocket/STOMP 握手失败', 'danger'));
}

// 绑定按钮
document.getElementById('connectBtn').addEventListener('click', connectSSH);
document.getElementById('disconnectBtn').addEventListener('click', disconnectSSH);
document.getElementById('testBtn').addEventListener('click', testConnection);