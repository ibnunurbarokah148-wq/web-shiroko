require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8080;
const VPS_API_URL = process.env.VPS_API_URL || 'http://localhost:3000'; // Default fallback

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const session = require('express-session');
app.use(session({
    secret: process.env.SESSION_SECRET || 'rahasia-shiroko',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Setup EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.vpsUrl = VPS_API_URL;

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// CONFIGURATIONS (Gallery, Multer, etc)
// ==========================================
const galleryDataPath = path.join(__dirname, 'data', 'gallery.json');
const uploadsDir = path.join(__dirname, 'public', 'assets', 'images', 'gallery');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(galleryDataPath)) {
    if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
    fs.writeFileSync(galleryDataPath, JSON.stringify([]));
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

function getGalleryData() {
    return JSON.parse(fs.readFileSync(galleryDataPath, 'utf8'));
}
function saveGalleryData(data) {
    fs.writeFileSync(galleryDataPath, JSON.stringify(data, null, 4));
}

// Dummy data for fallback if VPS is offline
const dummyStats = {
    totalChat: 0,
    imageGenerated: 0,
    discordUsers: 0,
    whatsappUsers: 0,
    aiRequests: 0,
    commands: 0
};

const dummyServices = [
    { name: 'WhatsApp', status: 'ONLINE', icon: 'fab fa-whatsapp' },
    { name: 'Discord', status: 'ONLINE', icon: 'fab fa-discord' },
    { name: 'Minecraft', status: 'ONLINE', icon: 'fas fa-cube' },
    { name: 'Gemini', status: 'ONLINE', icon: 'fas fa-brain' },
    { name: 'Cloudflare', status: 'ONLINE', icon: 'fas fa-cloud' },
    { name: 'OpenRouter', status: 'ONLINE', icon: 'fas fa-network-wired' },
    { name: 'Ollama', status: 'ONLINE', icon: 'fas fa-server' },
    { name: 'ComfyUI', status: 'OFFLINE', icon: 'fas fa-palette' }
];

// Helper to fetch data from VPS
async function getVPSData() {
    try {
        const response = await axios.get(`${VPS_API_URL}/api/dashboard`, { timeout: 5000 });
        return response.data;
    } catch (error) {
        console.error('Failed to fetch from VPS, using dummy data:', error.message);
        return { stats: dummyStats, services: dummyServices };
    }
}

// ==========================================
// ADMIN ROUTES & PROXY CONTROL
// ==========================================
app.get('/admin', async (req, res) => {
    if (!req.session.isAdmin) {
        return res.render('admin', { title: 'Admin Login', authenticated: false, error: null });
    }
    const data = await getVPSData();
    res.render('admin', { title: 'Control Panel', authenticated: true, data });
});

app.post('/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        res.render('admin', { title: 'Admin Login', authenticated: false, error: 'Password salah!' });
    }
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

// Gallery API
app.post('/admin/api/gallery', upload.single('image'), (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    try {
        const galleryData = getGalleryData();
        galleryData.push({
            id: Date.now().toString(),
            url: '/assets/images/gallery/' + req.file.filename,
            title: req.body.title || 'Untitled',
            tag: req.body.tag || 'Artwork'
        });
        saveGalleryData(galleryData);
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/admin/api/gallery/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    try {
        let galleryData = getGalleryData();
        galleryData = galleryData.filter(g => g.id !== req.params.id);
        saveGalleryData(galleryData);
        res.json({ status: 'ok' });
    } catch(e) { res.status(500).json({ error: e.message }); }
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
app.post('/admin/api/gallery', upload.single('image'), (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    
    const { title, tag } = req.body;
    const galleryData = getGalleryData();
    
    galleryData.push({
        id: Date.now().toString(),
        filename: req.file.filename,
        url: '/assets/images/gallery/' + req.file.filename,
        title: title || 'Untitled',
        tag: tag || 'Artwork'
    });
    
    saveGalleryData(galleryData);
    res.json({ status: 'ok', message: 'Gambar berhasil diunggah!' });
});

app.delete('/admin/api/gallery/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    let galleryData = getGalleryData();
    const item = galleryData.find(g => g.id === req.params.id);
    if(item) {
        try { fs.unlinkSync(path.join(uploadsDir, item.filename)); } catch(e){}
        galleryData = galleryData.filter(g => g.id !== req.params.id);
        saveGalleryData(galleryData);
    }
    res.json({ status: 'ok' });
});

// 3. Auto Deploy (Git Pull & PM2)
app.post('/admin/api/deploy', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    
    const { target } = req.body;
    let command = '';
    
    if (target === 'bot') {
        command = 'cd /root/bot-shiroko && git pull && pm2 restart shiroko';
    } else if (target === 'web') {
        command = 'cd "/root/Web Shiroko Project" && git pull && pm2 restart web-shiroko';
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
    let target = req.query.dir || req.body.dir || '/root';
    if (!fs.existsSync('/root')) { // Fallback for Windows local dev
        target = target.replace('/root', path.join(__dirname, '..')).replace(/\\/g, '/');
    }
    return target;
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

    res.json({
        cpu: cpuUsage,
        ram: memoryUsage,
        totalRam: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        usedRam: (usedMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        uptime: (os.uptime() / 3600).toFixed(1) + ' Hours'
    });
});

// 6. PM2 Logs Viewer
app.get('/admin/api/logs', (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    const { target } = req.query; // 'shiroko' or 'web-shiroko'
    const appName = target === 'bot' ? 'shiroko' : 'web-shiroko';
    
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
app.get('/api/stats', async (req, res) => {
    const data = await getVPSData();
    res.json(data.stats);
});

app.get('/', async (req, res) => {
    const data = await getVPSData();
    res.render('home', { title: 'Shiroko Project - AI Ecosystem', data });
});

app.get('/projects', (req, res) => res.render('projects', { title: 'Projects' }));
app.get('/docs', (req, res) => res.render('docs', { title: 'Documentation' }));
app.get('/status', async (req, res) => {
    const data = await getVPSData();
    res.render('status', { title: 'Live Status', data });
});
app.get('/gallery', (req, res) => {
    const galleryData = getGalleryData();
    res.render('gallery', { title: 'Gallery', galleryData });
});
app.get('/download', (req, res) => res.render('download', { title: 'Download' }));
app.get('/changelog', (req, res) => res.render('changelog', { title: 'Changelog' }));
app.get('/about', (req, res) => res.render('about', { title: 'About' }));
app.get('/contact', (req, res) => res.render('contact', { title: 'Contact' }));

app.listen(PORT, () => {
    console.log(`🐺 Web Portal Shiroko Project berjalan di http://localhost:${PORT}`);
});
