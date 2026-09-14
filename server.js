require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');
const os = require('os');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 8080;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ASSET_VERSION = process.env.ASSET_VERSION || (IS_PRODUCTION ? '1.0.0' : Date.now().toString());
const VPS_API_URL = process.env.VPS_API_URL || 'http://localhost:3000'; // Default fallback

let rateLimit;
try {
    rateLimit = require('express-rate-limit');
} catch (e) {
    console.warn('[SERVER] express-rate-limit belum terinstall di VPS node_modules. Menggunakan in-memory limiter.');
    rateLimit = options => {
        const hits = new Map();
        return (req, res, next) => {
            const key = req.ip || req.socket?.remoteAddress || 'unknown';
            const now = Date.now();
            const current = hits.get(key);
            if (!current || now >= current.resetAt) {
                hits.set(key, { count: 1, resetAt: now + (options.windowMs || 60000) });
                return next();
            }
            current.count += 1;
            if (current.count <= (options.max || 5)) return next();
            if (options.handler) return options.handler(req, res, next);
            return res.status(429).json(options.message || { status: 'error', message: 'Too many requests.' });
        };
    };
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const session = require('express-session');
app.set('trust proxy', 1);
app.use(session({
    name: 'shiroko.sid',
    secret: process.env.SESSION_SECRET || 'rahasia-shiroko-super-aman',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        httpOnly: true, // Anti-XSS Cookie Theft
        secure: IS_PRODUCTION, // Wajib HTTPS di produksi
        sameSite: 'lax'  // Anti-CSRF
    }
}));

// Rate limiter khusus login admin (Max 5x salah per 15 menit per IP)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).render('admin', {
            title: 'Admin - Shiroko Control Center',
            authenticated: false,
            error: 'Terlalu banyak percobaan login gagal. Harap tunggu 15 menit lagi.'
        });
    }
});

// Rate limiter untuk endpoint PixAI Web Auth (anti brute-force OTP/nonce)
const pixaiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Terlalu banyak permintaan. Coba lagi beberapa menit lagi.' }
});

// Setup EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.vpsUrl = VPS_API_URL;
app.locals.assetVersion = ASSET_VERSION;

// Long-lived caching is safe in production because asset URLs are versioned.
// Development disables caching so UI changes are visible immediately.
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: IS_PRODUCTION ? '30d' : 0,
    etag: true,
    setHeaders: (res) => {
        if (!IS_PRODUCTION) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
}));

const { initDatabase, getAllGallery, addGallery, deleteGallery } = require('./data/database');

// Inisialisasi Database SQLite
initDatabase().then(() => {
    console.log('[SERVER] Database siap digunakan.');
}).catch(console.error);

const uploadsDir = path.join(__dirname, 'public', 'assets', 'images', 'gallery');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Fallback ketika API bot tidak dapat dijangkau (tidak ada data palsu)
const emptyStats = {
    totalChat: 0,
    imageGenerated: 0,
    discordUsers: 0,
    whatsappUsers: 0,
    aiRequests: 0,
    commands: 0
};

// Helper to fetch data from VPS
async function getVPSData() {
    try {
        const response = await axios.get(`${VPS_API_URL}/api/dashboard`, { timeout: 5000 });
        return response.data;
    } catch (error) {
        console.error('Failed to fetch from VPS, telemetry marked as unknown:', error.message);
        return { stats: emptyStats, services: [], activity: [], isFallback: true };
    }
}

function normalizeServiceStatus(status) {
    const normalized = String(status || 'UNKNOWN').toUpperCase();
    if (['ONLINE', 'OPERATIONAL', 'RUNNING'].includes(normalized)) return 'ONLINE';
    if (['STANDBY', 'STARTING', 'CONNECTING'].includes(normalized)) return 'STANDBY';
    if (['OFFLINE', 'DOWN', 'STOPPED', 'DEGRADED'].includes(normalized)) return 'OFFLINE';
    return 'UNKNOWN';
}

