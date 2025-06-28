
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const MEDIA_DIR = path.join(__dirname, 'media');

// Get all files in /media and assign them a hash ID
const crypto = require('crypto');
function hashFilename(filename) {
    return crypto.createHash('sha1').update(filename).digest('hex').slice(0, 12);
}
function getMediaFiles() {
    const files = fs.readdirSync(MEDIA_DIR).filter(f => fs.statSync(path.join(MEDIA_DIR, f)).isFile());
    return files.map((filename) => ({ id: hashFilename(filename), filename }));
}

// Serve a list of media files with their IDs
app.get('/', (req, res) => {
    const files = getMediaFiles();
    res.send('<h1>Media Files</h1>' +
        '<ul>' +
        files.map(f => `<li><a href="/media/${f.id}">${f.filename}</a></li>`).join('') +
        '</ul>');
});


// Track running ffmpeg processes to avoid duplicates
const runningHLS = {};


// Route to begin HLS conversion and redirect to playlist route
app.get('/media/:id', (req, res) => {
    const files = getMediaFiles();
    const file = files.find(f => f.id === req.params.id);
    if (!file) {
        return res.status(404).send('File not found');
    }
    const filePath = path.join(MEDIA_DIR, file.filename);
    const hlsDir = path.join(__dirname, 'hls', String(file.id));
    const playlistPath = path.join(hlsDir, 'index.m3u8');

    // If playlist exists but no process is running, check if it's complete
    let resumeIncomplete = false;
    if (fs.existsSync(playlistPath) && !runningHLS[file.id]) {
        const playlistContent = fs.readFileSync(playlistPath, 'utf8');
        if (!playlistContent.includes('#EXT-X-ENDLIST')) {
            resumeIncomplete = true;
        }
    }

    // If process is running, just redirect to playlist route
    if (runningHLS[file.id]) {
        return res.redirect(`/playlist/${file.id}`);
    }

    // Create HLS directory for this file if needed
    fs.mkdirSync(hlsDir, { recursive: true });

    // Start or resume ffmpeg in background
    const ffmpegArgs = [
        '-i', filePath,
        '-vf', 'scale=1280:720',
        '-c:v', 'libx264',
        '-profile:v', 'baseline',
        '-level', '3.0',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-preset', 'veryfast',
        '-r', '24',
        '-movflags', '+faststart',
        '-f', 'hls',
        '-hls_list_size', '0',
        '-hls_allow_cache', '0',
        '-hls_segment_filename', path.join(hlsDir, 'segment%03d.ts'),
        playlistPath
    ];
    const ffmpeg = spawn('ffmpeg', ffmpegArgs, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    runningHLS[file.id] = ffmpeg;
    ffmpeg.stderr.on('data', data => {
        console.error(`ffmpeg stderr: ${data}`);
    });
    ffmpeg.on('close', code => {
        delete runningHLS[file.id];
        if (code !== 0) {
            console.error('Transcoding to HLS failed');
        }
    });
    // Redirect to the new playlist route
    res.redirect(`/playlist/${file.id}`);
});

// Serve the m3u8 playlist on a different route
app.get('/playlist/:id', (req, res) => {
    const playlistPath = path.join(__dirname, 'hls', req.params.id, 'index.m3u8');
    if (!fs.existsSync(playlistPath)) {
        return res.status(404).send('Playlist not found');
    }
    res.setHeader('Content-Type', 'video/mp2t');
    fs.createReadStream(playlistPath).pipe(res);
});

// Serve HLS segments and playlists statically
app.use('/hls', express.static(path.join(__dirname, 'hls')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
