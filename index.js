
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const MEDIA_DIR = path.join(__dirname, 'media');
exports.MEDIA_DIR = MEDIA_DIR;

// NVENC toggle arg
const useNVENC = process.argv.includes('--nvenc');

const crypto = require('crypto');
const { getMediaFiles } = require('./mediaUtils');

function hashFilename(filename) {
    return crypto.createHash('sha1').update(filename).digest('hex');
}

// Ensure media directory exists
if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
}
// Populate images.
mediaUtils = require('./mediaUtils');
mediaUtils.generateThumbnails();

app.set('view engine', 'pug');
app.use(express.static(path.join(__dirname, 'public/css')));
app.use(express.static(path.join(__dirname, 'public/js')));
app.use(express.static(path.join(__dirname, 'images')));

// Serve a list of media files with their IDs
// app.get('/', (req, res) => {
    //     const files = getMediaFiles();
    //     res.send('<h1>Media Files</h1>' +
    //         '<ul>' +
    //         files.map(f => `<li><a href="/media/${f.id}">${f.filename}</a></li>`).join('') +
    //         '</ul>');
    // });
    
    app.get('/', (req, res) => {
        res.render('index', {files: getMediaFiles()});
    })
    
    // Track running ffmpeg processes to avoid duplicates
    const runningHLS = {};
    
    // Route to transcode and serve HLS playlist for a media file by ID
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
            // If playlist is incomplete (no #EXT-X-ENDLIST), resume conversion
            if (!playlistContent.includes('#EXT-X-ENDLIST')) {
                resumeIncomplete = true;
            }
        }
        
        // Wait 3 seconds before redirected to allow ffmpeg to start
        if (runningHLS[file.id]) {
            res.status(202).send(`Transcoding in progress, please wait...${
                // Embed redirect after 3 seconds
                `<meta http-equiv="refresh" content="3;url=/hls/${file.id}/index.m3u8" />`
            }`);
            return res.redirect(`/hls/${file.id}/index.m3u8`);
        }
        
        // Create HLS directory for this file if needed
        fs.mkdirSync(hlsDir, { recursive: true });
        
        // Start or resume ffmpeg in background
        let ffmpegArgs;
        if (useNVENC) {
            // Common ffmpeg args
            const commonArgs = [
                '-vf', 'scale=1920:1080',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-r', '30',
                '-movflags', 'faststart', // Slows down second pass, but we're doing a fast transcode hls pass 
                '-f', 'hls',
                '-hls_list_size', '0',
                '-hls_allow_cache', '0',
                '-hls_segment_filename', path.join(hlsDir, 'segment%03d.ts'),
                playlistPath
            ];

            if (useNVENC) {
                // NVENC version
                ffmpegArgs = [
                    '-i', filePath,
                    '-c:v', 'h264_nvenc',
                    '-b:v', '8M',
                    '-profile:v', 'high',
                    '-preset', 'p1',
                    ...commonArgs
                ];
            } else {
                // Software x264 version
                ffmpegArgs = [
                    '-i', filePath,
                    '-c:v', 'libx264',
                    '-profile:v', 'baseline',
                    '-level', '3.0',
                    '-preset', 'veryfast',
                    ...commonArgs
                ];
            }
        }
        // console.log(`Running ffmpeg with args: ${ffmpegArgs.join(' ')}`);
        // The raw nvenc ffmpeg command will be without new lines:
        // No need for -hls_flags append_list; just rerun the same command to resume/complete VOD
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
        
        // Immediately redirect to playlist (client will poll for segments as they are created)
        res.redirect(`/hls/${file.id}/index.m3u8`);
    });
    
    // Serve HLS segments and playlists statically
    app.use('/hls', express.static(path.join(__dirname, 'hls')));
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
    
    exports.hashFilename = hashFilename;