function findService(services, id, keywords) {
    const byId = services.find(item => String(item.id || '') === id);
    if (byId) return byId;
    return services.find(item => {
        const name = String(item.name || '').toLowerCase();
        return keywords.some(keyword => name.includes(keyword));
    }) || null;
}

function buildDashboardData(rawData = {}) {
    const stats = { ...emptyStats, ...(rawData.stats || {}) };
    const sourceServices = Array.isArray(rawData.services) ? rawData.services : [];
    const isFallback = rawData.isFallback === true;
    const definitions = [
        {
            id: 'whatsapp',
            name: 'WhatsApp Bot',
            description: 'Asisten AI, roleplay, akademik, dan otomasi chat.',
            icon: 'fab fa-whatsapp',
            accent: 'green',
            keywords: ['whatsapp', 'wa bot']
        },
        {
            id: 'discord',
            name: 'Discord Bot',
            description: 'Community assistant dengan shared memory dan voice.',
            icon: 'fab fa-discord',
            accent: 'purple',
            keywords: ['discord']
        },
        {
            id: 'minecraft-bot',
            name: 'Minecraft Bot',
            description: 'Otomasi command dan aktivitas di dalam game.',
            icon: 'fas fa-robot',
            accent: 'cyan',
            keywords: ['minecraft bot', 'mc bot']
        },
        {
            id: 'minecraft-server',
            name: 'Minecraft Server',
            description: 'Survival cross-play Java dan Bedrock untuk komunitas.',
            icon: 'fas fa-cube',
            accent: 'lime',
            keywords: ['server minecraft', 'minecraft server']
        }
    ];

    const services = definitions.map(definition => {
        const matched = isFallback ? null : findService(sourceServices, definition.id, definition.keywords);
        const latencyValue = matched ? Number(matched.latency ?? matched.latencyMs) : NaN;
        return {
            ...definition,
            status: matched ? normalizeServiceStatus(matched.status) : 'UNKNOWN',
            latency: Number.isFinite(latencyValue) ? latencyValue : null,
            heartbeatAt: matched && matched.heartbeatAt ? matched.heartbeatAt : null,
            detail: matched && matched.detail ? matched.detail : null,
            version: matched && matched.version ? matched.version : null,
            players: matched && Number.isFinite(Number(matched.players)) ? Number(matched.players) : null,
            maxPlayers: matched && Number.isFinite(Number(matched.maxPlayers)) ? Number(matched.maxPlayers) : null
        };
    });

    const onlineCount = services.filter(service => service.status === 'ONLINE').length;
    const globalStatus = isFallback
        ? 'UNKNOWN'
        : onlineCount === services.length
            ? 'OPERATIONAL'
            : onlineCount > 0 ? 'DEGRADED' : 'OFFLINE';

    return {
        summary: {
            totalChat: Number(stats.totalChat) || 0,
            imageGenerated: Number(stats.imageGenerated) || 0,
            activeUsers: (Number(stats.discordUsers) || 0) + (Number(stats.whatsappUsers) || 0),
            discordUsers: Number(stats.discordUsers) || 0,
            whatsappUsers: Number(stats.whatsappUsers) || 0,
            aiRequests: Number(stats.aiRequests) || 0,
            commands: Number(stats.commands) || 0,
            onlineServices: onlineCount,
            totalServices: services.length,
            globalStatus
        },
        services,
        activity: Array.isArray(rawData.activity) ? rawData.activity.slice(0, 6) : [],
        activitySeries: rawData.activitySeries && typeof rawData.activitySeries === 'object' ? rawData.activitySeries : null,
        dataSource: isFallback ? 'fallback' : 'live',
        generatedAt: rawData.generatedAt || rawData.updatedAt || null,
        updatedAt: rawData.updatedAt || rawData.generatedAt || new Date().toISOString()
    };
}

