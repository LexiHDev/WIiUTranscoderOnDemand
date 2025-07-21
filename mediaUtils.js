const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MEDIA_DIR } = require('.');

function hashFilename(filename) {
    return crypto.createHash('sha1').update(filename).digest('hex');
}

function getMediaFiles() {
    if (!fs.existsSync(MEDIA_DIR)) {
        fs.mkdirSync(MEDIA_DIR, { recursive: true });
    }
    const files = fs.readdirSync(MEDIA_DIR).filter(f => fs.statSync(path.join(MEDIA_DIR, f)).isFile());
    return files.map((filename) => ({ id: hashFilename(filename), filename }));
}

function getImageFromVideo(filename) {
    const files = getMediaFiles();
    const file = files.find(f => f.filename === filename);
    if (!file) {
        return null;
    }
    const videoPath = path.join(MEDIA_DIR, file.filename);
    const thumbnailPath = path.join(__dirname,'public/images/', `${file.filename}.jpg`);
    if (fs.existsSync(thumbnailPath)) {
        return thumbnailPath;
    } else {
        const { execSync } = require('child_process');
        try {
            execSync(`ffmpeg -i "${videoPath}" -ss 00:00:01 -vframes 1 -s 426x240 "${thumbnailPath}"`, { stdio: 'ignore' });
            console.log(`Thumbnail generated for ${file.filename} at ${thumbnailPath}`);
            return thumbnailPath;
        } catch (error) {
            console.error(`Error generating thumbnail for ${file.filename}:`, error);
            return null; 
        }
    }
}

// generate thumbnails for all media files
function generateThumbnails() {
    const files = getMediaFiles();
    files.forEach(file => {
        getImageFromVideo(file.filename);
    });
}
exports.hashFilename = hashFilename;
exports.getImageFromVideo = getImageFromVideo;
exports.generateThumbnails = generateThumbnails;
exports.getMediaFiles = getMediaFiles;
