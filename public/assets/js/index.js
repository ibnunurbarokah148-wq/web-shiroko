(function () {
    const menuButton = document.querySelector('.hamburger');
    const navigation = document.querySelector('.nav-links');

    if (menuButton && navigation) {
        menuButton.addEventListener('click', function () {
            const open = navigation.classList.toggle('active');
            menuButton.setAttribute('aria-expanded', String(open));
        });
        navigation.addEventListener('click', function (event) {
            if (event.target.matches('a')) {
                navigation.classList.remove('active');
                menuButton.setAttribute('aria-expanded', 'false');
            }
        });
    }

    const moreNavigation = document.querySelector('.nav-more');
    if (moreNavigation) {
        const moreButton = moreNavigation.querySelector('button');
        moreButton.addEventListener('click', function () {
            const open = moreNavigation.classList.toggle('open');
            moreButton.setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', function (event) {
            if (!moreNavigation.contains(event.target)) {
                moreNavigation.classList.remove('open');
                moreButton.setAttribute('aria-expanded', 'false');
            }
        });
    }

    const dashboard = document.getElementById('ecosystem-dashboard');
    if (!dashboard) return;

    const formatter = new Intl.NumberFormat('id-ID');
    const chartWrap = document.querySelector('.chart-wrap');
    let serverSeries = null;
    try {
        serverSeries = chartWrap ? JSON.parse(chartWrap.dataset.series || 'null') : null;
    } catch (error) {
        serverSeries = null;
    }
    const emptySeries = { labels: [], whatsapp: [], discord: [], minecraft: [] };
    const platformHistory = serverSeries && Array.isArray(serverSeries.labels) ? serverSeries : emptySeries;
    let activityChart = null;
    let refreshTimer = null;
    let requestInFlight = false;

    function createChart() {
        const canvas = document.getElementById('activity-chart');
        if (!canvas || typeof window.Chart === 'undefined') return;
        const context = canvas.getContext('2d');
        const cyanGradient = context.createLinearGradient(0, 0, 0, 300);
        cyanGradient.addColorStop(0, 'rgba(0, 217, 255, 0.22)');
        cyanGradient.addColorStop(1, 'rgba(0, 217, 255, 0)');

        activityChart = new window.Chart(context, {
            type: 'line',
            data: {
                labels: Array.isArray(platformHistory.labels) ? platformHistory.labels : [],
                datasets: [
                    { label: 'WhatsApp', data: platformHistory.whatsapp || [], borderColor: '#00d9ff', backgroundColor: cyanGradient, fill: true, tension: .42, pointRadius: 0, borderWidth: 2 },
                    { label: 'Discord', data: platformHistory.discord || [], borderColor: '#8b7cff', backgroundColor: 'transparent', fill: false, tension: .42, pointRadius: 0, borderWidth: 1.5 },
                    { label: 'Minecraft', data: platformHistory.minecraft || [], borderColor: '#36d879', backgroundColor: 'transparent', fill: false, tension: .42, pointRadius: 0, borderWidth: 1.5 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                animation: { duration: 500 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#111a2d',
                        borderColor: '#263754',
                        borderWidth: 1,
                        titleColor: '#f4f7ff',
                        bodyColor: '#99a8c4',
                        displayColors: true,
                        padding: 12
                    }
                },
                scales: {
                    x: { grid: { display: false }, border: { display: false }, ticks: { color: '#63718d', font: { family: 'JetBrains Mono', size: 9 } } },
                    y: { beginAtZero: true, grid: { color: 'rgba(38,55,84,.55)' }, border: { display: false }, ticks: { color: '#63718d', font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 5 } }
                }
            }
        });
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function statusLabel(status) {
        if (status === 'OPERATIONAL') return 'All systems operational';
        if (status === 'DEGRADED') return 'Some services degraded';
        if (status === 'UNKNOWN') return 'Telemetry unavailable';
        return 'Core services offline';
    }

    function renderServices(services) {
        document.querySelectorAll('[data-service-id]').forEach(function (element) {
            const service = services.find(function (item) { return item.id === element.dataset.serviceId; });
            if (!service) return;
            const state = element.querySelector('.service-state');
            if (state) {
                state.className = 'service-state ' + service.status.toLowerCase();
                state.innerHTML = '<i></i>' + service.status;
            }
        });
    }

    function updateDashboard(data) {
        const summary = data.summary || {};
        setText('stat-totalChat', formatter.format(summary.totalChat || 0));
        setText('stat-activeUsers', formatter.format(summary.activeUsers || 0));
        setText('stat-whatsappUsers', formatter.format(summary.whatsappUsers || 0));
        setText('stat-discordUsers', formatter.format(summary.discordUsers || 0));
        setText('stat-aiRequests', formatter.format(summary.aiRequests || 0));
        setText('stat-commands', formatter.format(summary.commands || 0));
        setText('online-count', (summary.onlineServices || 0) + '/' + (summary.totalServices || 0));
        const healthPercentage = Math.round(((summary.onlineServices || 0) / (summary.totalServices || 1)) * 100);
        setText('health-percentage', healthPercentage);
        setText('global-status-label', statusLabel(summary.globalStatus));
        const healthRing = document.getElementById('health-ring');
        if (healthRing) healthRing.style.setProperty('--score', (healthPercentage * 3.6) + 'deg');

        const globalStatus = document.getElementById('global-status');
        if (globalStatus) globalStatus.className = 'live-indicator ' + String(summary.globalStatus || 'OFFLINE').toLowerCase();
        const updated = document.getElementById('last-updated');
        if (updated) {
            const date = new Date(data.updatedAt);
            updated.textContent = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            updated.dateTime = data.updatedAt;
        }
        if (Array.isArray(data.services)) renderServices(data.services);
        if (data.activitySeries && activityChart) {
            activityChart.data.labels = Array.isArray(data.activitySeries.labels) ? data.activitySeries.labels : activityChart.data.labels;
            activityChart.data.datasets[0].data = data.activitySeries.whatsapp || [];
            activityChart.data.datasets[1].data = data.activitySeries.discord || [];
            activityChart.data.datasets[2].data = data.activitySeries.minecraft || [];
            activityChart.update();
            const demoBadge = document.querySelector('.chart-demo-badge');
            if (demoBadge) demoBadge.remove();
        }
    }

    async function fetchDashboard(manual) {
        if (requestInFlight || (!manual && document.hidden)) return;
        requestInFlight = true;
        const button = document.getElementById('refresh-dashboard');
        if (button) button.classList.add('loading');
        try {
            const response = await fetch('/api/dashboard', { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error('Dashboard request failed');
            updateDashboard(await response.json());
        } catch (error) {
            const message = document.getElementById('shiroko-message');
            if (message) message.textContent = 'Koneksi monitoring sedang terganggu. Aku akan mencoba menghubungkannya kembali.';
            const globalStatus = document.getElementById('global-status');
            if (globalStatus) globalStatus.className = 'live-indicator degraded';
        } finally {
            requestInFlight = false;
            if (button) button.classList.remove('loading');
        }
    }

    function scheduleRefresh() {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(async function () {
            await fetchDashboard(false);
            scheduleRefresh();
        }, 15000);
    }

    const refreshButton = document.getElementById('refresh-dashboard');
    if (refreshButton) refreshButton.addEventListener('click', function () { fetchDashboard(true); });
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) fetchDashboard(false);
    });

    function startSocket() {
        if (typeof window.io !== 'function' || !window.VPS_API_URL) return;
        const socket = window.io(window.VPS_API_URL, { timeout: 5000, reconnectionAttempts: 5 });
        socket.on('bot_status', function (payload) {
            const message = document.getElementById('shiroko-message');
            if (!message || !payload) return;
            message.textContent = payload.isTyping
                ? 'Sedang merespons ' + (payload.user || 'pengguna') + ' melalui bot...'
                : 'Respons selesai. Semua kanal kembali dalam mode monitoring.';
        });
        socket.on('service_status', function () { fetchDashboard(false); });
    }

    window.addEventListener('load', function () {
        createChart();
        startSocket();
        scheduleRefresh();
    }, { once: true });
}());