// ==========================================
// ADMIN ROUTES & PROXY CONTROL
// ==========================================
app.get('/admin', async (req, res) => {
    if (!req.session.isAdmin) {
        return res.render('admin', { title: 'Admin - Shiroko Control Center', authenticated: false, error: null });
    }
    const data = await getVPSData();
    res.render('admin', { title: 'Admin Console - Shiroko Control Center', authenticated: true, data });
});

app.post('/admin/login', loginLimiter, (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminPassword && password && password === adminPassword) {
        // Regenerasi session untuk mencegah session fixation
        return req.session.regenerate(error => {
            if (error) {
                return res.render('admin', { title: 'Admin - Shiroko Control Center', authenticated: false, error: 'Gagal membuat sesi. Coba lagi.' });
            }
            req.session.isAdmin = true;
            res.redirect('/admin');
        });
    }
    res.render('admin', { title: 'Admin - Shiroko Control Center', authenticated: false, error: 'Password salah!' });
});

app.post('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin');
});

// Proxy to send commands to VPS
app.post('/admin/api/control', async (req, res) => {
    if (!req.session.isAdmin) {
        return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }
    
    const { action } = req.body;
    try {
        const response = await axios.post(`${VPS_API_URL}/api/control`, { action }, {
            headers: {
                'x-api-key': process.env.WEB_SECRET_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        res.json(response.data);
    } catch (error) {
        console.error('Failed to send control command to VPS:', error.message);
        res.status(500).json({ status: 'error', message: 'Koneksi ke VPS gagal.' });
    }
});

// 1. Pterodactyl Minecraft API
app.get('/admin/api/pterodactyl', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const url = `${process.env.PTERODACTYL_URL}/api/client/servers/${process.env.PTERODACTYL_SERVER_ID}/resources`;
        const pteroRes = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`,
                'Accept': 'application/json'
            }
        });
        res.json(pteroRes.data);
    } catch (error) {
        console.error('Pterodactyl API Error:', error.message);
        res.status(500).json({ error: 'Gagal mengambil data Minecraft.' });
    }
});

// 2. Upload Gallery
app.get('/admin/api/gallery', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    res.json(getAllGallery());
});

app.post('/admin/api/gallery', upload.single('image'), (req, res) => {
    if (!req.session.isAdmin) return res.session.isAdmin ? res.json({ status: 'ok' }) : res.status(401).json({ error: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    
    const { title, tag } = req.body;
    
    addGallery({
        id: Date.now().toString(),
        filename: req.file.filename,
        url: '/assets/images/gallery/' + req.file.filename,
        title: title || 'Untitled',
        tag: tag || 'Artwork'
    });
    
    res.json({ status: 'ok', message: 'Gambar berhasil diunggah!' });
});

app.delete('/admin/api/gallery/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    
    const id = req.params.id;
    const item = getAllGallery().find(g => g.id === id);
    if(item) {
        try { fs.unlinkSync(path.join(uploadsDir, item.filename)); } catch(e){}
        deleteGallery(id);
    }
    res.json({ status: 'ok' });
});

// 3. Auto Deploy (Git Pull & PM2)
app.post('/admin/api/deploy', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    
    const { target } = req.body;
    let command = '';
    
    if (target === 'bot') {
        command = 'cd /root/bot-shiroko && git pull && npm install --legacy-peer-deps --omit=dev && pm2 restart index';
    } else if (target === 'web') {
        command = 'cd /root/web-shiroko && git pull && npm install --legacy-peer-deps --omit=dev && pm2 restart web-shiroko';
    } else {
        return res.status(400).json({ error: 'Invalid target' });
    }

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Deploy Error: ${error}`);
            return res.status(500).json({ status: 'error', message: 'Deployment gagal: ' + error.message });
        }
        res.json({ status: 'ok', message: `Deployment ${target} sukses dipicu. Jika ini web, koneksi akan terputus sebentar.`, output: stdout });
    });
});

// 4. Advanced File Manager API
const fileManagerUpload = multer({ dest: os.tmpdir() }); // Temp dir for uploads

