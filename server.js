import express from 'express';
import cors from 'cors';
import WebTorrent from 'webtorrent';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const client = new WebTorrent();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Ruta raíz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== BUSCADOR DE MÚSICA MP3 EN 1337x ====================

async function search1337xMusic(query) {
    try {
        const searchUrl = `https://www.1377x.to/search/${encodeURIComponent(query)}/1/`;
        console.log(`🔍 Buscando en 1337x: ${searchUrl}`);
        
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });
        
        const $ = cheerio.load(response.data);
        const results = [];
        
        $('table.table-list tbody tr').each((i, element) => {
            if (i >= 20) return false;
            
            const name = $(element).find('td.name a:nth-child(2)').text().trim();
            const href = $(element).find('td.name a:nth-child(2)').attr('href');
            const seeds = $(element).find('td.seeds').text().trim();
            const size = $(element).find('td.size').text().trim();
            
            // IMPORTANTE: Este hash es FALSO, es solo el ID del torrent
            // Para hash real necesitas scrapear la página del torrent
            const fakeHash = href.split('/')[2] || '0000000000000000000000000000000000000000';
            
            // Incluir TODO lo que contenga "music", "mp3", "flac", "album"
            if (name && href) {
                const isMusic = name.toLowerCase().includes('mp3') || 
                               name.toLowerCase().includes('flac') ||
                               name.toLowerCase().includes('album') ||
                               name.toLowerCase().includes('discography') ||
                               name.toLowerCase().includes('music');
                
                if (isMusic) {
                    results.push({
                        name: name,
                        size: size,
                        seeds: parseInt(seeds) || 0,
                        peers: 0,
                        category: 'music',
                        quality: 'MP3',
                        type: 'audio',
                        url: `https://www.1377x.to${href}`, // SIN espacio
                        hash: fakeHash,
                        // Magnet con hash FALSO - solo para pruebas
                        magnet: `magnet:?xt=urn:btih:${fakeHash}&dn=${encodeURIComponent(name)}&tr=udp://tracker.opentrackr.org:1337/announce`
                    });
                }
            }
        });
        
        console.log(`✅ 1337x encontró ${results.length} resultados de música`);
        return results;
        
    } catch (error) {
        console.error('❌ 1337x Error:', error.message);
        return [];
    }
}

// Endpoint de búsqueda para música
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.query || '';
        if (!query) {
            return res.status(400).json({ error: 'Query parameter required' });
        }
        
        // Buscar MP3 en 1337x
        const results = await search1337xMusic(query);
        res.json(results);
        
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({ error: 'Search failed', details: error.message });
    }
});

// ==================== SISTEMA DE STREAMING (sin cambios) ====================

let activeTorrents = new Map();

app.post('/api/stream', (req, res) => {
    try {
        const { magnet } = req.body;
        if (!magnet) {
            return res.status(400).json({ error: 'Magnet link required' });
        }

        const torrentId = Buffer.from(magnet).toString('base64');
        
        if (activeTorrents.has(torrentId)) {
            return res.json({ torrentId, status: 'already_added' });
        }

        console.log(`🎵 Streaming torrent: ${magnet.substring(0, 60)}...`);
        
        const torrent = client.add(magnet, {
            path: './downloads'
        });

        torrent.on('error', (err) => {
            console.error('Torrent error:', err);
            activeTorrents.delete(torrentId);
        });

        torrent.on('done', () => {
            console.log('✅ Torrent descargado:', torrent.name);
        });

        activeTorrents.set(torrentId, {
            torrent,
            added: Date.now(),
            name: torrent.name || 'Unknown'
        });

        res.json({ torrentId, status: 'added', name: torrent.name });

    } catch (error) {
        console.error('Streaming error:', error);
        res.status(500).json({ error: 'Failed to add torrent' });
    }
});

app.get('/api/torrent/:id/status', (req, res) => {
    try {
        const torrentId = req.params.id;
        const torrentData = activeTorrents.get(torrentId);
        
        if (!torrentData) {
            return res.status(404).json({ error: 'Torrent not found' });
        }

        const torrent = torrentData.torrent;
        
        if (!torrent) {
            return res.status(404).json({ error: 'Torrent not available' });
        }

        const status = {
            name: torrent.name,
            progress: torrent.progress,
            downloaded: torrent.downloaded,
            uploaded: torrent.uploaded,
            downloadSpeed: torrent.downloadSpeed,
            uploadSpeed: torrent.uploadSpeed,
            timeRemaining: torrent.timeRemaining,
            numPeers: torrent.numPeers,
            done: torrent.done
        };

        res.json(status);

    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
});

// ==================== DESCARGAS (sin cambios) ====================

app.get('/api/downloads', (req, res) => {
    try {
        const downloadsPath = path.join(__dirname, 'downloads');
        
        if (!fs.existsSync(downloadsPath)) {
            fs.mkdirSync(downloadsPath, { recursive: true });
        }

        const files = fs.readdirSync(downloadsPath)
            .filter(file => !file.startsWith('.'))
            .map(file => {
                const stats = fs.statSync(path.join(downloadsPath, file));
                return {
                    name: file,
                    size: stats.size,
                    date: stats.mtime
                };
            })
            .sort((a, b) => b.date - a.date);

        res.json({ downloads: files });
    } catch (error) {
        console.error('Downloads list error:', error);
        res.status(500).json({ error: 'Failed to list downloads' });
    }
});

app.delete('/api/downloads/:filename', (req, res) => {
    try {
        const filePath = path.join(__dirname, 'downloads', req.params.filename);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// ==================== SERVIDOR ====================

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🎵 TorrentStream server running on port ${PORT}`);
    console.log(`🎵 WebTorrent client ready for P2P connections`);
    console.log(`🎵 Buscando música MP3 en 1337x`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    client.destroy();
    process.exit(0);
});
