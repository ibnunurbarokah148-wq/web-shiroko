const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'web.db');
const OLD_JSON_PATH = path.join(__dirname, 'gallery.json');

let db = null;

async function initDatabase() {
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        console.log('[DATABASE] SQLite (Web) dimuat dari file.');
    } else {
        db = new SQL.Database();
        console.log('[DATABASE] SQLite (Web) baru dibuat.');
    }

    // Buat tabel gallery
    db.run(`
        CREATE TABLE IF NOT EXISTS gallery (
            id TEXT PRIMARY KEY,
            filename TEXT,
            url TEXT,
            title TEXT,
            tag TEXT
        )
    `);

    // MIGRASI OTOMATIS: Jika ada file gallery.json, baca isinya dan masukkan ke SQLite
    if (fs.existsSync(OLD_JSON_PATH)) {
        console.log('[DATABASE] Ditemukan gallery.json lama. Memulai migrasi data...');
        try {
            const oldData = JSON.parse(fs.readFileSync(OLD_JSON_PATH, 'utf8'));
            for (const item of oldData) {
                // Gunakan INSERT OR IGNORE agar tidak error jika id sudah ada
                const stmt = db.prepare('INSERT OR IGNORE INTO gallery (id, filename, url, title, tag) VALUES (?, ?, ?, ?, ?)');
                stmt.run([item.id, item.filename, item.url, item.title, item.tag]);
                stmt.free();
            }
            saveToDisk();
            
            // Rename file json lama sebagai backup agar tidak migrasi berulang-ulang
            fs.renameSync(OLD_JSON_PATH, OLD_JSON_PATH + '.backup');
            console.log('[DATABASE] Migrasi berhasil! gallery.json di-rename menjadi gallery.json.backup');
        } catch (e) {
            console.error('[DATABASE] Error saat migrasi JSON:', e.message);
        }
    }

    saveToDisk();
}

function saveToDisk() {
    if (!db) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        const tmpPath = DB_PATH + '.tmp';
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, DB_PATH);
    } catch (e) {
        console.error('[DATABASE] Gagal menyimpan ke disk:', e.message);
    }
}

// Operasi untuk Gallery
function getAllGallery() {
    if (!db) return [];
    const results = [];
    const stmt = db.prepare('SELECT * FROM gallery ORDER BY id DESC'); // Urutkan dari yang terbaru (id biasanya timestamp)
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

function getOneGallery(id) {
    if (!db) return null;
    const stmt = db.prepare('SELECT * FROM gallery WHERE id = ?');
    stmt.bind([id]);
    let row = null;
    if (stmt.step()) {
        row = stmt.getAsObject();
    }
    stmt.free();
    return row;
}

function addGallery(item) {
    if (!db) return;
    const stmt = db.prepare('INSERT INTO gallery (id, filename, url, title, tag) VALUES (?, ?, ?, ?, ?)');
    stmt.run([item.id, item.filename, item.url, item.title, item.tag]);
    stmt.free();
    saveToDisk();
}

function deleteGallery(id) {
    if (!db) return;
    const stmt = db.prepare('DELETE FROM gallery WHERE id = ?');
    stmt.run([id]);
    stmt.free();
    saveToDisk();
}

module.exports = {
    initDatabase,
    getAllGallery,
    getOneGallery,
    addGallery,
    deleteGallery
};