function getFmTargetDir(req) {
    let rawTarget = (req.query && req.query.dir) || (req.body && req.body.dir) || '/root';
    
    // 🛡️ Keamanan: Path Traversal Protection (Jail ke baseDir)
    const baseDir = fs.existsSync('/root') ? '/root' : path.resolve(__dirname, '..');
    const baseResolved = path.resolve(baseDir);
    const safePath = path.resolve(baseResolved, rawTarget.replace(/^\/root/, '').replace(/^\//, ''));
    
    // Pastikan path hasil resolve tetap berada di dalam baseResolved (Anti-Path Traversal)
    const relative = path.relative(baseResolved, safePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Akses ditolak: Mencoba keluar dari zona aman (Path Traversal Detected).');
    }
    
    // Fallback khusus untuk development lokal Windows agar slashes seragam
    return fs.existsSync('/root') ? safePath : safePath.replace(/\\/g, '/');
}

app.get('/admin/api/files', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    let targetDir = getFmTargetDir(req);
    try {
        if (!fs.existsSync(targetDir)) return res.status(404).json({ error: 'Direktori tidak ditemukan.' });
        const files = fs.readdirSync(targetDir, { withFileTypes: true });
        const fileList = files.map(file => {
            let stat = { size: 0, mtime: new Date() };
            try { stat = fs.statSync(path.join(targetDir, file.name)); } catch(e){}
            return {
                name: file.name,
                isDirectory: file.isDirectory(),
                size: stat.size,
                mtime: stat.mtime,
                path: (req.query.dir || '/root') + '/' + file.name
            };
        }).sort((a, b) => {
            if(a.isDirectory && !b.isDirectory) return -1;
            if(!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
        res.json({ currentDir: req.query.dir || '/root', files: fileList });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/api/files/action', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    const { action, source, dest, newName, type } = req.body;
    try {
        let srcPath = getFmTargetDir({ body: { dir: source } });
        let destPath = dest ? getFmTargetDir({ body: { dir: dest } }) : '';
        
        if (action === 'delete') {
            fs.rmSync(srcPath, { recursive: true, force: true });
        } else if (action === 'rename') {
            fs.renameSync(srcPath, path.join(path.dirname(srcPath), newName));
        } else if (action === 'create') {
            if (type === 'folder') fs.mkdirSync(srcPath, { recursive: true });
            else fs.writeFileSync(srcPath, '');
        } else if (action === 'copy') {
            fs.cpSync(srcPath, destPath, { recursive: true });
        } else if (action === 'move') {
            fs.renameSync(srcPath, destPath);
        }
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/admin/api/files/bulk-action', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    const { action, files, dest } = req.body;
    try {
        if (!files || !Array.isArray(files)) return res.status(400).json({ error: 'Invalid files' });
        
        if (action === 'delete') {
            for (const file of files) {
                const target = getFmTargetDir({ body: { dir: file } });
                fs.rmSync(target, { recursive: true, force: true });
            }
            res.json({ status: 'ok' });
        } else if (action === 'archive' && dest) {
            const destPath = getFmTargetDir({ body: { dir: dest } });
            const zip = new AdmZip();
            for (const file of files) {
                const target = getFmTargetDir({ body: { dir: file } });
                const stats = fs.statSync(target);
                if (stats.isDirectory()) {
                    zip.addLocalFolder(target, path.basename(target));
                } else {
                    zip.addLocalFile(target);
                }
            }
            zip.writeZip(destPath);
            res.json({ status: 'ok' });
        } else {
            res.status(400).json({ error: 'Invalid bulk action' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/admin/api/files/download-url', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    const { url, dir } = req.body;
    try {
        let filename = 'downloaded_file';
        try { filename = new URL(url).pathname.split('/').pop() || 'downloaded_file'; } catch(e) {}
        
        const destPath = getFmTargetDir({ body: { dir: dir + '/' + filename } });
        
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });
        
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        
        writer.on('finish', () => res.json({ status: 'ok' }));
        writer.on('error', (err) => res.status(500).json({ error: err.message }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/admin/api/files/read', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const filePath = getFmTargetDir(req);
        const content = fs.readFileSync(filePath, 'utf8');
        res.json({ content });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/api/files/download', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const filePath = getFmTargetDir(req);
        res.sendFile(filePath);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/api/files/save', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const filePath = getFmTargetDir(req);
        fs.writeFileSync(filePath, req.body.content, 'utf8');
        res.json({ status: 'ok' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/api/files/upload', fileManagerUpload.single('file'), (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    try {
        const targetDir = getFmTargetDir({ body: { dir: req.body.dir } });
        const destPath = path.join(targetDir, req.file.originalname);
        fs.copyFileSync(req.file.path, destPath);
        fs.unlinkSync(req.file.path);
        res.json({ status: 'ok' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5. VPS System Monitor
app.get('/admin/api/vps-stats', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsage = ((usedMem / totalMem) * 100).toFixed(2);
    
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    cpus.forEach(core => {
        for (type in core.times) {
            totalTick += core.times[type];
        }
        totalIdle += core.times.idle;
    });
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    // Calculate simple CPU usage (this is an approximation for immediate read)
    const cpuUsage = (100 - ~~(100 * idle / total)).toFixed(2);

    exec('df -Pk /', (err, stdout) => {
        let diskStr = '0 GB / 0 GB';
        if (!err && stdout) {
            const lines = stdout.trim().split('\n');
            if (lines.length > 1) {
                const parts = lines[1].trim().split(/\s+/);
                if (parts.length >= 4) {
                    const totalKB = parseInt(parts[1], 10);
                    const usedKB = parseInt(parts[2], 10);
                    diskStr = `${(usedKB / 1024 / 1024).toFixed(1)} GB / ${(totalKB / 1024 / 1024).toFixed(1)} GB`;
                }
            }
        }
        res.json({
            cpu: cpuUsage,
            ram: memoryUsage,
            totalRam: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            usedRam: (usedMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            uptime: (os.uptime() / 3600).toFixed(1) + ' Jam',
            disk: diskStr
        });
    });
});

// 6. PM2 Logs Viewer
app.get('/admin/api/logs', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    const { target } = req.query; // 'bot' or 'web'
    const appName = target === 'bot' ? 'index' : 'web-shiroko';
    
    exec(`pm2 logs ${appName} --lines 50 --nostream`, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: 'Failed to fetch logs.' });
        }
        res.json({ logs: stdout });
    });
});

// 7. Reboot VPS Server
app.post('/admin/api/reboot', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    
    exec('shutdown -r now', (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ status: 'error', message: 'Reboot gagal: ' + error.message });
        }
        res.json({ status: 'ok', message: 'Server VPS sedang direstart. Koneksi akan terputus.' });
    });
});

// ==========================================
// PUBLIC ROUTES
// ==========================================
let publicStatsCache = null;
let publicStatsCacheTime = 0;
let publicStatsRequest = null;
let publicDashboardCache = null;
let publicDashboardCacheTime = 0;
let publicDashboardRequest = null;
const PUBLIC_STATS_CACHE_MS = 10000;

async function getPublicDashboardData() {
    const now = Date.now();
    if (publicDashboardCache && now - publicDashboardCacheTime < PUBLIC_STATS_CACHE_MS) {
        return publicDashboardCache;
    }
    if (!publicDashboardRequest) {
        publicDashboardRequest = getVPSData().then(data => {
            publicDashboardCache = buildDashboardData(data);
            publicDashboardCacheTime = Date.now();
            return publicDashboardCache;
        }).finally(() => {
            publicDashboardRequest = null;
        });
    }
    return publicDashboardRequest;
}

app.get('/api/stats', async (req, res) => {
    const now = Date.now();
    if (publicStatsCache && now - publicStatsCacheTime < PUBLIC_STATS_CACHE_MS) {
        return res.json(publicStatsCache);
    }
    if (!publicStatsRequest) {
        publicStatsRequest = getVPSData().then(data => {
            publicStatsCache = data.stats;
            publicStatsCacheTime = Date.now();
            return publicStatsCache;
        }).finally(() => {
            publicStatsRequest = null;
        });
    }
    const stats = await publicStatsRequest;
    res.json(stats);
});

app.get('/api/dashboard', async (req, res) => {
    res.json(await getPublicDashboardData());
});

app.get('/', async (req, res) => {
    const data = await getPublicDashboardData();
    res.render('home', { title: 'Overview - Shiroko Control Center', data, isHome: true, currentPath: '/' });
});

app.get('/projects', async (req, res) => {
    const data = await getPublicDashboardData();
    res.render('projects', { title: 'Ecosystem - Shiroko Control Center', currentPath: '/projects', data });
});
app.get('/docs', (req, res) => res.render('docs', { title: 'Docs - Shiroko Control Center', currentPath: '/docs' }));
app.get('/pixai-api', (req, res) => res.render('pixai-api', { title: 'PixAI Web Auth - Shiroko Control Center', currentPath: '/pixai-api' }));

// Proxy API ke Bot VPS (Menghindari CORS & Mixed Content)
const PIXAI_ALLOWED_ORIGINS = (process.env.PIXAI_ALLOWED_ORIGINS || 'https://pixai.art,https://www.pixai.art')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

function applyPixaiCors(req, res) {
    const origin = req.headers.origin;
    if (origin && PIXAI_ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

app.post('/api/get-pixai-payload', pixaiLimiter, async (req, res) => {
    try {
        const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
        if (!otp || otp.length > 40) {
            return res.status(400).json({ status: 'error', message: 'Kode OTP tidak valid.' });
        }
        const response = await axios.post(`${VPS_API_URL}/api/generate-bookmarklet`, { otp }, { timeout: 8000 });
        res.json(response.data);
    } catch (error) {
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ status: 'error', message: 'Gagal terhubung ke Bot VPS. Pastikan bot menyala.' });
        }
    }
});

// Proxy API untuk save token (Dipanggil oleh Bookmarklet di pixai.art)
app.options('/api/save-pixai-token', (req, res) => {
    applyPixaiCors(req, res);
    res.status(204).end();
});

app.post('/api/save-pixai-token', pixaiLimiter, async (req, res) => {
    applyPixaiCors(req, res);
    try {
        const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
        const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce.trim() : '';
        if (!token || !nonce || token.length > 4096 || nonce.length > 128) {
            return res.status(400).json({ status: 'error', message: 'Payload token tidak valid.' });
        }
        const response = await axios.post(`${VPS_API_URL}/api/save-pixai-token`, { token, nonce }, { timeout: 8000 });
        res.json(response.data);
    } catch (error) {
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ status: 'error', message: 'Gagal menghubungi server backend bot.' });
        }
    }
});

app.get('/status', async (req, res) => {
    const data = await getPublicDashboardData();
    res.render('status', {
        title: 'System Status - Shiroko Control Center',
        data,
        currentPath: '/status'
    });
});
app.get('/gallery', (req, res) => {
    const galleryData = getAllGallery();
    res.render('gallery', { title: 'Gallery - Shiroko Control Center', galleryData, currentPath: '/gallery' });
});
app.get('/download', (req, res) => res.render('download', { title: 'Download - Shiroko Control Center', currentPath: '/download' }));
app.get('/changelog', (req, res) => res.render('changelog', { title: 'Changelog - Shiroko Control Center', currentPath: '/changelog' }));
app.get('/about', (req, res) => res.render('about', { title: 'About - Shiroko Control Center', currentPath: '/about' }));
app.get('/contact', (req, res) => res.render('contact', { title: 'Contact - Shiroko Control Center', currentPath: '/contact' }));

app.listen(PORT, () => {
    console.log(`Web Portal Shiroko Project berjalan di http://localhost:${PORT}`);
});




